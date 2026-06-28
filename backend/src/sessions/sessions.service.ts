import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  Prisma,
  UserRole,
  type Session,
} from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateSessionDto } from './dto/create-session.dto';
import type { UpdateSessionDto } from './dto/update-session.dto';

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

  async list(tenantId: string, viewer: AuthenticatedUser): Promise<Session[]> {
    if (viewer.role === UserRole.EMPLOYEE) {
      return this.prisma.session.findMany({
        where: { tenantId, trainers: { some: { id: viewer.id } } },
        orderBy: { startsAt: 'asc' },
        take: DEFAULT_LIST_TAKE,
      });
    }
    const allowedIds = await this.scope.getAccessibleLocationIds(viewer, tenantId);
    return this.prisma.session.findMany({
      where: {
        tenantId,
        ...(allowedIds === null ? {} : { locationId: { in: allowedIds } }),
      },
      orderBy: { startsAt: 'asc' },
      take: DEFAULT_LIST_TAKE,
    });
  }

  async findById(tenantId: string, id: string, viewer: AuthenticatedUser) {
    const where: Prisma.SessionWhereInput = { id, tenantId };
    if (viewer.role === UserRole.EMPLOYEE) {
      where.trainers = { some: { id: viewer.id } };
    } else {
      const allowedIds = await this.scope.getAccessibleLocationIds(viewer, tenantId);
      if (allowedIds !== null) where.locationId = { in: allowedIds };
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
    user?: AuthenticatedUser,
  ): Promise<Session> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    assertTimeRange(startsAt, endsAt);

    // Validate FK references in the same tenant + check trainer roles in one go.
    await this.assertClassInTenant(tenantId, dto.classId);
    await this.assertLocationInTenant(tenantId, dto.locationId);
    if (user) await this.scope.assertLocationAllowed(user, tenantId, dto.locationId);
    if (dto.trainerIds) await this.assertTrainerIds(tenantId, dto.trainerIds);

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
    user?: AuthenticatedUser,
  ): Promise<Session> {
    const existing = await this.prisma.session.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Session ${id} not found`);
    if (user) {
      await this.scope.assertLocationAllowed(user, tenantId, existing.locationId);
    }

    const newStartsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const newEndsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;
    assertTimeRange(newStartsAt, newEndsAt);

    if (dto.locationId !== undefined) {
      await this.assertLocationInTenant(tenantId, dto.locationId);
      if (user) await this.scope.assertLocationAllowed(user, tenantId, dto.locationId);
    }
    if (dto.trainerIds !== undefined) {
      await this.assertTrainerIds(tenantId, dto.trainerIds);
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

  async delete(tenantId: string, id: string, user?: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.session.findFirst({
      where: { id, tenantId },
      select: { locationId: true },
    });
    if (!existing) throw new NotFoundException(`Session ${id} not found`);
    if (user) await this.scope.assertLocationAllowed(user, tenantId, existing.locationId);
    await this.prisma.session.delete({ where: { id } });
  }

  // ---- internal validators ----

  private async assertClassInTenant(tenantId: string, classId: string): Promise<void> {
    const found = await this.prisma.class.count({ where: { id: classId, tenantId } });
    if (!found) {
      throw new BadRequestException('classId is invalid or not in your tenant');
    }
  }

  private async assertLocationInTenant(tenantId: string, locationId: string): Promise<void> {
    const found = await this.prisma.location.count({ where: { id: locationId, tenantId } });
    if (!found) {
      throw new BadRequestException('locationId is invalid or not in your tenant');
    }
  }

  private async assertTrainerIds(tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.user.count({
      where: { id: { in: ids }, tenantId, role: UserRole.EMPLOYEE },
    });
    if (found !== ids.length) {
      throw new BadRequestException('Some trainerIds are not employees in your tenant');
    }
  }
}

function assertTimeRange(startsAt: Date, endsAt: Date): void {
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt.getTime() <= startsAt.getTime()
  ) {
    throw new BadRequestException('endsAt must be after startsAt');
  }
}
