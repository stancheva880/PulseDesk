import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingMode,
  FeeStatus,
  Prisma,
  type Fee,
} from '@prisma/client';

// Returned by list() — base fee plus the aggregate sum of its payments. Outstanding
// is intentionally NOT pre-computed: callers can derive it as `amount - paid` and
// also know the raw paid figure if they want a "X paid of Y" display.
export type FeeRowWithPaid = Fee & { paid: string };
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  DEFAULT_LIST_TAKE,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import { searchVariants } from '@/common/search-variants';
import { assertDateOrder, endOfDayUtc, startOfDayUtc } from '@/common/dates';
import { assertClassInTenant, assertTraineeInTenant } from '@/common/tenant-guards';
import type { CreateFeeDto } from './dto/create-fee.dto';
import type { GenerateCourseFeesDto } from './dto/generate-course-fees.dto';
import type { UpdateFeeDto } from './dto/update-fee.dto';
import type { GenerateMonthlyFeesDto } from './dto/generate-monthly-fees.dto';
import { OUTSTANDING, type FeeStatusFilter } from './dto/list-fees-query.dto';
import type { GenerateSessionFeesDto } from './dto/generate-session-fees.dto';

/** One enrolled (class, trainee) pair with no fee for the period yet. */
export interface UnbilledEntry {
  classId: string;
  className: string;
  traineeId: string;
  traineeFirstName: string;
  traineeLastName: string;
  amount: Prisma.Decimal;
}

export interface FeeListFilters {
  status?: FeeStatusFilter;
  classId?: string;
  traineeId?: string;
  // Inclusive window matched against Fee.periodStart.
  periodStartFrom?: string;
  periodStartTo?: string;
  // Substring over the related trainee's email/first/last name (TKT-0095).
  search?: string;
}

import type { GenerateResult } from '@/common/generate-result';

