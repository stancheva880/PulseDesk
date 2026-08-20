import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceStatus,
  Prisma,
  UserRole,
  type Session,
} from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { assertDateOrder } from '@/common/dates';
import {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import {
  assertClassInTenant,
  assertLocationInTenant,
  assertTrainerIds,
} from '@/common/tenant-guards';
import type { CreateSessionDto } from './dto/create-session.dto';
import type { UpdateSessionDto } from './dto/update-session.dto';

export interface SessionListFilters {
  /** Inclusive. */
  startsAtFrom?: string;
  /** Exclusive — see ListSessionsQueryDto. */
  startsAtBefore?: string;
}

// Internal shape for callers (e.g., ClassSchedulesService) that have already validated FKs
// and want to create sessions inside their own transaction without re-running validation.
export interface InternalSessionCreate {
  tenantId: string;
  classId: string;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  // If undefined, defaults to the class's current trainer roster.
  trainerIds?: string[];
  notes?: string | null;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(
    tenantId: string,
    viewer: AuthenticatedUser,
    pagination?: PaginationInput,
    filters?: SessionListFilters,
  ): Promise<PaginatedResult<Session>> {
    let where: Prisma.SessionWhereInput;
    if (viewer.role === UserRole.EMPLOYEE) {
      where = { tenantId, trainers: { some: { id: viewer.id } } };
    } else {
      where = { tenantId, ...(await this.scope.locationWhere(viewer, tenantId)) };
    }
    // gte/lt, not gte/lte: startsAtBefore is exclusive, so a caller asking for one week cannot
    // count the next week's first session as well.
    if (filters?.startsAtFrom !== undefined || filters?.startsAtBefore !== undefined) {
      where.startsAt = {
        ...(filters.startsAtFrom === undefined ? {} : { gte: new Date(filters.startsAtFrom) }),
        ...(filters.startsAtBefore === undefined ? {} : { lt: new Date(filters.startsAtBefore) }),
      };
    }
    const p = normalizePagination(pagination);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.session.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.session.count({ where }),
    ]);
    return buildPaginatedResult(items, total, p);
  }

  async findById(tenantId: string, id: string, viewer: AuthenticatedUser) {
    const where: Prisma.SessionWhereInput = { id, tenantId };
    if (viewer.role === UserRole.EMPLOYEE) {
      where.trainers = { some: { id: viewer.id } };
    } else {
      Object.assign(where, await this.scope.locationWhere(viewer, tenantId));
    }
    const session = await this.prisma.session.findFirst({
      where,
      include: {
        class: { select: { id: true, name: true, billingMode: true } },
        location: { select: { id: true, name: true } },
        trainers: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  async create(
    tenantId: string,
    dto: CreateSessionDto,
    user: AuthenticatedUser,
  ): Promise<Session> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    assertTimeRange(startsAt, endsAt);

    // Validate FK references in the same tenant + check trainer roles in one go.
    await assertClassInTenant(this.prisma, tenantId, dto.classId);
    await assertLocationInTenant(this.prisma, tenantId, dto.locationId);
    await this.scope.assertLocationsAllowed(user, tenantId, [dto.locationId]);
    if (dto.trainerIds) await assertTrainerIds(this.prisma, tenantId, dto.trainerIds);

    return this.prisma.$transaction((tx) =>
      this.createInTransaction(tx, {
        tenantId,
        classId: dto.classId,
        locationId: dto.locationId,
        startsAt,
        endsAt,
        trainerIds: dto.trainerIds,
        notes: dto.notes ?? null,
      }),
    );
  }

  // Used by ClassSchedulesService.generateSessions — caller already validated FKs and
  // owns the transaction. Auto-attendance still runs.
  async createInTransaction(
    tx: Prisma.TransactionClient,
    data: InternalSessionCreate,
  ): Promise<Session> {
    // Resolve effective trainer roster: explicit override → use it; otherwise default
    // from the class's current trainers.
    let effectiveTrainerIds: string[];
    if (data.trainerIds !== undefined) {
      effectiveTrainerIds = data.trainerIds;
    } else {
      const cls = await tx.class.findUnique({
        where: { id: data.classId },
        select: { trainers: { select: { id: true } } },
      });
      effectiveTrainerIds = cls?.trainers.map((t) => t.id) ?? [];
    }

    const session = await tx.session.create({
      data: {
        tenantId: data.tenantId,
        classId: data.classId,
        locationId: data.locationId,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        notes: data.notes ?? null,
        trainers: effectiveTrainerIds.length
          ? { connect: effectiveTrainerIds.map((id) => ({ id })) }
          : undefined,
      },
    });

    // Auto-attendance — one PENDING row per current class trainee.
    const enrolled = await tx.trainee.findMany({
      where: { classes: { some: { id: data.classId } } },
      select: { id: true },
    });
    if (enrolled.length) {
      await tx.attendance.createMany({
        data: enrolled.map((t) => ({
          tenantId: data.tenantId,
          sessionId: session.id,
          traineeId: t.id,
          status: AttendanceStatus.PENDING,
        })),
      });
    }

    return session;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateSessionDto,
    user: AuthenticatedUser,
  ): Promise<Session> {
    const existing = await this.prisma.session.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Session ${id} not found`);
    await this.scope.assertLocationsAllowed(user, tenantId, [existing.locationId]);

    const newStartsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const newEndsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;
    assertTimeRange(newStartsAt, newEndsAt);

    if (dto.locationId !== undefined) {
      await assertLocationInTenant(this.prisma, tenantId, dto.locationId);
      await this.scope.assertLocationsAllowed(user, tenantId, [dto.locationId]);
    }
    if (dto.trainerIds !== undefined) {
      await assertTrainerIds(this.prisma, tenantId, dto.trainerIds);
    }

    const data: Prisma.SessionUpdateInput = {};
    if (dto.locationId !== undefined) {
      data.location = { connect: { id: dto.locationId } };
    }
    if (dto.startsAt !== undefined) data.startsAt = newStartsAt;
    if (dto.endsAt !== undefined) data.endsAt = newEndsAt;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.trainerIds !== undefined) {
      data.trainers = { set: dto.trainerIds.map((tid) => ({ id: tid })) };
    }

    return this.prisma.session.update({ where: { id }, data });
  }

  async delete(tenantId: string, id: string, user: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.session.findFirst({
      where: { id, tenantId },
      select: { locationId: true },
    });
    if (!existing) throw new NotFoundException(`Session ${id} not found`);
    await this.scope.assertLocationsAllowed(user, tenantId, [existing.locationId]);
    await this.prisma.session.delete({ where: { id } });
  }

}

function assertTimeRange(startsAt: Date, endsAt: Date): void {
  assertDateOrder(startsAt, endsAt, {
    strict: true,
    message: 'endsAt must be after startsAt',
    code: 'SESSION_END_BEFORE_START',
  });
}
