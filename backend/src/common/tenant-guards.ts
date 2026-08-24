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

/**
 * TKT-0125: a deactivated location takes no new dated work — no session, no schedule.
 *
 * Deliberately not built on `assertRefInTenant`: that throws a bare string with no `code`, and
 * the frontend needs one to translate the refusal. Every call site runs `assertLocationInTenant`
 * first, so by the time this runs the row is known to exist in the caller's tenant — a zero
 * count here means "inactive", never "missing".
 *
 * Only for the single-`locationId` doors. `assertLocationIds` (the m2m list guard) stays
 * untouched on purpose: those writes go through `setMany`, which resends the whole relation, so
 * an active check there would refuse a legitimate `set` that merely carries an
 * already-attached inactive hall. Attaching staff, trainees or classes creates no dated
 * records anyway.
 */
export async function assertLocationActive(
  prisma: PrismaService,
  tenantId: string,
  locationId: string,
): Promise<void> {
  const active = await prisma.location.count({
    where: { id: locationId, tenantId, isActive: true },
  });
  if (!active) {
    throw new BadRequestException({
      message: 'That location is deactivated. Reactivate it, or choose another location.',
      code: 'LOCATION_INACTIVE',
    });
  }
}

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
