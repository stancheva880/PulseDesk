import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceRsvp,
  AttendanceStatus,
  Prisma,
  UserRole,
  type Attendance,
  type Trainee,
} from '@prisma/client';
import { assertBookingOpen } from '@/common/dates';
import { isUniqueConstraintError } from '@/common/prisma-relations';
import { assertOwnTrainee, assertSelfServiceAllowed } from '@/common/self-service-guards';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ConfigService } from '@nestjs/config';
import { consumeCardVisits, usableCardsByTrainee } from '@/cards/card-consumption';
import { MailService } from '@/mail/mail.service';
import { traineeRecipients } from '@/waitlists/trainee-recipients';
import { openClaimWindow, type ClaimOffer } from '@/waitlists/waitlist-claim';
import { promoteFromWaitlist, type PromotedTrainee } from '@/waitlists/waitlist-promotion';
import { resolveActorSnapshot } from '@/common/actor-snapshot';

// TKT-0108: a candidate row = the trainee, the card a booking would consume (null when
// none is usable), and whether they hold any card at all (the warning's trigger).
export type CandidateTrainee = Trainee & {
  card: {
    id: string;
    visitsRemaining: number;
    expiresAt: Date | null;
    classScoped: boolean;
  } | null;
  hasCards: boolean;
};
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
    private readonly mail: MailService,
    private readonly config: ConfigService,
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
  ): Promise<PaginatedResult<CandidateTrainee> & { spotsLeft: number | null }> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);
    const where: Prisma.TraineeWhereInput = {
      tenantId,
      isActive: true,
      // The exclusion the client used to do with a Set of already-rendered rows.
      attendances: { none: { sessionId } },
      ...(await this.scope.locationsWhere(viewer, tenantId)),
    };
    const p = normalizePagination(pagination);
    const [items, total, session] = await this.prisma.$transaction([
      this.prisma.trainee.findMany({
        where,
        // Same order as GET /trainees, so paging is stable and the picker reads alphabetically.
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.trainee.count({ where }),
      // TKT-0103: how many spots remain — the picker disables itself at zero.
      this.prisma.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
          classId: true,
          class: { select: { capacity: true } },
          _count: { select: { attendances: true } },
        },
      }),
    ]);

    // TKT-0108: the card a booking would consume (same rule as consumption), plus whether
    // the trainee holds any card at all — the picker warns only ex-card-holders.
    const traineeIds = items.map((t) => t.id);
    const cardsByTrainee = await usableCardsByTrainee(this.prisma, {
      tenantId,
      classId: session.classId,
      traineeIds,
    });
    const holders = traineeIds.length
      ? await this.prisma.card.groupBy({
          by: ['traineeId'],
          where: { tenantId, traineeId: { in: traineeIds } },
        })
      : [];
    const hasCardSet = new Set(holders.map((h) => h.traineeId));
    const withCards: CandidateTrainee[] = items.map((t) => {
      const best = cardsByTrainee.get(t.id)?.[0];
      return {
        ...t,
        card: best
          ? {
              id: best.id,
              visitsRemaining: best.remaining,
              expiresAt: best.expiresAt,
              classScoped: best.classScoped,
            }
          : null,
        hasCards: hasCardSet.has(t.id),
      };
    });

    const capacity = session.class.capacity;
    const spotsLeft =
      capacity === null ? null : Math.max(0, capacity - session._count.attendances);
    return { ...buildPaginatedResult(withCards, total, p), spotsLeft };
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

    const alreadyOnSession = () =>
      new ConflictException({
        message: 'Trainee is already on this session',
        code: 'ATTENDANCE_TRAINEE_ALREADY_ON_SESSION',
      });

    // TKT-0103: the manual door is hard-gated on class capacity — count and insert in one
    // transaction so two simultaneous adds cannot both pass the check. Every attendance row
    // counts, whatever its status or RSVP. Roster backfill deliberately bypasses this gate
    // (PRD-0014 decision: roster trumps capacity).
    //
    // TKT-0123: the duplicate check moved inside the transaction and gained the P2002 catch that
    // bookForCustomer and queueTrainee already had. Checking outside it left the
    // @@unique([sessionId, traineeId]) as the only real barrier for two simultaneous adds, and a
    // raw constraint violation answers 500 where the sequential case answers 409.
    try {
      return await this.prisma.$transaction(async (tx) => {
        // One attendance row per (session, trainee) — reject an explicit duplicate.
        const existing = await tx.attendance.findFirst({
          where: { sessionId, traineeId: dto.traineeId },
          select: { id: true },
        });
        if (existing) throw alreadyOnSession();

        const session = await tx.session.findUniqueOrThrow({
          where: { id: sessionId },
          select: { classId: true, class: { select: { capacity: true } } },
        });
        const capacity = session.class.capacity;
        if (capacity !== null) {
          const count = await tx.attendance.count({ where: { sessionId } });
          if (count >= capacity) {
            throw new ConflictException({
              message: `Session is full (${count}/${capacity})`,
              code: 'ATTENDANCE_SESSION_FULL',
              params: { capacity, count },
            });
          }
        }
        const attendance = await tx.attendance.create({
          data: {
            tenantId,
            sessionId,
            traineeId: dto.traineeId,
            status: AttendanceStatus.PENDING,
          },
        });
        // TKT-0107: a booking draws down the trainee's card in the same transaction.
        await consumeCardVisits(tx, {
          tenantId,
          classId: session.classId,
          bookings: [{ attendanceId: attendance.id, traineeId: dto.traineeId }],
        });
        return attendance;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) throw alreadyOnSession();
      throw e;
    }
  }

  /**
   * TKT-0118: the customer booking door. Same money choreography as the staff add
   * (consumeCardVisits in the same transaction, warn-never-block), gated by the class's
   * self-booking policy. The transaction mirrors the claim endpoint: duplicate check and
   * capacity recount inside, unique-constraint catch as the race backstop.
   */
  async bookForCustomer(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    dto: AddAttendanceDto,
    now = new Date(),
  ): Promise<Attendance> {
    const { classId, capacity } = await assertSelfServiceAllowed(this.prisma, {
      tenantId,
      sessionId,
      viewer,
      traineeId: dto.traineeId,
      action: 'book',
      now,
    });

    const alreadyOnSession = () =>
      new ConflictException({
        message: 'Trainee is already on this session',
        code: 'ATTENDANCE_TRAINEE_ALREADY_ON_SESSION',
      });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.attendance.findFirst({
          where: { sessionId, traineeId: dto.traineeId },
          select: { id: true },
        });
        if (existing) throw alreadyOnSession();
        if (capacity !== null) {
          const count = await tx.attendance.count({ where: { sessionId } });
          if (count >= capacity) {
            throw new ConflictException({
              message: `Session is full (${count}/${capacity})`,
              code: 'ATTENDANCE_SESSION_FULL',
              params: { capacity, count },
            });
          }
        }
        const attendance = await tx.attendance.create({
          data: {
            tenantId,
            sessionId,
            traineeId: dto.traineeId,
            status: AttendanceStatus.PENDING,
            // Booking yourself is the strongest possible RSVP (PRD-0016 decision).
            traineeRsvp: AttendanceRsvp.CONFIRMED,
          },
        });
        await consumeCardVisits(tx, {
          tenantId,
          classId,
          bookings: [{ attendanceId: attendance.id, traineeId: dto.traineeId }],
        });
        return attendance;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) throw alreadyOnSession();
      throw e;
    }
  }

  /**
   * TKT-0113: the unbooking door. The row's card visit returns via the CardConsumption
   * cascade; on a FIFO_AUTO class the freed spot immediately books the queue head in the
   * same transaction. Promotion mails go out after commit — a mail failure (or a trainee
   * with no address anywhere) never unwinds the booking.
   */
  async remove(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    attendanceId: string,
  ): Promise<void> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);
    await this.removeAndBackfill(
      tenantId,
      sessionId,
      { id: attendanceId, sessionId, tenantId },
      `Attendance ${attendanceId} not found`,
    );
  }

  /**
   * TKT-0119: the freeing-a-spot core, shared by the staff door above and the customer
   * cancel below. Delete, promote and open a claim window in one transaction; mail after
   * commit. The `where` decides which row dies — by id for staff, by trainee for a customer.
   */
  private async removeAndBackfill(
    tenantId: string,
    sessionId: string,
    where: Prisma.AttendanceWhereInput,
    notFoundMessage: string,
  ): Promise<void> {
    const { promoted, offers } = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.attendance.deleteMany({ where });
      if (deleted.count === 0) {
        throw new NotFoundException(notFoundMessage);
      }
      const promoted = await promoteFromWaitlist(tx, { tenantId, sessionId });
      // TKT-0114: on a CLAIM class the freed spot opens a claim window instead.
      const offers = await openClaimWindow(tx, { tenantId, sessionId });
      return { promoted, offers };
    });
    await this.sendPromotionMails(tenantId, sessionId, promoted);
    await this.sendClaimOffers(sessionId, offers);
  }

  /**
   * TKT-0119: the customer cancel door. Deliberately does **not** check `allowSelfBooking`:
   * a booking that exists stays cancellable even if the admin turned the flag off afterwards
   * (such a class carries a null cutoff, so cancelling stays open until the start). Applies to
   * any booking of the trainee, staff-created included — PRD-0016's decision.
   */
  async cancelForCustomer(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    traineeId: string,
    now = new Date(),
  ): Promise<void> {
    // Not the full self-service ladder: a booking that exists stays cancellable, so the flag
    // and enrollment checks deliberately do not run here — only family and the cutoff.
    await assertOwnTrainee(this.prisma, { tenantId, traineeId, viewer, action: 'cancel' });

    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, tenantId },
      select: { startsAt: true, class: { select: { bookingCutoffMin: true } } },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    assertBookingOpen(session.startsAt, session.class.bookingCutoffMin, now);

    await this.removeAndBackfill(
      tenantId,
      sessionId,
      { sessionId, tenantId, traineeId },
      `No booking for trainee ${traineeId} on session ${sessionId}`,
    );
  }

  private async sendPromotionMails(
    tenantId: string,
    sessionId: string,
    promoted: PromotedTrainee[],
  ): Promise<void> {
    if (promoted.length === 0) return;
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { startsAt: true, class: { select: { name: true } } },
    });
    // TKT-0129: concurrent, for the reasons in sendClaimOffers below.
    await Promise.allSettled(
      promoted.map(async ({ traineeId }) => {
        // Linked account wins; otherwise every contact with an address; none → skip.
        const { traineeName, emails } = await traineeRecipients(this.prisma, traineeId);
        await Promise.all(
          emails.map(async (to) => {
            try {
              await this.mail.sendWaitlistPromotion({
                to,
                traineeName,
                className: session.class.name,
                startsAt: session.startsAt,
              });
            } catch {
              // The booking is committed; a dead mailbox must not surface as a failed delete.
            }
          }),
        );
      }),
    );
  }

  // TKT-0114: the claim window is open; every queued trainee's people get the link.
  private async sendClaimOffers(sessionId: string, offers: ClaimOffer[]): Promise<void> {
    if (offers.length === 0) return;
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { startsAt: true, class: { select: { name: true } } },
    });
    const frontendUrl = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    // TKT-0129: one offer per queued entry, so this fans out with the queue. `allSettled`
    // on the outer level because traineeRecipients can reject and one unreadable trainee
    // must not cost the rest their link; the inner level is `all` because the catch below
    // means those promises cannot reject at all.
    await Promise.allSettled(
      offers.map(async (offer) => {
        const { traineeName, emails } = await traineeRecipients(this.prisma, offer.traineeId);
        await Promise.all(
          emails.map(async (to) => {
            try {
              await this.mail.sendWaitlistClaimOffer({
                to,
                traineeName,
                className: session.class.name,
                startsAt: session.startsAt,
                claimUrl: `${frontendUrl}/claim?token=${offer.token}`,
              });
            } catch {
              // The window is open regardless — a dead mailbox must not fail the delete.
            }
          }),
        );
      }),
    );
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

  async listCustomerSessions(
    tenantId: string,
    customerUserId: string,
    range?: { from?: string; to?: string },
  ) {
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

    // TKT-0102: a visible calendar window (from inclusive, to exclusive) replaces the list
    // cap — a bounded range is its own cap, and a truncated month would render as a lie.
    // Without a range the original capped behaviour stands.
    const hasRange = range?.from !== undefined || range?.to !== undefined;
    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId,
        class: { trainees: { some: traineeOwnership } },
        ...(hasRange
          ? {
              startsAt: {
                ...(range.from === undefined ? {} : { gte: new Date(range.from) }),
                ...(range.to === undefined ? {} : { lt: new Date(range.to) }),
              },
            }
          : {}),
      },
      include: {
        // TKT-0118: the self-booking policy pair travels; capacity is fetched only to compute
        // spotsLeft below and never leaves the server. `trainees` is the family ∩ roster —
        // the people a Book button may appear for.
        class: {
          select: {
            id: true,
            name: true,
            allowSelfBooking: true,
            bookingCutoffMin: true,
            // TKT-0121: NONE means a full session is simply full — the portal says so instead
            // of offering a queue.
            waitlistMode: true,
            capacity: true,
            trainees: {
              where: traineeOwnership,
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        location: { select: { id: true, name: true } },
        // TKT-0121: the family's own queue entries — same server-side filter as attendances.
        waitlistEntries: { where: { trainee: traineeOwnership }, select: { traineeId: true } },
        attendances: {
          where: { trainee: traineeOwnership },
          include: {
            trainee: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        _count: { select: { attendances: true } },
      },
      orderBy: { startsAt: 'asc' },
      ...(hasRange ? {} : { take: DEFAULT_LIST_TAKE }),
    });
    // TKT-0122: a queue entry on a session that has started is dead — promotion is gated by the
    // cutoff (TKT-0120), so nothing can ever come of it. Report it as no queue position rather
    // than showing the portal a badge and a Leave button that mean nothing. The rows themselves
    // still need a sweep; that is the rest of TKT-0122.
    const startedBefore = Date.now();
    return sessions.map(({ _count, class: cls, waitlistEntries, ...session }) => ({
      ...session,
      class: {
        id: cls.id,
        name: cls.name,
        allowSelfBooking: cls.allowSelfBooking,
        bookingCutoffMin: cls.bookingCutoffMin,
        waitlistMode: cls.waitlistMode,
      },
      myTrainees: cls.trainees,
      // Ids only — the names travel once, in myTrainees.
      myWaitlist:
        session.startsAt.getTime() > startedBefore
          ? waitlistEntries.map((e) => e.traineeId)
          : [],
      spotsLeft: cls.capacity === null ? null : Math.max(0, cls.capacity - _count.attendances),
    }));
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

