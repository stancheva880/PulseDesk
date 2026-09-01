import { z } from 'zod';
import { UserRoleSchema } from '@/auth/auth.schema';
import { isoDate, paginatedSchema } from '@/common/response-schema';
import { LocationRefSchema } from '@/locations/locations.schema';

// The users contract, and the epic's strongest allowlist.
//
// This describes toSummary()'s OUTPUT, not USER_SELECT's columns — the two differ.
// `isSuperAdmin` and `memberships` are selected on every route but stripped by toSummary;
// `role` and `tenantId` are synthesized there and never selected. Declaring the query shape
// would publish two fields that never reach the wire and omit the two that do.
//
// Why that matters beyond typing: `memberships` is { tenantId, role } for EVERY tenant the
// account belongs to, and it is already in memory on all five routes. One destructuring line
// keeps it out of the response. Parsing through this schema strips it at the boundary instead,
// so a widened select or a direct row spread cannot disclose which other clubs a person
// belongs to. `passwordHash` is excluded on the same principle.

/**
 * TKT-0060: derived server-side from `isActive` and whether a password has been set. PENDING
 * means invited but not yet accepted. `passwordHash` itself stays undeclared here, so the
 * interceptor strips it even if a future `select` widens.
 */
export const UserAccountStatusSchema = z.enum(['PENDING', 'ACTIVE', 'INACTIVE']);

export const UserSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  // Reused from auth/auth.schema.ts (TKT-0045) — this module must not become another copy.
  role: UserRoleSchema,
  // NULL only for SUPER_ADMIN, who is global rather than tenant-bound.
  tenantId: z.string().nullable(),
  isActive: z.boolean(),
  status: UserAccountStatusSchema,
  locations: z.array(LocationRefSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const PaginatedUserSummarySchema = paginatedSchema(UserSummarySchema);

/**
 * POST /users. The attach branch adds `attachedExisting: true`; a plain create omits the key
 * entirely, so it is optional — declaring it required would fail every non-attach create.
 */
export const CreatedUserSchema = UserSummarySchema.extend({
  // Whether the outgoing email went out. Not `inviteEmailSent`: only one of the two branches
  // sends an invite — a plain create and an attach-to-a-pending-account do, while attaching an
  // account that already has a password sends a club-access notice carrying no token and no
  // link (TKT-0061). One name for "the mail this create sends, and whether it left".
  //
  // Required, not optional: every create path sets it. It was optional only so TKT-0058 would
  // not move the published contract, and that debt is settled here.
  notificationSent: z.boolean(),
  attachedExisting: z.boolean().optional(),
});

/**
 * POST /users/:id/invite (TKT-0060). Delivery is reported, not transacted — a false here is a
 * successful resend whose mail did not go out, and re-sending again is the recovery.
 */
export const InviteResultSchema = z.object({ inviteEmailSent: z.boolean() });

/**
 * GET/PATCH /users/me. Deliberately narrower than UserSummarySchema: no role, tenantId,
 * locations or status — those are club-scoped and admin-managed (PATCH /users/:id), while this
 * pair is the same for the account everywhere and needs none of that resolved.
 */
export const OwnProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
