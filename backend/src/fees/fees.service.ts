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
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateFeeDto } from './dto/create-fee.dto';
import type { UpdateFeeDto } from './dto/update-fee.dto';
import type { GenerateMonthlyFeesDto } from './dto/generate-monthly-fees.dto';
import type { GenerateSessionFeesDto } from './dto/generate-session-fees.dto';

export interface FeeListFilters {
  status?: FeeStatus;
  classId?: string;
  traineeId?: string;
  // Inclusive window matched against Fee.periodStart.
  periodStartFrom?: string;
  periodStartTo?: string;
}

export interface GenerateResult {
  created: number;
  skipped: number;
}

@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(
    tenantId: string,
    filters: FeeListFilters = {},
    user?: AuthenticatedUser,
  ): Promise<FeeRowWithPaid[]> {
    const where: Prisma.FeeWhereInput = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.classId) where.classId = filters.classId;
    if (filters.traineeId) where.traineeId = filters.traineeId;
    if (filters.periodStartFrom || filters.periodStartTo) {
      const range: Prisma.DateTimeFilter = {};
      if (filters.periodStartFrom) range.gte = new Date(filters.periodStartFrom);
      if (filters.periodStartTo) range.lte = new Date(filters.periodStartTo);
      where.periodStart = range;
    }

    if (user) {
      const allowedIds = await this.scope.getAccessibleLocationIds(user, tenantId);
      if (allowedIds !== null) {
        where.class = { locations: { some: { id: { in: allowedIds } } } };
      }
    }

    const fees = await this.prisma.fee.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take: DEFAULT_LIST_TAKE,
    });
    if (fees.length === 0) return [];

    // One aggregate query for the entire result set — O(1) round trips, not O(n).
    const sums = await this.prisma.payment.groupBy({
      by: ['feeId'],
      where: { feeId: { in: fees.map((f) => f.id) } },
      _sum: { amount: true },
    });
    const paidByFeeId = new Map<string, Prisma.Decimal>(
      sums.map((s) => [s.feeId, s._sum.amount ?? new Prisma.Decimal(0)]),
    );
    return fees.map((f) => ({
      ...f,
      paid: (paidByFeeId.get(f.id) ?? new Prisma.Decimal(0)).toString(),
    }));
  }

  async findById(tenantId: string, id: string, user?: AuthenticatedUser) {
    const where: Prisma.FeeWhereInput = { id, tenantId };
    if (user) {
      const allowedIds = await this.scope.getAccessibleLocationIds(user, tenantId);
      if (allowedIds !== null) {
        where.class = { locations: { some: { id: { in: allowedIds } } } };
      }
    }
    const fee = await this.prisma.fee.findFirst({
      where,
      include: {
        class: { select: { id: true, name: true, billingMode: true } },
        trainee: { select: { id: true, firstName: true, lastName: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!fee) throw new NotFoundException(`Fee ${id} not found`);
    return fee;
  }

  // Validates that an ADMIN can access fees for the given class. Used by create/update.
  private async assertClassAccessible(
    user: AuthenticatedUser,
    tenantId: string,
    classId: string,
  ): Promise<void> {
    const allowedIds = await this.scope.getAccessibleLocationIds(user, tenantId);
    if (allowedIds === null) return;
    const ok = await this.prisma.class.count({
      where: {
        id: classId,
        tenantId,
        locations: { some: { id: { in: allowedIds } } },
      },
    });
    if (!ok) throw new NotFoundException(`Class ${classId} not found`);
  }

  async create(tenantId: string, dto: CreateFeeDto, user?: AuthenticatedUser): Promise<Fee> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    assertPeriod(periodStart, periodEnd);

    await this.assertClassInTenant(tenantId, dto.classId);
    if (user) await this.assertClassAccessible(user, tenantId, dto.classId);
    await this.assertTraineeInTenant(tenantId, dto.traineeId);
    if (dto.sessionId) await this.assertSessionInTenant(tenantId, dto.sessionId);

    return this.prisma.fee.create({
      data: {
        tenantId,
        classId: dto.classId,
        traineeId: dto.traineeId,
        sessionId: dto.sessionId,
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
    user?: AuthenticatedUser,
  ): Promise<Fee> {
    if (user) await this.findById(tenantId, id, user);
    const existing = await this.prisma.fee.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Fee ${id} not found`);

    const newStart = dto.periodStart ? new Date(dto.periodStart) : existing.periodStart;
    const newEnd = dto.periodEnd ? new Date(dto.periodEnd) : existing.periodEnd;
    assertPeriod(newStart, newEnd);

    const data: Prisma.FeeUpdateInput = {};
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.periodStart !== undefined) data.periodStart = newStart;
    if (dto.periodEnd !== undefined) data.periodEnd = newEnd;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;

    return this.prisma.fee.update({ where: { id }, data });
  }

  async delete(tenantId: string, id: string, user?: AuthenticatedUser): Promise<void> {
    if (user) await this.findById(tenantId, id, user);
    const found = await this.prisma.fee.count({ where: { id, tenantId } });
    if (!found) throw new NotFoundException(`Fee ${id} not found`);
    await this.prisma.fee.delete({ where: { id } });
  }

  // --- bulk generate (PER_MONTH) ---
  async generateMonthly(
    tenantId: string,
    dto: GenerateMonthlyFeesDto,
    user?: AuthenticatedUser,
  ): Promise<GenerateResult> {
    const allowedIds = user ? await this.scope.getAccessibleLocationIds(user, tenantId) : null;
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    assertPeriod(periodStart, periodEnd);

    if (dto.classId) await this.assertClassInTenant(tenantId, dto.classId);
    if (dto.classId && user) await this.assertClassAccessible(user, tenantId, dto.classId);

    // Load all PER_MONTH classes (optionally filtered) with their enrolled trainees.
    const classes = await this.prisma.class.findMany({
      where: {
        tenantId,
        billingMode: BillingMode.PER_MONTH,
        ...(dto.classId ? { id: dto.classId } : {}),
        // Skip classes without a monthlyAmount — they have no fee to charge.
        monthlyAmount: { not: null },
        ...(allowedIds === null
          ? {}
          : { locations: { some: { id: { in: allowedIds } } } }),
      },
      include: {
        trainees: { select: { id: true } },
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

    let created = 0;
    let skipped = 0;
    const toCreate: Prisma.FeeCreateManyInput[] = [];

    for (const cls of classes) {
      if (cls.monthlyAmount == null) continue;
      for (const tr of cls.trainees) {
        const key = `${cls.id}|${tr.id}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        toCreate.push({
          tenantId,
          classId: cls.id,
          traineeId: tr.id,
          periodStart,
          periodEnd,
          amount: cls.monthlyAmount,
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

  // --- bulk generate (PER_SESSION) ---
  async generateSessionFees(
    tenantId: string,
    dto: GenerateSessionFeesDto,
    user?: AuthenticatedUser,
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
    if (dto.classId) await this.assertClassInTenant(tenantId, dto.classId);
    if (dto.classId && user) await this.assertClassAccessible(user, tenantId, dto.classId);
    const allowedIds = user ? await this.scope.getAccessibleLocationIds(user, tenantId) : null;

    // Sessions in range whose class is PER_SESSION (with sessionPrice set), include
    // class.trainees so we can iterate enrolled trainees per session.
    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        startsAt: { gte: from, lte: endOfDay(to) },
        ...(dto.classId ? { classId: dto.classId } : {}),
        class: {
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: { not: null },
        },
        ...(allowedIds === null ? {} : { locationId: { in: allowedIds } }),
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
      const dayStart = startOfDay(session.startsAt);
      const dayEnd = endOfDay(session.startsAt);
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
   * Recompute Fee.status from the sum of its Payment rows, inside the given transaction.
   * Called from PaymentsService after insert/delete.
   */
  async recomputeStatusInTransaction(
    tx: Prisma.TransactionClient,
    feeId: string,
  ): Promise<void> {
    const fee = await tx.fee.findUnique({ where: { id: feeId } });
    if (!fee) return;
    const agg = await tx.payment.aggregate({
      where: { feeId },
      _sum: { amount: true },
    });
    const totalPaid = agg._sum.amount ?? new Prisma.Decimal(0);
    let status: FeeStatus;
    if (totalPaid.gte(fee.amount)) status = FeeStatus.PAID;
    else if (totalPaid.gt(0)) status = FeeStatus.PARTIAL;
    else status = FeeStatus.UNPAID;
    if (status !== fee.status) {
      await tx.fee.update({ where: { id: feeId }, data: { status } });
    }
  }

  // --- internal validators ---

  private async assertClassInTenant(tenantId: string, classId: string): Promise<void> {
    const found = await this.prisma.class.count({ where: { id: classId, tenantId } });
    if (!found) throw new BadRequestException('classId is invalid or not in your tenant');
  }
  private async assertTraineeInTenant(tenantId: string, traineeId: string): Promise<void> {
    const found = await this.prisma.trainee.count({ where: { id: traineeId, tenantId } });
    if (!found) throw new BadRequestException('traineeId is invalid or not in your tenant');
  }
  private async assertSessionInTenant(tenantId: string, sessionId: string): Promise<void> {
    const found = await this.prisma.session.count({ where: { id: sessionId, tenantId } });
    if (!found) throw new BadRequestException('sessionId is invalid or not in your tenant');
  }
}

function assertPeriod(periodStart: Date, periodEnd: Date): void {
  if (
    Number.isNaN(periodStart.getTime()) ||
    Number.isNaN(periodEnd.getTime()) ||
    periodEnd.getTime() < periodStart.getTime()
  ) {
    throw new BadRequestException('periodEnd must be on or after periodStart');
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}
