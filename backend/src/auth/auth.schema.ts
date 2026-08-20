import { UserRole } from '@prisma/client';
import { z } from 'zod';

// The published contract for the auth routes. `.parse()` strips every undeclared key, so each
// schema here is an allowlist: a future `select *` or widened `include` on an auth path cannot
// leak a password hash, a stored refresh-token hash or a reset token into a body. The converse
// also holds — a field named here is a field promised — so each schema is the minimum the
// client actually needs.

/** The single declaration of the role union, derived from schema.prisma. */
export const UserRoleSchema = z.enum(UserRole);

export const LoginMembershipSchema = z.object({
  tenantId: z.string(),
  tenantName: z.string(),
  role: UserRoleSchema,
});

/** GET /auth/memberships — a plain array, per the sub-list convention. */
export const LoginMembershipListSchema = z.array(LoginMembershipSchema);

/**
 * POST /auth/login. No refresh token: it is set as an httpOnly cookie (TKT-0036) and must not
 * appear in the body. The client picks its active tenant from `memberships`.
 */
export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  memberships: LoginMembershipListSchema,
});

/**
 * POST /auth/refresh serves two callers from one route. A browser authenticates with the cookie
 * and receives the access token alone; a body-authenticated caller (no cookie jar) gets the
 * rotation handed back. Both branches are declared because both are real — declaring only the
 * cookie shape would silently strip the rotated token from the non-browser path.
 *
 * The two-field branch is FIRST on purpose: zod tries union members in order, and the
 * access-token-only object would otherwise match a body-path payload and drop `refreshToken`.
 */
export const RefreshResponseSchema = z.union([
  z.object({ accessToken: z.string(), refreshToken: z.string() }),
  z.object({ accessToken: z.string() }),
]);

/**
 * POST /auth/forgot-password. One fixed string and nothing else — any additional field could
 * differ between a hit and a miss, which would turn the response into an enumeration oracle.
 */
export const ForgotPasswordResponseSchema = z.object({
  message: z.string(),
});
