import { createHash, randomBytes } from 'node:crypto';
import { Prisma, WaitlistMode } from '@prisma/client';
import { selfServiceClosed } from '@/common/dates';

export interface ClaimOffer {
  entryId: string;
  traineeId: string;
  /** Plaintext token — exists only in memory for the post-commit mail; the DB holds its sha256. */
  token: string;
}

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/**
 * CLAIM-mode opening (TKT-0114): when a spot frees on a CLAIM class with a non-empty
 * queue, void the session's previous claim tokens and issue a fresh one per queued
 * entry. Runs in the caller's transaction (the freeing delete), so tokens exist only
 * if the delete commits. Returns the plaintext tokens for the after-commit mail step.
 *
 * TKT-0120: no window opens once self-service has closed — no tokens, and therefore no offer
 * mails. A claim link is useless past the cutoff anyway; the claim endpoint rejects it.
 */
export async function openClaimWindow(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; sessionId: string; now?: Date },
): Promise<ClaimOffer[]> {
  const session = await tx.session.findUniqueOrThrow({
    where: { id: params.sessionId },
    select: {
      startsAt: true,
      class: { select: { capacity: true, waitlistMode: true, bookingCutoffMin: true } },
    },
  });
  if (session.class.waitlistMode !== WaitlistMode.CLAIM) return [];
  if (selfServiceClosed(session.startsAt, session.class.bookingCutoffMin, params.now ?? new Date())) {
    return [];
  }
  const capacity = session.class.capacity;
  if (capacity === null) return [];
  const count = await tx.attendance.count({ where: { sessionId: params.sessionId } });
  if (count >= capacity) return [];

  const entries = await tx.waitlistEntry.findMany({
    where: { sessionId: params.sessionId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, traineeId: true },
  });
  if (entries.length === 0) return [];

  // A new opening supersedes the old one — stale links answer 410, never book.
  await tx.waitlistClaimToken.deleteMany({ where: { sessionId: params.sessionId } });

  const offers: ClaimOffer[] = [];
  for (const entry of entries) {
    const token = randomBytes(32).toString('base64url');
    await tx.waitlistClaimToken.create({
      data: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        entryId: entry.id,
        tokenHash: sha256Hex(token),
      },
    });
    offers.push({ entryId: entry.id, traineeId: entry.traineeId, token });
  }
  return offers;
}
