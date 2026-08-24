import { AttendanceStatus, Prisma, SessionStatus } from '@prisma/client';
import { consumeCardVisits } from '@/cards/card-consumption';

/**
 * Create PENDING attendance rows for the given trainees on a class's FUTURE,
 * still-SCHEDULED sessions. Session creation only auto-enrols the trainees that are
 * in the class at that moment, so enrolling someone later needs this to put them on
 * upcoming sessions. Past / COMPLETED / CANCELLED sessions are intentionally left
 * untouched so historical attendance is not rewritten.
 *
 * Idempotent: existing (sessionId, traineeId) rows are skipped. We dedupe in code
 * rather than with `createMany({ skipDuplicates })` because SQLite does not support
 * that option (the schema is kept portable per the project conventions).
 *
 * Runs against a transaction client so it commits atomically with the enrolment write.
 */
export async function backfillFutureSessions(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; classId: string; traineeIds: string[]; now?: Date },
): Promise<void> {
  const requested = [...new Set(params.traineeIds)];
  if (requested.length === 0) return;

  // TKT-0123: active trainees only, the same rule session creation and the manual add apply.
  // An archived trainee put back on a roster would otherwise be booked into every upcoming
  // session, each booking drawing a visit off a card nobody is using any more.
  const traineeIds = (
    await tx.trainee.findMany({
      where: { id: { in: requested }, tenantId: params.tenantId, isActive: true },
      select: { id: true },
    })
  ).map((t) => t.id);
  if (traineeIds.length === 0) return;

  const sessions = await tx.session.findMany({
    where: {
      tenantId: params.tenantId,
      classId: params.classId,
      status: SessionStatus.SCHEDULED,
      startsAt: { gte: params.now ?? new Date() },
    },
    select: { id: true },
    // TKT-0107: card visits are allocated in this order — earliest session first.
    orderBy: { startsAt: 'asc' },
  });
  if (sessions.length === 0) return;

  const existing = await tx.attendance.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) }, traineeId: { in: traineeIds } },
    select: { sessionId: true, traineeId: true },
  });
  const have = new Set(existing.map((e) => `${e.sessionId}|${e.traineeId}`));

  const data = sessions.flatMap((s) =>
    traineeIds
      .filter((traineeId) => !have.has(`${s.id}|${traineeId}`))
      .map((traineeId) => ({
        tenantId: params.tenantId,
        sessionId: s.id,
        traineeId,
        status: AttendanceStatus.PENDING,
      })),
  );
  if (data.length === 0) return;
  await tx.attendance.createMany({ data });

  // TKT-0107: each backfilled booking draws down the trainee's card. createMany returns
  // no ids (and createManyAndReturn is not MySQL-portable), so fetch the new rows once.
  const created = await tx.attendance.findMany({
    where: {
      sessionId: { in: sessions.map((s) => s.id) },
      traineeId: { in: traineeIds },
    },
    select: { id: true, sessionId: true, traineeId: true },
  });
  const idByKey = new Map(created.map((a) => [`${a.sessionId}|${a.traineeId}`, a.id]));
  // `data` preserves the earliest-session-first order the visits are allocated in.
  const bookings = data.flatMap((d) => {
    const attendanceId = idByKey.get(`${d.sessionId}|${d.traineeId}`);
    return attendanceId ? [{ attendanceId, traineeId: d.traineeId }] : [];
  });
  await consumeCardVisits(tx, { tenantId: params.tenantId, classId: params.classId, bookings });
}
