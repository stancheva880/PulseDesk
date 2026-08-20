import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthenticatedUser } from '../types/jwt-payload';
import { LocationScopeService } from './location-scope.service';
import { createTestUser } from '@/test-utils/create-user';

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
    const admin = await createTestUser(prisma, {
      email: `admin-${randomUUID()}@x.local`,
      passwordHash: 'x',
      role: UserRole.ADMIN,
      tenantId: tenant.id,
      locations: { connect: [{ id: a.id }, { id: b.id }] },
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

  it('returns null for CUSTOMER (scoped by ownership, not by location)', async () => {
    const cust: AuthenticatedUser = { id: 'c', email: 'c', role: UserRole.CUSTOMER, tenantId: 't1' };
    expect(await service.getAccessibleLocationIds(cust, 't1')).toBeNull();
  });

  it('returns EMPLOYEE assigned location IDs scoped to the requested tenant', async () => {
    const { tenant, a, b, admin: _admin } = await createScenario();
    const employee = await createTestUser(prisma, {
      email: `${randomUUID()}@e.local`,
      passwordHash: 'x',
      role: UserRole.EMPLOYEE,
      tenantId: tenant.id,
      locations: { connect: [{ id: a.id }] },
    });
    const emp: AuthenticatedUser = {
      id: employee.id,
      email: employee.email,
      role: UserRole.EMPLOYEE,
      tenantId: tenant.id,
    };
    const ids = await service.getAccessibleLocationIds(emp, tenant.id);
    expect(ids).toEqual([a.id]);
    expect(ids).not.toContain(b.id);
  });

  it('returns an empty array for an EMPLOYEE with no assignments', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'T' },
    });
    tenantIds.push(tenant.id);
    await prisma.location.create({ data: { tenantId: tenant.id, name: 'Unassigned' } });
    const employee = await createTestUser(prisma, {
      email: `${randomUUID()}@e.local`,
      passwordHash: 'x',
      role: UserRole.EMPLOYEE,
      tenantId: tenant.id,
    });
    const emp: AuthenticatedUser = {
      id: employee.id,
      email: employee.email,
      role: UserRole.EMPLOYEE,
      tenantId: tenant.id,
    };
    // Empty means empty — never a silent fall-back to "no filter", which is the hole TKT-0054
    // closed. The users service is what keeps this state from being reachable.
    expect(await service.getAccessibleLocationIds(emp, tenant.id)).toEqual([]);
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
    const admin = await createTestUser(prisma, {
      email: `unassigned-${randomUUID()}@x.local`,
      passwordHash: 'x',
      role: UserRole.ADMIN,
      tenantId: tenant.id,
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

  it('locationWhere returns {} when the user is not location-restricted', async () => {
    const su: AuthenticatedUser = { id: 'sa', email: 's', role: UserRole.SUPER_ADMIN, tenantId: null };
    expect(await service.locationWhere(su, 't1')).toEqual({});
  });

  it('locationWhere returns a locationId filter for ADMIN', async () => {
    const { tenant, a, b, admin } = await createScenario();
    const where = await service.locationWhere(adminUser(admin.id, tenant.id), tenant.id);
    expect(where.locationId).toBeDefined();
    expect(new Set(where.locationId!.in)).toEqual(new Set([a.id, b.id]));
  });

  it("locationWhere with field 'id' filters on id (Location model itself)", async () => {
    const { tenant, a, b, admin } = await createScenario();
    const where = await service.locationWhere(adminUser(admin.id, tenant.id), tenant.id, 'id');
    expect(where.id).toBeDefined();
    expect(new Set(where.id!.in)).toEqual(new Set([a.id, b.id]));
  });

  it('locationsWhere returns {} when the user is not location-restricted', async () => {
    const su: AuthenticatedUser = { id: 'sa', email: 's', role: UserRole.SUPER_ADMIN, tenantId: null };
    expect(await service.locationsWhere(su, 't1')).toEqual({});
  });

  it('locationsWhere returns a locations-relation filter for ADMIN', async () => {
    const { tenant, a, b, admin } = await createScenario();
    const where = await service.locationsWhere(adminUser(admin.id, tenant.id), tenant.id);
    expect(where.locations).toBeDefined();
    expect(new Set(where.locations!.some.id.in)).toEqual(new Set([a.id, b.id]));
  });
});
