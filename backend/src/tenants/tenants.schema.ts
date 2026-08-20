import { z } from 'zod';

// Exactly the four columns the controller's `select` names. This response fills the SUPER_ADMIN
// tenant selector and answers before any tenant is active, so it must stay independent of
// X-Tenant-Id — the schema describes the shape and changes nothing about when the route answers.

export const TenantSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});

/** Plain array, per the sub-list convention — this route is not paginated. */
export const TenantSummaryListSchema = z.array(TenantSummarySchema);

/**
 * POST /tenants. The extra field is why this is its own schema rather than a widened
 * TenantSummary: that one also answers GET /tenants for the club selector, where a delivery
 * report would be a field nothing ever sets.
 *
 * The new club's administrator has no password, so the mail is their only way in — a silent
 * failure leaves a club nobody can reach while the screen reads success. Same name and same
 * meaning as CreatedUser.notificationSent, because this route has the same two arms.
 */
export const CreatedTenantSchema = TenantSummarySchema.extend({
  notificationSent: z.boolean(),
});
