import { z } from 'zod';
import { isoDate } from '@/common/response-schema';

export const WaitlistEntrySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  sessionId: z.string(),
  traineeId: z.string(),
  createdAt: isoDate,
});

export const WaitlistEntryWithTraineeSchema = WaitlistEntrySchema.extend({
  trainee: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
});

/** GET /sessions/:id/waitlist stays a plain array, per the parent-scoped sub-list convention. */
export const WaitlistEntryListSchema = z.array(WaitlistEntryWithTraineeSchema);

/** TKT-0122: how many stale queue entries the sweep removed. Tokens follow via cascade. */
export const WaitlistSweepResultSchema = z.object({ deleted: z.number() });

/** TKT-0114: what the public claim landing page needs — nothing more. */
export const ClaimResultSchema = z.object({
  claimed: z.literal(true),
  className: z.string(),
  startsAt: isoDate,
});
