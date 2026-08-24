import type { Prisma } from '@prisma/client';

/**
 * Draw one card visit per booking (TKT-0107). A booking is an attendance row being
 * created — manual add, enrolment backfill, or session generation all call this inside
 * their own transaction, so the visit and the booking commit or roll back together.
 *
 * A usable card is not cancelled, not expired at booking time, has visits remaining,
 * and matches the class (its classId is null = tenant-wide, or equals the session's).
 * When several are usable: class-scoped before tenant-wide, then earliest expiry
 * (never-expiring last), then oldest purchase. Bookings with no usable card simply get
 * no consumption row — booking is never blocked by an empty card (warn-allow).
 *
 * The visit returns when the attendance row dies: CardConsumption.attendanceId cascades,
 * so every delete path (and any future endpoint) gives the visit back with zero code.
 *
 * Runs against a transaction client, same pattern as attendance-backfill.ts.
 */
export interface UsableCard {
  id: string;
  remaining: number;
  expiresAt: Date | null;
  classScoped: boolean;
}

/**
 * The usable cards per trainee, best first — the single source of "which card would a
 * booking consume". Shared by consumption (TKT-0107) and the candidates' card info
 * (TKT-0108) so the picker's warning can never disagree with what booking actually does.
 * Accepts a transaction client or the plain PrismaClient (structurally compatible).
 */
export async function usableCardsByTrainee(
  db: Prisma.TransactionClient,
  params: { tenantId: string; classId: string; traineeIds: string[]; now?: Date },
): Promise<Map<string, UsableCard[]>> {
  const byTrainee = new Map<string, UsableCard[]>();
  if (params.traineeIds.length === 0) return byTrainee;
  const now = params.now ?? new Date();

  const cards = await db.card.findMany({
    where: {
      tenantId: params.tenantId,
      traineeId: { in: params.traineeIds },
      cancelledAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      AND: { OR: [{ classId: null }, { classId: params.classId }] },
    },
    include: { _count: { select: { consumptions: true } } },
  });

  // Few cards per trainee — pick order in code instead of provider-specific nulls ordering.
  const rank = (c: (typeof cards)[number]) =>
    [
      c.classId === null ? 1 : 0, // class-scoped first
      c.expiresAt?.getTime() ?? Infinity, // earliest expiry first, never-expiring last
      c.createdAt.getTime(),
      c.id,
    ] as const;
  for (const card of cards.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return (
      ra[0] - rb[0] ||
      ra[1] - rb[1] ||
      ra[2] - rb[2] ||
      (ra[3] < rb[3] ? -1 : ra[3] > rb[3] ? 1 : 0)
    );
  })) {
    const remaining = card.totalVisits - card._count.consumptions;
    if (remaining <= 0) continue;
    const list = byTrainee.get(card.traineeId) ?? [];
    list.push({
      id: card.id,
      remaining,
      expiresAt: card.expiresAt,
      classScoped: card.classId !== null,
    });
    byTrainee.set(card.traineeId, list);
  }
  return byTrainee;
}

export async function consumeCardVisits(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    classId: string;
    bookings: { attendanceId: string; traineeId: string }[];
    now?: Date;
  },
): Promise<void> {
  if (params.bookings.length === 0) return;
  const byTrainee = await usableCardsByTrainee(tx, {
    tenantId: params.tenantId,
    classId: params.classId,
    traineeIds: [...new Set(params.bookings.map((b) => b.traineeId))],
    now: params.now,
  });

  const rows: Prisma.CardConsumptionCreateManyInput[] = [];
  for (const booking of params.bookings) {
    const candidates = byTrainee.get(booking.traineeId);
    const card = candidates?.find((c) => c.remaining > 0);
    if (!card) continue;
    card.remaining -= 1;
    rows.push({
      tenantId: params.tenantId,
      cardId: card.id,
      attendanceId: booking.attendanceId,
    });
  }
  if (rows.length > 0) await tx.cardConsumption.createMany({ data: rows });
}
