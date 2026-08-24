import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Prisma, UserRole, WaitlistMode, type WaitlistEntry } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { consumeCardVisits } from '@/cards/card-consumption';
import { selfServiceClosed } from '@/common/dates';
import { MailService } from '@/mail/mail.service';
import { isUniqueConstraintError } from '@/common/prisma-relations';
import { assertOwnTrainee, assertSelfServiceAllowed } from '@/common/self-service-guards';
import { PrismaService } from '@/prisma/prisma.service';
import { ClaimWaitlistDto } from './dto/claim-waitlist.dto';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { traineeRecipients } from './trainee-recipients';
import { sha256Hex } from './waitlist-claim';

// AC #4: every invalid-token shape (unknown, used, superseded, expired) gets the same
// answer, with no session details to disclose.
const claimGone = () =>
  new GoneException({ message: 'This claim link is no longer valid', code: 'WAITLIST_CLAIM_GONE' });

// TKT-0122: how long a queue entry outlives the start of its session. The customer stops
// seeing it the moment the session starts (`myWaitlist` in attendances.service.ts), so this
// window only governs how long staff can still answer "who was waiting for Tuesday?".
const STALE_WAITLIST_RETENTION_HOURS = 48;

@Injectable()
export class WaitlistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
    private readonly mail: MailService,
  ) {}

  /**
   * TKT-0114: the public claim door — the token is the authorization. First valid claim
   * books (count+insert transaction, visit consumed) and deletes the entry; the rest of
   * the opening answers 409 SPOT_TAKEN. Spot-filled mails go out after commit when the
   * claim refilled the session.
   */
  async claim(dto: ClaimWaitlistDto, now = new Date()) {
    const token = await this.prisma.waitlistClaimToken.findUnique({
      where: { tokenHash: sha256Hex(dto.token) },
      include: {
        session: {
          select: {
            id: true,
            tenantId: true,
            classId: true,
            startsAt: true,
            class: {
              select: { name: true, capacity: true, bookingCutoffMin: true },
            },
          },
        },
      },
    });
    if (!token) throw claimGone();
    const session = token.session;
    // TKT-0123: the same time rule every other self-service door reads, not just "has it started".
    // openClaimWindow refuses to mint tokens past the cutoff, but a token minted before it used to
    // keep booking after it — and this door is @Public() and spends a card visit. `selfServiceClosed`
    // with a null cutoff still closes at the start, so this subsumes the old check.
    // 410 rather than BOOKING_CLOSED on purpose: every invalid-token shape answers identically
    // here, with no session details to disclose (see claimGone above).
    if (selfServiceClosed(session.startsAt, session.class.bookingCutoffMin, now)) throw claimGone();

    let refilled: { traineeId: string }[] | null = null;
    try {
      refilled = await this.prisma.$transaction(async (tx) => {
        const capacity = session.class.capacity;
        const count = await tx.attendance.count({ where: { sessionId: session.id } });
        if (capacity !== null && count >= capacity) {
          throw new ConflictException({
            message: 'The spot has already been taken',
            code: 'SPOT_TAKEN',
          });
        }
        const entry = await tx.waitlistEntry.findUnique({ where: { id: token.entryId } });
        if (!entry) throw claimGone();
        const attendance = await tx.attendance.create({
          data: {
            tenantId: session.tenantId,
            sessionId: session.id,
            traineeId: entry.traineeId,
            status: AttendanceStatus.PENDING,
          },
        });
        await consumeCardVisits(tx, {
          tenantId: session.tenantId,
          classId: session.classId,
          bookings: [{ attendanceId: attendance.id, traineeId: entry.traineeId }],
          now,
        });
        // Cascades this token away — reuse answers 410.
        await tx.waitlistEntry.delete({ where: { id: entry.id } });
        const isFull = capacity !== null && count + 1 >= capacity;
        return isFull
          ? tx.waitlistEntry.findMany({
              where: { sessionId: session.id },
              select: { traineeId: true },
            })
          : null;
      });
    } catch (e) {
      // A racing claim/add landed the same trainee first — the spot story is the honest one.
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: 'The spot has already been taken',
          code: 'SPOT_TAKEN',
        });
      }
      throw e;
    }

    if (refilled) {
      await this.sendSpotFilledMails(session.class.name, session.startsAt, refilled);
    }
    return { claimed: true as const, className: session.class.name, startsAt: session.startsAt };
  }

  private async sendSpotFilledMails(
    className: string,
    startsAt: Date,
    entries: { traineeId: string }[],
  ): Promise<void> {
    for (const { traineeId } of entries) {
      const { traineeName, emails } = await traineeRecipients(this.prisma, traineeId);
      for (const to of emails) {
        try {
          await this.mail.sendWaitlistSpotFilled({ to, traineeName, className, startsAt });
        } catch {
          // Booking already committed; a dead mailbox is not the claimant's problem.
        }
      }
    }
  }

  async listForSession(tenantId: string, sessionId: string, viewer: AuthenticatedUser) {
    await this.assertSessionVisible(tenantId, sessionId, viewer);
    return this.prisma.waitlistEntry.findMany({
      where: { sessionId, tenantId },
      include: { trainee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async join(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    dto: CreateWaitlistEntryDto,
  ): Promise<WaitlistEntry> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);

    const trainee = await this.prisma.trainee.findFirst({
      where: { id: dto.traineeId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!trainee) throw new NotFoundException(`Trainee ${dto.traineeId} not found`);

    return this.queueTrainee(tenantId, sessionId, dto.traineeId);
  }

  /**
   * TKT-0121: the customer queue door. The self-service ladder (family, self-booking flag,
   * enrollment, cutoff) replaces the staff visibility check; the queue rules below are the
   * same ones, on the same row — a customer entry is indistinguishable from a staff entry, so
   * FIFO/claim promotion needs no knowledge of who created it.
   */
  async joinForCustomer(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    dto: CreateWaitlistEntryDto,
    now = new Date(),
  ): Promise<WaitlistEntry> {
    await assertSelfServiceAllowed(this.prisma, {
      tenantId,
      sessionId,
      viewer,
      traineeId: dto.traineeId,
      action: 'queue',
      now,
    });
    return this.queueTrainee(tenantId, sessionId, dto.traineeId);
  }

  /**
   * TKT-0121: the customer leave door. Deliberately ungated by the cutoff and the self-booking
   * flag — leaving a queue is always safe, and a trainee must never be stuck in one.
   */
  async leaveForCustomer(
    tenantId: string,
    sessionId: string,
    viewer: AuthenticatedUser,
    traineeId: string,
  ): Promise<void> {
    await assertOwnTrainee(this.prisma, { tenantId, traineeId, viewer, action: 'leave a queue' });
    const { count } = await this.prisma.waitlistEntry.deleteMany({
      where: { sessionId, tenantId, traineeId },
    });
    if (count === 0) {
      throw new NotFoundException(`Trainee ${traineeId} is not on the waitlist for ${sessionId}`);
    }
  }

  /** The queue rules, shared by both doors: mode, not-already-attending, full, one entry. */
  private async queueTrainee(
    tenantId: string,
    sessionId: string,
    traineeId: string,
  ): Promise<WaitlistEntry> {
    try {
      // Full-check and insert in one transaction, same idiom as the capacity gate in
      // addTrainee — two racing joins cannot both see a free spot.
      // ponytail: SQLite serializes writes; Postgres would want SELECT ... FOR UPDATE here.
      return await this.prisma.$transaction(async (tx) => {
        const session = await tx.session.findUniqueOrThrow({
          where: { id: sessionId },
          select: { class: { select: { capacity: true, waitlistMode: true } } },
        });
        if (session.class.waitlistMode === WaitlistMode.NONE) {
          throw new BadRequestException({
            message: 'This class has no waitlist',
            code: 'WAITLIST_DISABLED',
          });
        }
        const attending = await tx.attendance.count({
          where: { sessionId, traineeId },
        });
        if (attending > 0) {
          throw new ConflictException({
            message: 'Trainee is already on this session',
            code: 'ATTENDANCE_TRAINEE_ALREADY_ON_SESSION',
          });
        }
        // capacity null = unlimited = never full, so those classes can never queue (AC #6).
        const capacity = session.class.capacity;
        const count = await tx.attendance.count({ where: { sessionId } });
        if (capacity === null || count < capacity) {
          throw new BadRequestException({
            message: 'Session still has free spots — add the trainee directly',
            code: 'SESSION_NOT_FULL',
            params: { capacity, count },
          });
        }
        return tx.waitlistEntry.create({ data: { tenantId, sessionId, traineeId } });
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: 'Trainee is already on this waitlist',
          code: 'WAITLIST_TRAINEE_ALREADY_QUEUED',
        });
      }
      throw e;
    }
  }

  async remove(
    tenantId: string,
    sessionId: string,
    entryId: string,
    viewer: AuthenticatedUser,
  ): Promise<void> {
    await this.assertSessionVisible(tenantId, sessionId, viewer);
    const { count } = await this.prisma.waitlistEntry.deleteMany({
      where: { id: entryId, sessionId, tenantId },
    });
    if (count === 0) throw new NotFoundException(`Waitlist entry ${entryId} not found`);
  }

  /**
   * TKT-0122: delete queue entries whose session started more than the retention window ago.
   * Such an entry is provably dead — promotion and the claim door are both gated by the booking
   * cutoff (TKT-0120), so nothing can ever come of it — and `myWaitlist` already hides it from
   * the customer. This is the other half: removing the rows, which otherwise grow for ever.
   *
   * `WaitlistClaimToken.entry` cascades, so the tokens go with the entries — one statement, and
   * one statement is already atomic, so no `$transaction` wrapper.
   *
   * Deliberately platform-wide: no tenant filter and no viewer. A scheduled job has no tenant
   * context, so when this moves to a cron the body is this call and nothing else. `now` is
   * injectable for the tests, as `claim(dto, now)` already does.
   */
  async sweepStaleEntries(now = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - STALE_WAITLIST_RETENTION_HOURS * 3600_000);
    const { count } = await this.prisma.waitlistEntry.deleteMany({
      where: { session: { startsAt: { lt: cutoff } } },
    });
    return { deleted: count };
  }

  // Same visibility rule as attendances.service.ts — a trainer sees only sessions they
  // train; everyone else goes through the location scope.
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
