import type { UserRole } from '@prisma/client';

// Access-token claim contract. Anything verifying a PulseDesk access token can
// rely on exactly these claims:
//   sub, email, role, tenantId, type   — set from the payload below
//   iss, aud                           — set from the signer options
//   iat, exp                           — set by the library
// iss/aud are attached as signer options rather than payload fields, which is
// why AccessJwtPayload does not declare them.
export const JWT_ISSUER = 'pulsedesk';
export const JWT_AUDIENCE = 'pulsedesk-api';

export interface AccessJwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  type: 'access';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
