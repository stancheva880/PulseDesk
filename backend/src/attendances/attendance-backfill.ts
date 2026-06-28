import { AttendanceStatus, Prisma, SessionStatus } from '@prisma/client';

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
  const traineeIds = [...new Set(params.traineeIds)];
  if (traineeIds.length === 0) return;

  const sessions = await tx.session.findMany({
    where: {
      tenantId: params.tenantId,
      classId: params.classId,
      status: SessionStatus.SCHEDULED,
      startsAt: { gte: params.now ?? new Date() },
    },
    select: { id: true },
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
  if (data.length > 0) await tx.attendance.createMany({ data });
}