@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(
    tenantId: string,
    filters: FeeListFilters = {},
    user: AuthenticatedUser,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<FeeRowWithPaid>> {
    const where: Prisma.FeeWhereInput = { tenantId };
    // OUTSTANDING is not a column value — it is "still owes", i.e. anything but PAID.
    if (filters.status === OUTSTANDING) where.status = { not: FeeStatus.PAID };
    else if (filters.status) where.status = filters.status;
    if (filters.classId) where.classId = filters.classId;
    if (filters.traineeId) where.traineeId = filters.traineeId;
    if (filters.periodStartFrom || filters.periodStartTo) {
      const range: Prisma.DateTimeFilter = {};
      if (filters.periodStartFrom) range.gte = new Date(filters.periodStartFrom);
      if (filters.periodStartTo) range.lte = new Date(filters.periodStartTo);
      if (range.gte && range.lte) {
        assertDateOrder(range.gte as Date, range.lte as Date, {
          strict: false,
          message: 'periodStartTo must be on or after periodStartFrom',
          code: 'FEE_PERIOD_FILTER_ORDER',
        });
      }
      where.periodStart = range;
    }
    // A fee row has no searchable text of its own — the match runs over the related trainee,
    // same columns and casing fold as GET /trainees?search. The clause goes in AND, so it
    // narrows the tenant and location scope; attached to where.OR it would widen the scope
    // and leak fees across locations (the RES-0003 trap).
    const search = searchVariants(filters.search ?? '');
    if (search.length > 0) {
      where.AND = [
        {
          trainee: {
            OR: search.flatMap((v) => [
              { email: { contains: v } },
              { firstName: { contains: v } },
              { lastName: { contains: v } },
            ]),
          },
        },
      ];
    }

    const scoped = await this.scope.locationsWhere(user, tenantId);
    if (scoped.locations) {
      // TKT-0106: class-less (card purchase) fees are tenant-level money — the location
      // scope narrows class fees but must not hide class-less ones. Goes in AND so it
      // composes with the search clause instead of widening it.
      const locationScope: Prisma.FeeWhereInput = {
        OR: [{ classId: null }, { class: scoped }],
      };
      where.AND = where.AND
        ? [...(where.AND as Prisma.FeeWhereInput[]), locationScope]
        : [locationScope];
    }

    const p = normalizePagination(pagination);
    const [fees, total] = await this.prisma.$transaction([
      this.prisma.fee.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.fee.count({ where }),
    ]);
    if (fees.length === 0) return buildPaginatedResult([], total, p);

    // One aggregate query for the current page — O(1) round trips, not O(n).
    const sums = await this.prisma.payment.groupBy({
      by: ['feeId'],
      where: { feeId: { in: fees.map((f) => f.id) } },
      _sum: { amount: true },
    });
    const paidByFeeId = new Map<string, string>(
      sums.map((s) => [s.feeId, (s._sum.amount ?? new Prisma.Decimal(0)).toString()]),
    );
    const items = fees.map((f) => ({
      ...f,
      paid: paidByFeeId.get(f.id) ?? '0',
    }));
    return buildPaginatedResult(items, total, p);
  }

  async findById(tenantId: string, id: string, user: AuthenticatedUser) {
    const where: Prisma.FeeWhereInput = { id, tenantId };
    const scoped = await this.scope.locationsWhere(user, tenantId);
    // TKT-0106: class-less fees stay visible to every admin of the tenant.
    if (scoped.locations) where.OR = [{ classId: null }, { class: scoped }];
    const fee = await this.prisma.fee.findFirst({
      where,
      include: {
        class: { select: { id: true, name: true, billingMode: true } },
        trainee: { select: { id: true, firstName: true, lastName: true } },
        payments: { orderBy: { paidAt: 'desc' } },
        refunds: { orderBy: { refundedAt: 'desc' } },
      },
    });
    if (!fee) throw new NotFoundException(`Fee ${id} not found`);
    return fee;
  }

  // Tenant-bound + ADMIN-location-scoped via the fee's class; SUPER_ADMIN passes through.
  // Shared gate for the fee's sub-ledgers (payments, refunds — TKT-0105 moved it here).
  // TKT-0106: class-less (card purchase) fees stay visible to every admin of the tenant.
  async assertFeeAccessible(
    tenantId: string,
    feeId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const where: Prisma.FeeWhereInput = { id: feeId, tenantId };
    const scoped = await this.scope.locationsWhere(user, tenantId);
    if (scoped.locations) where.OR = [{ classId: null }, { class: scoped }];
    const found = await this.prisma.fee.count({ where });
    if (!found) throw new NotFoundException(`Fee ${feeId} not found`);
  }

  // Validates that an ADMIN can access fees for the given class. Used by create/update.
  private async assertClassAccessible(
    user: AuthenticatedUser,
    tenantId: string,
    classId: string,
  ): Promise<void> {
    const scoped = await this.scope.locationsWhere(user, tenantId);
    if (!scoped.locations) return;
    const ok = await this.prisma.class.count({
      where: { id: classId, tenantId, ...scoped },
    });
    if (!ok) throw new NotFoundException(`Class ${classId} not found`);
  }

  async create(tenantId: string, dto: CreateFeeDto, user: AuthenticatedUser): Promise<Fee> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    assertPeriod(periodStart, periodEnd);

    await assertClassInTenant(this.prisma, tenantId, dto.classId);
    await this.assertClassAccessible(user, tenantId, dto.classId);
    await assertTraineeInTenant(this.prisma, tenantId, dto.traineeId);

    return this.prisma.fee.create({
      data: {
        tenantId,
        classId: dto.classId,
        traineeId: dto.traineeId,
        periodStart,
        periodEnd,
        amount: new Prisma.Decimal(dto.amount),
        notes: dto.notes,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateFeeDto,
    user: AuthenticatedUser,
  ): Promise<Fee> {
    const existing = await this.findById(tenantId, id, user);

    const newStart = dto.periodStart ? new Date(dto.periodStart) : existing.periodStart;
    const newEnd = dto.periodEnd ? new Date(dto.periodEnd) : existing.periodEnd;
    assertPeriod(newStart, newEnd);

    const data: Prisma.FeeUpdateInput = {};
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.periodStart !== undefined) data.periodStart = newStart;
    if (dto.periodEnd !== undefined) data.periodEnd = newEnd;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;

    return this.prisma.$transaction(async (tx) => {
      // The second door into an overpaid fee: no payment is added, the fee shrinks under what has
      // already been taken. Same rule as PaymentsService.record — the ledger is the fixed point,
      // so correcting a fee downwards means deleting the payment that no longer fits first.
      if (dto.amount !== undefined) {
        const paid = await this.paidTotalInTransaction(tx, id);
        if (paid.gt(dto.amount)) {
          throw new BadRequestException({
            message: `Amount ${dto.amount} is below the ${paid} already recorded against this fee`,
            code: 'FEE_AMOUNT_BELOW_PAID',
            params: { amount: dto.amount, paid: paid.toString() },
          });
        }
      }
      const updated = await tx.fee.update({ where: { id }, data });
      if (dto.amount === undefined) return updated;
      // A new amount changes what "paid in full" means, so the status has to follow it: below the
      // paid total the fee is settled, above it a PAID fee owes money again. Until now only the
      // payment paths recomputed, so an edited amount left the status stale.
      await this.recomputeStatusInTransaction(tx, id);
      // Re-read, so the response carries the recomputed status rather than the row as written.
      return tx.fee.findUniqueOrThrow({ where: { id } });
    });
  }

  async delete(tenantId: string, id: string, user: AuthenticatedUser): Promise<void> {
    await this.findById(tenantId, id, user);
    await this.prisma.fee.delete({ where: { id } });
  }

  /**
   * The enrolled (class, trainee) pairs that have no PER_MONTH fee for this period yet.
   *
   * Shared by generateMonthly, which creates them, and by listUnbilled, which only reports
   * them. One query path on purpose: a preview computed separately would eventually disagree
   * with what generating actually does, and the disagreement would be invisible.
   */
  private async collectUnbilled(
    tenantId: string,
    dto: GenerateMonthlyFeesDto,
    user: AuthenticatedUser,
  ): Promise<{ periodStart: Date; periodEnd: Date; gaps: UnbilledEntry[]; skipped: number }> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    assertPeriod(periodStart, periodEnd);

    if (dto.classId) await assertClassInTenant(this.prisma, tenantId, dto.classId);
    if (dto.classId) await this.assertClassAccessible(user, tenantId, dto.classId);

    // Load all PER_MONTH classes (optionally filtered) with their enrolled trainees.
    const classes = await this.prisma.class.findMany({
      where: {
        tenantId,
        billingMode: BillingMode.PER_MONTH,
        ...(dto.classId ? { id: dto.classId } : {}),
        // Skip classes without a monthlyAmount — they have no fee to charge.
        monthlyAmount: { not: null },
        ...(await this.scope.locationsWhere(user, tenantId)),
      },
      include: {
        trainees: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Bulk-load existing fees in the tenant for this exact period to dedupe.
    const existing = await this.prisma.fee.findMany({
      where: {
        tenantId,
        periodStart,
        periodEnd,
        sessionId: null,
        ...(dto.classId ? { classId: dto.classId } : {}),
      },
      select: { classId: true, traineeId: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.classId}|${e.traineeId}`));

    const gaps: UnbilledEntry[] = [];
    let skipped = 0;

    for (const cls of classes) {
      if (cls.monthlyAmount == null) continue;
      for (const tr of cls.trainees) {
        const key = `${cls.id}|${tr.id}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        gaps.push({
          classId: cls.id,
          className: cls.name,
          traineeId: tr.id,
          traineeFirstName: tr.firstName,
          traineeLastName: tr.lastName,
          amount: cls.monthlyAmount,
        });
        existingKeys.add(key);
      }
    }
    return { periodStart, periodEnd, gaps, skipped };
  }

  /**
   * Read-only counterpart of generateMonthly. A trainee nobody billed has no fee row, so no
   * status filter on GET /fees can ever surface them — this is the other half of "who has
   * not paid". Plain array, not a page: the result is bounded by one period's enrolment.
   */
  async listUnbilled(
    tenantId: string,
    dto: GenerateMonthlyFeesDto,
    user: AuthenticatedUser,
  ): Promise<UnbilledEntry[]> {
    const { gaps } = await this.collectUnbilled(tenantId, dto, user);
    return gaps;
  }

  // --- bulk generate (PER_MONTH) ---
  async generateMonthly(
    tenantId: string,
    dto: GenerateMonthlyFeesDto,
    user: AuthenticatedUser,
  ): Promise<GenerateResult> {
    const { periodStart, periodEnd, gaps, skipped } = await this.collectUnbilled(
      tenantId,
      dto,
      user,
    );

    if (gaps.length) {
      const toCreate: Prisma.FeeCreateManyInput[] = gaps.map((g) => ({
        tenantId,
        classId: g.classId,
        traineeId: g.traineeId,
        periodStart,
        periodEnd,
        amount: g.amount,
      }));
      await this.prisma.fee.createMany({ data: toCreate });
    }
    return { created: gaps.length, skipped };
  }

  // --- bulk generate (PER_COURSE, TKT-0110) ---
  // Gap-healer: one fee per (enrolled trainee × course class × its current period). Same
  // idempotent shape as generateMonthly; the class carries period and price, so the dto is
  // only the optional class filter. Existing fees are never updated — ledger is history.
  async generateCourse(
    tenantId: string,
    dto: GenerateCourseFeesDto,
    user: AuthenticatedUser,
  ): Promise<GenerateResult> {
    if (dto.classId) await assertClassInTenant(this.prisma, tenantId, dto.classId);
    if (dto.classId) await this.assertClassAccessible(user, tenantId, dto.classId);

    const classes = await this.prisma.class.findMany({
      where: {
        tenantId,
        billingMode: BillingMode.PER_COURSE,
        ...(dto.classId ? { id: dto.classId } : {}),
        courseStart: { not: null },
        courseEnd: { not: null },
        coursePrice: { not: null },
        ...(await this.scope.locationsWhere(user, tenantId)),
      },
      include: { trainees: { select: { id: true } } },
    });
    if (classes.length === 0) return { created: 0, skipped: 0 };

    const existing = await this.prisma.fee.findMany({
      where: {
        tenantId,
        classId: { in: classes.map((c) => c.id) },
        sessionId: null,
      },
      select: { classId: true, traineeId: true, periodStart: true, periodEnd: true },
    });
    const existingKeys = new Set(
      existing.map(
        (f) => `${f.classId}|${f.traineeId}|${f.periodStart.getTime()}|${f.periodEnd.getTime()}`,
      ),
    );

    let skipped = 0;
    const toCreate: Prisma.FeeCreateManyInput[] = [];
    for (const cls of classes) {
      if (cls.courseStart == null || cls.courseEnd == null || cls.coursePrice == null) continue;
      for (const tr of cls.trainees) {
        const key = `${cls.id}|${tr.id}|${cls.courseStart.getTime()}|${cls.courseEnd.getTime()}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        toCreate.push({
          tenantId,
          classId: cls.id,
          traineeId: tr.id,
          periodStart: cls.courseStart,
          periodEnd: cls.courseEnd,
          amount: cls.coursePrice,
        });
        existingKeys.add(key);
      }
    }
    if (toCreate.length) await this.prisma.fee.createMany({ data: toCreate });
    return { created: toCreate.length, skipped };
  }

  // --- bulk generate (PER_SESSION) ---
  async generateSessionFees(
    tenantId: string,
    dto: GenerateSessionFeesDto,
    user: AuthenticatedUser,
  ): Promise<GenerateResult> {
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to.getTime() < from.getTime()
    ) {
      throw new BadRequestException('"to" must be on or after "from"');
    }
    if (dto.classId) await assertClassInTenant(this.prisma, tenantId, dto.classId);
    if (dto.classId) await this.assertClassAccessible(user, tenantId, dto.classId);

    // Sessions in range whose class is PER_SESSION (with sessionPrice set), include
    // class.trainees so we can iterate enrolled trainees per session.
    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        startsAt: { gte: from, lte: endOfDayUtc(to) },
        ...(dto.classId ? { classId: dto.classId } : {}),
        class: {
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: { not: null },
        },
        ...(await this.scope.locationWhere(user, tenantId)),
      },
      include: {
        class: {
          select: {
            id: true,
            sessionPrice: true,
            trainees: { select: { id: true } },
          },
        },
      },
    });

    if (sessions.length === 0) return { created: 0, skipped: 0 };

    // Bulk-load existing PER_SESSION fees for these sessions.
    const sessionIds = sessions.map((s) => s.id);
    const existing = await this.prisma.fee.findMany({
      where: { tenantId, sessionId: { in: sessionIds } },
      select: { sessionId: true, traineeId: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.sessionId}|${e.traineeId}`));

    let created = 0;
    let skipped = 0;
    const toCreate: Prisma.FeeCreateManyInput[] = [];

    for (const session of sessions) {
      if (session.class.sessionPrice == null) continue;
      const dayStart = startOfDayUtc(session.startsAt);
      const dayEnd = endOfDayUtc(session.startsAt);
      for (const tr of session.class.trainees) {
        const key = `${session.id}|${tr.id}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        toCreate.push({
          tenantId,
          classId: session.class.id,
          traineeId: tr.id,
          sessionId: session.id,
          periodStart: dayStart,
          periodEnd: dayEnd,
          amount: session.class.sessionPrice,
        });
        existingKeys.add(key);
        created += 1;
      }
    }

    if (toCreate.length) {
      await this.prisma.fee.createMany({ data: toCreate });
    }
    return { created, skipped };
  }

  // --- customer-facing list ---

  // Read-only list for the customer portal: fees for trainees the customer owns
  // (`Trainee.userId === customer.id`) or guards (`Trainee.guardians[]` includes
  // customer). Server-side filtering keeps other parents' children out by construction.
  // Embeds class, trainee names, and the full payment history so the portal can render
  // status + ledger without a second round trip.
  listForCustomer(tenantId: string, customerUserId: string) {
    return this.prisma.fee.findMany({
      where: {
        tenantId,
        trainee: {
          OR: [
            { userId: customerUserId },
            { guardians: { some: { id: customerUserId } } },
          ],
        },
      },
      include: {
        class: { select: { id: true, name: true } },
        trainee: { select: { id: true, firstName: true, lastName: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take: DEFAULT_LIST_TAKE,
    });
  }

  // --- helpers used by PaymentsService ---

  /**
   * NET paid for a fee — payments minus refunds (TKT-0105) — read inside the caller's
   * transaction. One place answers "how much does the club hold", so the overpayment guards,
   * the refund guards and the status recompute cannot disagree. A caller wanting gross
   * payments must aggregate the Payment table itself.
   */
  async paidTotalInTransaction(
    tx: Prisma.TransactionClient,
    feeId: string,
  ): Promise<Prisma.Decimal> {
    // Sequential on purpose: concurrent queries on one interactive-transaction client
    // are not supported by Prisma.
    const paid = await tx.payment.aggregate({ where: { feeId }, _sum: { amount: true } });
    const refunded = await tx.refund.aggregate({ where: { feeId }, _sum: { amount: true } });
    return (paid._sum.amount ?? new Prisma.Decimal(0)).minus(
      refunded._sum.amount ?? new Prisma.Decimal(0),
    );
  }

  /**
   * Recompute Fee.status from the sum of its Payment rows, inside the given transaction.
   * Called from PaymentsService after insert/delete.
   */
  async recomputeStatusInTransaction(
    tx: Prisma.TransactionClient,
    feeId: string,
  ): Promise<void> {
    const fee = await tx.fee.findUnique({ where: { id: feeId } });
    if (!fee) return;
    const totalPaid = await this.paidTotalInTransaction(tx, feeId);
    let status: FeeStatus;
    // `eq`, not `gte`, matching PRD.md:39 and CLAUDE.md's Phase 4 rule. `gte` used to be how this
    // coped with a total above the amount — a case FeeStatus cannot express and the guards in
    // `update` and `PaymentsService.record` now prevent, so the exact comparison is reachable.
    if (totalPaid.eq(fee.amount)) status = FeeStatus.PAID;
    else if (totalPaid.gt(0)) status = FeeStatus.PARTIAL;
    else status = FeeStatus.UNPAID;
    if (status !== fee.status) {
      await tx.fee.update({ where: { id: feeId }, data: { status } });
    }
  }

}

function assertPeriod(periodStart: Date, periodEnd: Date): void {
  assertDateOrder(periodStart, periodEnd, {
    strict: false,
    message: 'periodEnd must be on or after periodStart',
    code: 'FEE_PERIOD_ORDER',
  });
}
