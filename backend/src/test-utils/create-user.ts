import { UserRole, type Membership, type Prisma, type User } from '@prisma/client';
import type { PrismaService } from '@/prisma/prisma.service';

// Spec-only fixture: creates a user the post-membership way (isSuperAdmin flag,
// role on a Membership row) while keeping the old call shape. The returned object
// carries synthetic `role`/`tenantId` so single-membership assertions read naturally.
interface TestUserData {
  email: string;
  passwordHash: string | null;
  role: UserRole;
  tenantId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean;
  locations?: Prisma.UserCreateInput['locations'];
}

type TestUser = User & {
  memberships: Membership[];
  role: UserRole;
  tenantId: string | null;
};

export async function createTestUser(
  prisma: PrismaService,
  data: TestUserData,
): Promise<TestUser> {
  const { role, tenantId, ...rest } = data;
  const isSuperAdmin = role === UserRole.SUPER_ADMIN;
  if (!isSuperAdmin && !tenantId) {
    throw new Error('createTestUser: tenant-bound roles require a tenantId');
  }
  const user = await prisma.user.create({
    data: {
      ...rest,
      isSuperAdmin,
      memberships: isSuperAdmin
        ? undefined
        : { create: { tenantId: tenantId as string, role } },
    },
    include: { memberships: true },
  });
  return { ...user, role, tenantId: isSuperAdmin ? null : (tenantId as string) };
}
