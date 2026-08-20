import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Prisma, UserRole, type Attendance, type Trainee } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { resolveActorSnapshot } from '@/common/actor-snapshot';
import {
  buildPaginatedResult,
  normalizePagination,
  DEFAULT_LIST_TAKE,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { AddAttendanceDto } from './dto/add-attendance.dto';
import type { BulkMarkAttendancesDto } from './dto/bulk-mark-attendances.dto';
import type { RsvpDto } from './dto/rsvp.dto';

// The row shape the attendance screen renders: the audit row plus the trainee's name, so
// a client never has to resolve traineeId against a separately-paged trainee list.
// Same select listCustomerSessions already uses for its nested attendances.
const ATTENDANCE_WITH_TRAINEE = {
  trainee: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AttendanceInclude;

export type AttendanceWithTrainee = Prisma.AttendanceGetPayload<{
  include: typeof ATTENDANCE_WITH_TRAINEE;
}>;

@Injectable()
export class AttendancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async listForSession(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
  ): Promise<AttendanceWithTrainee[]> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);
    return this.prisma.attendance.findMany({
      where: { sessionId, tenantId },
      include: ATTENDANCE_WITH_TRAINEE,
      orderBy: { traineeId: 'asc' },
      take: DEFAULT_LIST_TAKE,
    });
  }

  /**
   * The trainees who may still be added to this session: active, in the tenant, inside the
   * viewer's location scope, and without an attendance row for the session already.
   *
   * It exists because the screen could not ask for this. It used to page every trainee in the club
   * on every session open and apply both filters in the browser (TKT-0038's deferred follow-up),
   * and no `pageSize` could help, because neither filter existed server-side.
   *
   * Session visibility comes first and uses the same `assertSessionVisible` as every other route
   * here, so a trainer cannot enumerate a club's trainees through a session they do not work — the
   * 404 lands before any trainee is read. Trainee visibility then uses `locationsWhere`, the same
   * helper `GET /trainees` uses, which is what keeps this endpoint from widening the scope
   * TKT-0054 deliberately narrowed.
   */
  async listCandidates(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<Trainee>> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);
    const where: Prisma.TraineeWhereInput = {
      tenantId,
      isActive: true,
      // The exclusion the client used to do with a Set of already-rendered rows.
      attendances: { none: { sessionId } },
      ...(await this.scope.locationsWhere(viewer, tenantId)),
    };
    const p = normalizePagination(pagination);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trainee.findMany({
        where,
        // Same order as GET /trainees, so paging is stable and the picker reads alphabetically.
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.trainee.count({ where }),
    ]);
    return buildPaginatedResult(items, total, p);
  }

  async bulkMark(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    dto: BulkMarkAttendancesDto,
  ): Promise<{ updated: number }> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);

    // Resolve audit-snapshot fields once per call (the marker user is the viewer).
    const marker = await resolveActorSnapshot(this.prisma, viewer.id, 'Marker user not found');
    const markedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Pre-validate so we can roll back before issuing any writes if a traineeId
      // is unknown for this session. One SELECT instead of N per-item count checks.
      const existing = await tx.attendance.findMany({
        where: { sessionId, tenantId },
        select: { traineeId: true },
      });
      const knownTraineeIds = new Set(existing.map((row) => row.traineeId));
      for (const item of dto.items) {
        if (!knownTraineeIds.has(item.traineeId)) {
          throw new NotFoundException(
            `Attendance for trainee ${item.traineeId} not found on session ${sessionId}`,
          );
        }
      }

      const auditFields = {
        markedAt,
        markedById: viewer.id,
        markedByEmailSnapshot: marker.email,
        markedByNameSnapshot: marker.nameSnapshot,
      };

      // Partition the batch: items without notes can be coalesced by status into
      // a single updateMany; items carrying notes need their own update because
      // updateMany cannot vary `notes` per row.
      const withNotes: typeof dto.items = [];
      const noteFreeByStatus = new Map<AttendanceStatus, string[]>();
      for (const item of dto.items) {
        if (item.notes !== undefined && item.notes !== null) {
          withNotes.push(item);
          continue;
        }
        const bucket = noteFreeByStatus.get(item.status) ?? [];
        bucket.push(item.traineeId);
        noteFreeByStatus.set(item.status, bucket);
      }

      let updated = 0;
      for (const [status, traineeIds] of noteFreeByStatus) {
        const result = await tx.attendance.updateMany({
          where: { sessionId, tenantId, traineeId: { in: traineeIds } },
          data: { status, ...auditFields },
        });
        updated += result.count;
      }
      for (const item of withNotes) {
        const result = await tx.attendance.updateMany({
          where: { sessionId, tenantId, traineeId: item.traineeId },
          data: { status: item.status, notes: item.notes, ...auditFields },
        });
        updated += result.count;
      }
      return { updated };
    });
  }

  async addTrainee(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    dto: AddAttendanceDto,
  ): Promise<Attendance> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);

    // Any active trainee in the tenant may be added (supports drop-ins not in the class).
    const trainee = await this.prisma.trainee.findFirst({
      where: { id: dto.traineeId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!trainee) {
      throw new NotFoundException(`Trainee ${dto.traineeId} not found`);
    }

    // One attendance row per (session, trainee) — reject an explicit duplicate.
    const existing = await this.prisma.attendance.findFirst({
      where: { sessionId, traineeId: dto.traineeId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Trainee is already on this session',
        code: 'ATTENDANCE_TRAINEE_ALREADY_ON_SESSION',
      });
    }

    return this.prisma.attendance.create({
      data: {
        tenantId,
        sessionId,
        traineeId: dto.traineeId,
        status: AttendanceStatus.PENDING,
      },
    });
  }

  async rsvp(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    dto: RsvpDto,
  ): Promise<Attendance> {
    // Existence + tenant scoping check.
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

    // Authorization: viewer must be the trainee's user OR one of its guardians.
    const trainee = await this.prisma.trainee.findFirst({
      where: {
        id: dto.traineeId,
        tenantId,
        OR: [
          { userId: viewer.id },
          { guardians: { some: { id: viewer.id } } },
        ],
      },
      select: { id: true },
    });
    if (!trainee) {
      throw new ForbiddenException('You may only RSVP for your own trainees');
    }

    // The session was already tenant-checked above, so the compound unique is enough
    // to scope the write. P2025 (no such row) keeps the 404 the old count check gave.
    try {
      return await this.prisma.attendance.update({
        where: { sessionId_traineeId: { sessionId, traineeId: dto.traineeId } },
        data: { traineeRsvp: dto.traineeRsvp },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Attendance row not found for this session/trainee');
      }
      throw e;
    }
  }

  async listCustomerSessions(tenantId: string, customerUserId: string) {
    // Sessions whose class enrolls a trainee owned by or guarded by this customer,
    // enriched with class/location and the *customer's own* attendance rows. Per-session
    // attendance is server-side filtered to only the customer's trainees so the portal
    // never sees rows for other people's children.
    const traineeOwnership: Prisma.TraineeWhereInput = {
      tenantId,
      OR: [
        { userId: customerUserId },
        { guardians: { some: { id: customerUserId } } },
      ],
    };

    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        class: { trainees: { some: traineeOwnership } },
      },
      include: {
        class: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        attendances: {
          where: { trainee: traineeOwnership },
          include: {
            trainee: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: DEFAULT_LIST_TAKE,
    });
    return sessions;
  }

  // --- internal ---

  private async assertSessionVisible(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
  ): Promise<void> {
    const where: Prisma.SessionWhereInput = { id: sessionId, tenantId };
    if (viewer.role === UserRole.EMPLOYEE) {
      where.trainers = { some: { id: viewer.id } };
    } else {
      Object.assign(where, await this.scope.locationWhere(viewer, tenantId));
    }
    const found = await this.prisma.session.count({ where });
    if (!found) throw new NotFoundException(`Session ${sessionId} not found`);
  }
}
