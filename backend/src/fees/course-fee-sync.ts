import type { Prisma } from '@prisma/client';
import { BillingMode } from '@prisma/client';

/**
 * Course-fee automation (TKT-0110): every enrollment path calls these inside its own
 * transaction — the same seam as attendance-backfill.ts, and for the same reason: the
 * roster write and its money consequence commit or roll back together, with no DI and
 * no module cycle.
 *
 * Both functions read the class row in-tx and no-op unless it is PER_COURSE with all
 * three course fields set, so callers invoke them unconditionally per touched class.
 * Money rows are history: date/price edits never rewrite existing fees — creation
 * always bills the class's *current* values, and the dedupe identity is
 * (trainee × class × exact period, sessionId null).
 */
export async function createCourseFees(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; classId: string; traineeIds: string[] },
): Promise<void> {
  if (params.traineeIds.length === 0) return;
  const cls = await courseClass(tx, params.classId);
  if (!cls) return;

  const existing = await tx.fee.findMany({
    where: {
      tenantId: params.tenantId,
      classId: params.classId,
      traineeId: { in: params.traineeIds },
      periodStart: cls.courseStart,
      periodEnd: cls.courseEnd,
      sessionId: null,
    },
    select: { traineeId: true },
  });
  const billed = new Set(existing.map((f) => f.traineeId));

  const toCreate = params.traineeIds
    .filter((id) => !billed.has(id))
    .map((traineeId) => ({
      tenantId: params.tenantId,
      classId: params.classId,
      traineeId,
      periodStart: cls.courseStart,
      periodEnd: cls.courseEnd,
      amount: cls.coursePrice,
    }));
  if (toCreate.length) await tx.fee.createMany({ data: toCreate });
}

/**
 * Unenrollment before the course starts takes the untouched fee back with it; anything
 * with a payment or a refund — or from an already-started or since-edited period — stays.
 */
export async function deleteUnpaidCourseFees(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; classId: string; traineeIds: string[]; now?: Date },
): Promise<void> {
  if (params.traineeIds.length === 0) return;
  const cls = await courseClass(tx, params.classId);
  if (!cls) return;
  const now = params.now ?? new Date();
  if (now.getTime() >= cls.courseStart.getTime()) return;

  await tx.fee.deleteMany({
    where: {
      tenantId: params.tenantId,
      classId: params.classId,
      traineeId: { in: params.traineeIds },
      periodStart: cls.courseStart,
      periodEnd: cls.courseEnd,
      sessionId: null,
      payments: { none: {} },
      refunds: { none: {} },
    },
  });
}

async function courseClass(tx: Prisma.TransactionClient, classId: string) {
  const cls = await tx.class.findUnique({
    where: { id: classId },
    select: {
      billingMode: true,
      courseStart: true,
      courseEnd: true,
      coursePrice: true,
    },
  });
  if (
    !cls ||
    cls.billingMode !== BillingMode.PER_COURSE ||
    cls.courseStart == null ||
    cls.courseEnd == null ||
    cls.coursePrice == null
  ) {
    return null;
  }
  return cls as { courseStart: Date; courseEnd: Date; coursePrice: Prisma.Decimal } & typeof cls;
}
