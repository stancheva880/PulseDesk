import { AttendanceStatus, Prisma, WaitlistMode } from '@prisma/client';
import { consumeCardVisits } from '@/cards/card-consumption';
import { selfServiceClosed } from '@/common/dates';

export interface PromotedTrainee {
  traineeId: string;
  attendanceId: string;
}

/**
 * FIFO auto-promotion (TKT-0113): book queue heads onto freed spots. Runs against the
 * caller's transaction client (attendance-backfill pattern), so the freeing delete, the
 * entry delete, the booking and its card-visit consumption commit or roll back together.
 *
 * Only FIFO_AUTO drains here — CLAIM waits for TKT-0114's claim flow, NONE cannot queue.
 * Promotes at most (capacity − attendanceCount) trainees, oldest entry first; an over-full
 * session (roster-backfill overflow) that is still at or above capacity promotes nobody.
 * Each promotion is a booking: it consumes a card visit with no staff click — that is the
 * mode's documented contract.
 *
 * TKT-0120: nobody is booked once self-service has closed (`now ≥ startsAt − cutoff`, so a
 * started session always). A spot freed that late simply stays free for staff to fill.
 */
export async function promoteFromWaitlist(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; sessionId: string; now?: Date },
): Promise<PromotedTrainee[]> {
  const now = params.now ?? new Date();
  const session = await tx.session.findUniqueOrThrow({
    where: { id: params.sessionId },
    select: {
      classId: true,
      startsAt: true,
      class: { select: { capacity: true, waitlistMode: true, bookingCutoffMin: true } },
    },
  });
  if (session.class.waitlistMode !== WaitlistMode.FIFO_AUTO) return [];
  if (selfServiceClosed(session.startsAt, session.class.bookingCutoffMin, now)) return [];
  const capacity = session.class.capacity;
  if (capacity === null) return [];

  const promoted: PromotedTrainee[] = [];
  let count = await tx.attendance.count({ where: { sessionId: params.sessionId } });
  while (count < capacity) {
    const entry = await tx.waitlistEntry.findFirst({
      where: { sessionId: params.sessionId },
      orderBy: { createdAt: 'asc' },
    });
    if (!entry) break;
    await tx.waitlistEntry.delete({ where: { id: entry.id } });
    const attendance = await tx.attendance.create({
      data: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        traineeId: entry.traineeId,
        status: AttendanceStatus.PENDING,
      },
    });
    await consumeCardVisits(tx, {
      tenantId: params.tenantId,
      classId: session.classId,
      bookings: [{ attendanceId: attendance.id, traineeId: entry.traineeId }],
      now,
    });
    promoted.push({ traineeId: entry.traineeId, attendanceId: attendance.id });
    count += 1;
  }
  return promoted;
}
