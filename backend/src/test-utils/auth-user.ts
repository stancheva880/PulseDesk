import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';

// Stand-in actor for service specs. SUPER_ADMIN is never location-scoped, so
// passing it preserves the behavior of the former optional-user code path.
export const SUPER_ADMIN_USER: AuthenticatedUser = {
  id: 'test-super-admin',
  email: 'super-admin@test.local',
  role: UserRole.SUPER_ADMIN,
  tenantId: null,
};
