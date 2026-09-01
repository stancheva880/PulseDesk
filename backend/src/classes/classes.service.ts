import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingMode, Prisma, UserRole, type Class } from '@prisma/client';
import { backfillFutureSessions } from '@/attendances/attendance-backfill';
import { assertDateOrder } from '@/common/dates';
import { createCourseFees, deleteUnpaidCourseFees } from '@/fees/course-fee-sync';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { assertClassLedgerEmpty } from '@/common/ledger-guards';
import { connectMany, isUniqueConstraintError, setMany } from '@/common/prisma-relations';
import { searchVariants } from '@/common/search-variants';
import { assertLocationIds, assertTraineeIds, assertTrainerIds } from '@/common/tenant-guards';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateClassDto } from './dto/create-class.dto';
import type { UpdateClassDto } from './dto/update-class.dto';

export interface ClassListFilters {
  isActive?: boolean;
  search?: string;
}

// GET /classes's own include — who teaches each class, visible on the list without opening it.
const CLASS_LIST_INCLUDE = {
  trainers: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.ClassInclude;

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  // Build the tenant + role-scoped where clause shared by list() and findById().
  // EMPLOYEE (trainer) is scoped to classes they teach, plus classes of any session they're a
  // trainer on (so substitute sessions still resolve their class). ADMIN is location-scoped.
  private async scopedWhere(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<Prisma.ClassWhereInput> {
    if (user.role === UserRole.EMPLOYEE) {
      return {
        tenantId,
        OR: [
          { trainers: { some: { id: user.id } } },
          { sessions: { some: { trainers: { some: { id: user.id } } } } },
        ],
      };
    }
    return {
      tenantId,
      ...(await this.scope.locationsWhere(user, tenantId)),
    };
  }

  async list(
    tenantId: string,
    user: AuthenticatedUser,
    pagination?: PaginationInput,
    filters?: ClassListFilters,
  ): Promise<PaginatedResult<Prisma.ClassGetPayload<{ include: typeof CLASS_LIST_INCLUDE }>>> {
    // The filter sits on top of the scoped where rather than inside scopedWhere(), which
    // findById() shares: reading one class by id must not depend on whether it is active.
    // The search clause goes in `AND` so it narrows the scoped where instead of replacing any
    // part of it — same rule as GET /users and GET /trainees.
    const search = searchVariants(filters?.search ?? '');
    const where: Prisma.ClassWhereInput = {
      ...(await this.scopedWhere(tenantId, user)),
      ...(filters?.isActive === undefined ? {} : { isActive: filters.isActive }),
      ...(search.length > 0
        ? { AND: [{ OR: search.map((v) => ({ name: { contains: v } })) }] }
        : {}),
    };
    const p = normalizePagination(pagination);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.class.findMany({
        where,
        include: CLASS_LIST_INCLUDE,
        orderBy: { name: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.class.count({ where }),
    ]);
    return buildPaginatedResult(items, total, p);
  }

  async findById(tenantId: string, id: string, user: AuthenticatedUser) {
    const cls = await this.prisma.class.findFirst({
      where: { id, ...(await this.scopedWhere(tenantId, user)) },
      include: {
        locations: { select: { id: true, name: true } },
        trainers: { select: { id: true, firstName: true, lastName: true, email: true } },
        trainees: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!cls) throw new NotFoundException(`Class ${id} not found`);
    return cls;
  }

  async create(tenantId: string, dto: CreateClassDto, user: AuthenticatedUser): Promise<Class> {
    this.assertCreateBillingConsistent(dto);
    // TKT-0117: a cutoff without the flag would be dead configuration — refuse it.
    if (dto.bookingCutoffMin !== undefined && dto.allowSelfBooking !== true) {
      throw new BadRequestException({
        message: 'bookingCutoffMin is only valid when allowSelfBooking is true',
        code: 'CLASS_CUTOFF_REQUIRES_SELF_BOOKING',
      });
    }

    await assertLocationIds(this.prisma, tenantId, dto.locationIds);
    await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await assertTrainerIds(this.prisma, tenantId, dto.trainerIds);
    await assertTraineeIds(this.prisma, tenantId, dto.traineeIds);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.class.create({
          data: {
            tenantId,
            name: dto.name,
            description: dto.description ?? null,
            billingMode: dto.billingMode,
            monthlyAmount: dto.monthlyAmount ?? null,
            sessionPrice: dto.sessionPrice ?? null,
            courseStart: dto.courseStart ? new Date(dto.courseStart) : null,
            courseEnd: dto.courseEnd ? new Date(dto.courseEnd) : null,
            coursePrice: dto.coursePrice ?? null,
            capacity: dto.capacity ?? null,
            waitlistMode: dto.waitlistMode,
            allowSelfBooking: dto.allowSelfBooking ?? false,
            bookingCutoffMin: dto.bookingCutoffMin ?? null,
            locations: connectMany(dto.locationIds),
            trainers: connectMany(dto.trainerIds),
            trainees: connectMany(dto.traineeIds),
          },
        });
        // TKT-0110: selling a course with its roster is enrollment — bill it in the same tx.
        if (dto.traineeIds?.length) {
          await createCourseFees(tx, {
            tenantId,
            classId: created.id,
            traineeIds: dto.traineeIds,
          });
        }
        return created;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: `Class "${dto.name}" already exists`,
          code: 'CLASS_NAME_TAKEN',
          params: { name: dto.name },
        });
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateClassDto,
    user: AuthenticatedUser,
  ): Promise<Class> {
    const existing = await this.findById(tenantId, id, user);

    // TKT-0109: billingMode is editable — validation runs against the effective mode
    // (dto if sent, else existing), so a switch and its new-mode fields land together.
    const effectiveMode = dto.billingMode ?? existing.billingMode;
    const modeChanged = effectiveMode !== existing.billingMode;

    // TKT-0117: same effective-value rule as the billing mode — a cutoff may only land on a
    // class whose flag is (or is becoming) on.
    const effectiveSelfBooking = dto.allowSelfBooking ?? existing.allowSelfBooking;
    if (dto.bookingCutoffMin !== undefined && !effectiveSelfBooking) {
      throw new BadRequestException({
        message: 'bookingCutoffMin is only valid when allowSelfBooking is true',
        code: 'CLASS_CUTOFF_REQUIRES_SELF_BOOKING',
      });
    }

    if (dto.monthlyAmount !== undefined && effectiveMode !== BillingMode.PER_MONTH) {
      throw new BadRequestException({
        message: 'monthlyAmount is only valid on PER_MONTH classes',
        code: 'CLASS_MONTHLY_ONLY_PER_MONTH',
      });
    }
    if (dto.sessionPrice !== undefined && effectiveMode !== BillingMode.PER_SESSION) {
      throw new BadRequestException({
        message: 'sessionPrice is only valid on PER_SESSION classes',
        code: 'CLASS_SESSION_PRICE_ONLY_PER_SESSION',
      });
    }
    if (
      (dto.courseStart !== undefined ||
        dto.courseEnd !== undefined ||
        dto.coursePrice !== undefined) &&
      effectiveMode !== BillingMode.PER_COURSE
    ) {
      throw new BadRequestException({
        message: 'courseStart/courseEnd/coursePrice are only valid on PER_COURSE classes',
        code: 'CLASS_COURSE_ONLY_PER_COURSE',
      });
    }

    // Required fields of the effective mode, on effective values. Old-mode leftovers are
    // impossible here: a non-X class always carries null X-fields (creation rules + the
    // clear-on-switch below), so `dto ?? existing` never resurrects a stale price.
    if (effectiveMode === BillingMode.PER_MONTH) {
      if ((dto.monthlyAmount ?? existing.monthlyAmount) == null) {
        throw new BadRequestException({
          message: 'monthlyAmount is required when billingMode is PER_MONTH',
          code: 'CLASS_MONTHLY_REQUIRED',
        });
      }
    } else if (effectiveMode === BillingMode.PER_SESSION) {
      if ((dto.sessionPrice ?? existing.sessionPrice) == null) {
        throw new BadRequestException({
          message: 'sessionPrice is required when billingMode is PER_SESSION',
          code: 'CLASS_SESSION_PRICE_REQUIRED',
        });
      }
    } else {
      assertCoursePricing(
        dto.courseStart !== undefined ? new Date(dto.courseStart) : existing.courseStart,
        dto.courseEnd !== undefined ? new Date(dto.courseEnd) : existing.courseEnd,
        dto.coursePrice !== undefined ? dto.coursePrice : existing.coursePrice,
      );
    }

    await assertLocationIds(this.prisma, tenantId, dto.locationIds);
    await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await assertTrainerIds(this.prisma, tenantId, dto.trainerIds);
    await assertTraineeIds(this.prisma, tenantId, dto.traineeIds);

    // TKT-0123: `set` replaces the whole relation, so what LEAVES needs the same check as what
    // arrives. `findById` above already loaded every `before` set, so none of this costs a query
    // beyond the visibility counts themselves.
    if (dto.locationIds !== undefined) {
      await this.scope.assertLocationRemovalsAllowed(
        user,
        tenantId,
        existing.locations.map((l) => l.id),
        dto.locationIds,
      );
    }
    if (dto.traineeIds !== undefined) {
      await this.scope.assertRemovalsAllowed(
        user,
        tenantId,
        existing.trainees.map((t) => t.id),
        dto.traineeIds,
        (removed, allowed) =>
          this.prisma.trainee.count({
            where: {
              id: { in: removed },
              tenantId,
              locations: { some: {} },
              NOT: { locations: { some: { id: { in: allowed } } } },
            },
          }),
        'trainees',
      );
    }
    if (dto.trainerIds !== undefined) {
      await this.scope.assertRemovalsAllowed(
        user,
        tenantId,
        existing.trainers.map((tr) => tr.id),
        dto.trainerIds,
        (removed, allowed) =>
          this.prisma.user.count({
            where: {
              id: { in: removed },
              locations: { some: { tenantId } },
              NOT: { locations: { some: { id: { in: allowed } } } },
            },
          }),
        'trainers',
      );
    }

    const data: Prisma.ClassUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (modeChanged) {
      // A switched class never keeps the old mode's prices — stale values would corrupt a
      // later switch back (the `dto ?? existing` requirement checks above rely on this).
      data.billingMode = effectiveMode;
      if (effectiveMode !== BillingMode.PER_MONTH) data.monthlyAmount = null;
      if (effectiveMode !== BillingMode.PER_SESSION) data.sessionPrice = null;
      if (effectiveMode !== BillingMode.PER_COURSE) {
        data.courseStart = null;
        data.courseEnd = null;
        data.coursePrice = null;
      }
    }
    if (dto.monthlyAmount !== undefined) data.monthlyAmount = dto.monthlyAmount;
    if (dto.sessionPrice !== undefined) data.sessionPrice = dto.sessionPrice;
    if (dto.courseStart !== undefined) data.courseStart = new Date(dto.courseStart);
    if (dto.courseEnd !== undefined) data.courseEnd = new Date(dto.courseEnd);
    if (dto.coursePrice !== undefined) data.coursePrice = dto.coursePrice;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.waitlistMode !== undefined) data.waitlistMode = dto.waitlistMode;
    if (dto.allowSelfBooking !== undefined) {
      data.allowSelfBooking = dto.allowSelfBooking;
      // Turning the flag off never keeps a stale cutoff — a later re-enable starts clean
      // (same idiom as the billing-mode price clearing above).
      if (!dto.allowSelfBooking) data.bookingCutoffMin = null;
    }
    if (dto.bookingCutoffMin !== undefined) data.bookingCutoffMin = dto.bookingCutoffMin;
    if (dto.locationIds !== undefined) data.locations = setMany(dto.locationIds);
    if (dto.trainerIds !== undefined) data.trainers = setMany(dto.trainerIds);
    if (dto.traineeIds !== undefined) data.trainees = setMany(dto.traineeIds);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.class.update({ where: { id }, data });
        // Trainees added to the roster must appear on this class's upcoming sessions.
        if (dto.traineeIds !== undefined) {
          await backfillFutureSessions(tx, { tenantId, classId: id, traineeIds: dto.traineeIds });
          // TKT-0110: roster changes carry their course fees. Runs after the class row
          // update, so a same-request course-field edit bills the new values. A bare mode
          // switch (no traineeIds) still touches no fees — the generator heals that gap.
          const before = new Set(existing.trainees.map((tr) => tr.id));
          const after = new Set(dto.traineeIds);
          await createCourseFees(tx, {
            tenantId,
            classId: id,
            traineeIds: dto.traineeIds.filter((trId) => !before.has(trId)),
          });
          await deleteUnpaidCourseFees(tx, {
            tenantId,
            classId: id,
            traineeIds: existing.trainees.map((tr) => tr.id).filter((trId) => !after.has(trId)),
          });
        }
        return updated;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: 'Class name already in use',
          code: 'CLASS_NAME_IN_USE',
        });
      }
      throw e;
    }
  }

  async delete(tenantId: string, id: string, user: AuthenticatedUser): Promise<void> {
    await this.findById(tenantId, id, user);
    // Fee.class cascades, and Payment/Refund cascade from the fee — so without this the delete
    // takes the class's money history with it. Deactivating is the non-destructive route.
    await assertClassLedgerEmpty(this.prisma, tenantId, id);
    await this.prisma.class.delete({ where: { id } });
  }

  private assertCreateBillingConsistent(dto: CreateClassDto): void {
    const hasCourseFields =
      dto.courseStart != null || dto.courseEnd != null || dto.coursePrice != null;
    if (dto.billingMode !== BillingMode.PER_COURSE && hasCourseFields) {
      throw new BadRequestException({
        message: 'courseStart/courseEnd/coursePrice must be omitted unless billingMode is PER_COURSE',
        code: 'CLASS_COURSE_FIELDS_FORBIDDEN',
      });
    }
    if (dto.billingMode === BillingMode.PER_MONTH) {
      if (dto.monthlyAmount == null) {
        throw new BadRequestException({
          message: 'monthlyAmount is required when billingMode is PER_MONTH',
          code: 'CLASS_MONTHLY_REQUIRED',
        });
      }
      if (dto.sessionPrice != null) {
        throw new BadRequestException({
          message: 'sessionPrice must be omitted when billingMode is PER_MONTH',
          code: 'CLASS_SESSION_PRICE_FORBIDDEN',
        });
      }
    } else if (dto.billingMode === BillingMode.PER_SESSION) {
      if (dto.sessionPrice == null) {
        throw new BadRequestException({
          message: 'sessionPrice is required when billingMode is PER_SESSION',
          code: 'CLASS_SESSION_PRICE_REQUIRED',
        });
      }
      if (dto.monthlyAmount != null) {
        throw new BadRequestException({
          message: 'monthlyAmount must be omitted when billingMode is PER_SESSION',
          code: 'CLASS_MONTHLY_FORBIDDEN',
        });
      }
    } else {
      // TKT-0109: PER_COURSE — the run's bounds and one price, all three together.
      if (dto.monthlyAmount != null) {
        throw new BadRequestException({
          message: 'monthlyAmount must be omitted when billingMode is PER_COURSE',
          code: 'CLASS_MONTHLY_FORBIDDEN',
        });
      }
      if (dto.sessionPrice != null) {
        throw new BadRequestException({
          message: 'sessionPrice must be omitted when billingMode is PER_COURSE',
          code: 'CLASS_SESSION_PRICE_FORBIDDEN',
        });
      }
      assertCoursePricing(
        dto.courseStart ? new Date(dto.courseStart) : null,
        dto.courseEnd ? new Date(dto.courseEnd) : null,
        dto.coursePrice ?? null,
      );
    }
  }

}

// PER_COURSE needs all three fields, and a run that ends after it starts.
function assertCoursePricing(
  courseStart: Date | null,
  courseEnd: Date | null,
  coursePrice: number | Prisma.Decimal | null,
): void {
  if (courseStart == null || courseEnd == null || coursePrice == null) {
    throw new BadRequestException({
      message: 'courseStart, courseEnd and coursePrice are all required when billingMode is PER_COURSE',
      code: 'CLASS_COURSE_FIELDS_REQUIRED',
    });
  }
  assertDateOrder(courseStart, courseEnd, {
    strict: true,
    message: 'courseEnd must be after courseStart',
    code: 'CLASS_COURSE_PERIOD_ORDER',
  });
}

