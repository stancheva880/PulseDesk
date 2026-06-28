import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthenticatedUser } from '../types/jwt-payload';
import { LocationScopeService } from './location-scope.service';

describe('LocationScopeService', () => {
  let prisma: PrismaService;
  let service: LocationScopeService;
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, LocationScopeService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(LocationScopeService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.onModuleDestroy();
  });

  async function createScenario() {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'T' },
    });
    tenantIds.push(tenant.id);
    const a = await prisma.location.create({
      data: { tenantId: tenant.id, name: `A-${randomUUID()}` },
    });
    const b = await prisma.location.create({
      data: { tenantId: tenant.id, name: `B-${randomUUID()}` },
    });
    const c = await prisma.location.create({
      data: { tenantId: tenant.id, name: `C-${randomUUID()}` },
    });
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@x.local`,
        passwordHash: 'x',
        role: UserRole.ADMIN,
        tenantId: tenant.id,
        locations: { connect: [{ id: a.id }, { id: b.id }] },
      },
    });
    userIds.push(admin.id);
    return { tenant, a, b, c, admin };
  }

  function adminUser(id: string, tenantId: string): AuthenticatedUser {
    return { id, email: 'a', role: UserRole.ADMIN, tenantId };
  }

  it('returns null for SUPER_ADMIN (no filter applied)', async () => {
    const su: AuthenticatedUser = { id: 'sa', email: 's', role: UserRole.SUPER_ADMIN, tenantId: null };
    expect(await service.getAccessibleLocationIds(su, 't1')).toBeNull();
  });

  it('returns null for EMPLOYEE / CUSTOMER (handled by other policies)', async () => {
    const emp: AuthenticatedUser = { id: 'e', email: 'e', role: UserRole.EMPLOYEE, tenantId: 't1' };
    expect(await service.getAccessibleLocationIds(emp, 't1')).toBeNull();
    const cust: AuthenticatedUser = { id: 'c', email: 'c', role: UserRole.CUSTOMER, tenantId: 't1' };
    expect(await service.getAccessibleLocationIds(cust, 't1')).toBeNull();
  });

  it('returns ADMIN assigned location IDs scoped to the requested tenant', async () => {
    const { tenant, a, b, admin } = await createScenario();
    const ids = await service.getAccessibleLocationIds(adminUser(admin.id, tenant.id), tenant.id);
    expect(ids).not.toBeNull();
    expect(new Set(ids!)).toEqual(new Set([a.id, b.id]));
  });

  it('returns an empty array for an ADMIN with no assignments', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'T' },
    });
    tenantIds.push(tenant.id);
    const admin = await prisma.user.create({
      data: {
        email: `unassigned-${randomUUID()}@x.local`,
        passwordHash: 'x',
        role: UserRole.ADMIN,
        tenantId: tenant.id,
      },
    });
    userIds.push(admin.id);
    const ids = await service.getAccessibleLocationIds(adminUser(admin.id, tenant.id), tenant.id);
    expect(ids).toEqual([]);
  });

  it('assertLocationsAllowed is a no-op for SUPER_ADMIN', async () => {
    const su: AuthenticatedUser = { id: 'sa', email: 's', role: UserRole.SUPER_ADMIN, tenantId: null };
    await expect(service.assertLocationsAllowed(su, 'any', ['x', 'y'])).resolves.toBeUndefined();
  });

  it('assertLocationsAllowed is a no-op when locationIds is empty', async () => {
    const { tenant, admin } = await createScenario();
    await expect(
      service.assertLocationsAllowed(adminUser(admin.id, tenant.id), tenant.id, []),
    ).resolves.toBeUndefined();
  });

  it('assertLocationsAllowed permits ADMIN within their assigned set', async () => {
    const { tenant, a, b, admin } = await createScenario();
    await expect(
      service.assertLocationsAllowed(adminUser(admin.id, tenant.id), tenant.id, [a.id, b.id]),
    ).resolves.toBeUndefined();
  });

  it('assertLocationsAllowed throws when ADMIN includes a location outside their set', async () => {
    const { tenant, a, c, admin } = await createScenario();
    await expect(
      service.assertLocationsAllowed(adminUser(admin.id, tenant.id), tenant.id, [a.id, c.id]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
