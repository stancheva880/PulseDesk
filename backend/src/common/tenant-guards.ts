import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

// FK-in-tenant guards shared by sessions / class-schedules / fees: a referenced
// row must exist AND belong to the caller's tenant, else the reference is rejected.

async function assertRefInTenant(count: () => Promise<number>, param: string): Promise<void> {
  if (!(await count())) {
    throw new BadRequestException(`${param} is invalid or not in your tenant`);
  }
}

export const assertClassInTenant = (prisma: PrismaService, tenantId: string, classId: string) =>
  assertRefInTenant(() => prisma.class.count({ where: { id: classId, tenantId } }), 'classId');

export const assertLocationInTenant = (
  prisma: PrismaService,
  tenantId: string,
  locationId: string,
) =>
  assertRefInTenant(
    () => prisma.location.count({ where: { id: locationId, tenantId } }),
    'locationId',
  );

export const assertTraineeInTenant = (prisma: PrismaService, tenantId: string, traineeId: string) =>
  assertRefInTenant(
    () => prisma.trainee.count({ where: { id: traineeId, tenantId } }),
    'traineeId',
  );

// Count-vs-length guard: every id in `ids` must be matched by the delegate's
// count, else the whole reference list is rejected with `message`.
export async function assertIdsInTenant(
  ids: readonly string[] | undefined,
  count: (ids: string[]) => Promise<number>,
  message: string,
): Promise<void> {
  if (!ids || ids.length === 0) return;
  if ((await count([...ids])) !== ids.length) throw new BadRequestException(message);
}

export const assertLocationIds = (prisma: PrismaService, tenantId: string, ids?: string[]) =>
  assertIdsInTenant(
    ids,
    (x) => prisma.location.count({ where: { id: { in: x }, tenantId } }),
    'Some locationIds are invalid or not in your tenant',
  );

export const assertClassIds = (prisma: PrismaService, tenantId: string, ids?: string[]) =>
  assertIdsInTenant(
    ids,
    (x) => prisma.class.count({ where: { id: { in: x }, tenantId } }),
    'Some classIds are invalid or not in your tenant',
  );

export const assertTraineeIds = (prisma: PrismaService, tenantId: string, ids?: string[]) =>
  assertIdsInTenant(
    ids,
    (x) => prisma.trainee.count({ where: { id: { in: x }, tenantId } }),
    'Some traineeIds are invalid or not in your tenant',
  );

export const assertTrainerIds = (prisma: PrismaService, tenantId: string, ids?: string[]) =>
  assertIdsInTenant(
    ids,
    (x) =>
      prisma.user.count({
        where: { id: { in: x }, memberships: { some: { tenantId, role: UserRole.EMPLOYEE } } },
      }),
    'Some trainerIds are not employees in your tenant',
  );

export const assertGuardianUserIds = (prisma: PrismaService, tenantId: string, ids?: string[]) =>
  assertIdsInTenant(
    ids,
    (x) =>
      prisma.user.count({
        where: { id: { in: x }, memberships: { some: { tenantId, role: UserRole.CUSTOMER } } },
      }),
    'Some guardianUserIds are not customers in your tenant',
  );
