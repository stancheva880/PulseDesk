import type { UserRole } from '@prisma/client';

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
  accessExpiresIn: number;
  refreshExpiresIn: number;
}
