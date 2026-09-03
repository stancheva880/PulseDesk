import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { BillingMode, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PrismaService } from '@/prisma/prisma.service';
import { LocationsService } from './locations.service';
import { createTestUser } from '@/test-utils/create-user';

describe('LocationsService', () => {
  let service: LocationsService;
  let prisma: PrismaService;
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  const SUPER: AuthenticatedUser = {
    id: 'sa',
    email: 'sa@x',
    role: UserRole.SUPER_ADMIN,
    tenantId: null,
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [LocationsService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(LocationsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdTenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    }
    await prisma.onModuleDestroy();
  });

  async function newTenant() {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test Tenant', slug: `t-${randomUUID()}` },
    });
    createdTenantIds.push(tenant.id);
    return tenant;
  }

  async function newAdmin(tenantId: string, locationIds: string[] = []): Promise<AuthenticatedUser> {
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x.local`,
      passwordHash: 'x',
      role: UserRole.ADMIN,
      tenantId,
      locations: { connect: locationIds.map((id) => ({ id })) },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email: user.email, role: UserRole.ADMIN, tenantId };
  }

  describe('list', () => {
    it('returns SUPER_ADMIN-visible locations for the tenant, sorted by name', async () => {
      const t = await newTenant();
      await service.create(t.id, { name: 'Pool' });
      await service.create(t.id, { name: 'Gym' });
      await service.create(t.id, { name: 'Field' });
      const result = await service.list(t.id, SUPER);
      expect(result.items.map((l) => l.name)).toEqual(['Field', 'Gym', 'Pool']);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
    });

    it('does not return locations from other tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await service.create(a.id, { name: 'A-Loc' });
      await service.create(b.id, { name: 'B-Loc' });
      const result = await service.list(a.id, SUPER);
      expect(result.items.map((l) => l.name)).toEqual(['A-Loc']);
    });

    it('returns only ADMIN-assigned locations for ADMIN', async () => {
      const t = await newTenant();
      const gym = await service.create(t.id, { name: 'Gym' });
      const pool = await service.create(t.id, { name: 'Pool' });
      await service.create(t.id, { name: 'Field' });
      const admin = await newAdmin(t.id, [gym.id, pool.id]);
      const result = await service.list(t.id, admin);
      expect(result.items.map((l) => l.name)).toEqual(['Gym', 'Pool']);
    });

    it('returns empty items for ADMIN with no assigned locations', async () => {
      const t = await newTenant();
      await service.create(t.id, { name: 'Gym' });
      const admin = await newAdmin(t.id, []);
      const result = await service.list(t.id, admin);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('paginates: pageSize slices results and total counts all matches', async () => {
      const t = await newTenant();
      await service.create(t.id, { name: 'A' });
      await service.create(t.id, { name: 'B' });
      await service.create(t.id, { name: 'C' });
      const page1 = await service.list(t.id, SUPER, { page: 1, pageSize: 2 });
      expect(page1.items.map((l) => l.name)).toEqual(['A', 'B']);
      expect(page1).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
      const page2 = await service.list(t.id, SUPER, { page: 2, pageSize: 2 });
      expect(page2.items.map((l) => l.name)).toEqual(['C']);
      expect(page2).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    });
  });

  describe('findById', () => {
    it('returns the location for SUPER_ADMIN', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      const result = await service.findById(t.id, created.id, SUPER);
      expect(result.id).toBe(created.id);
    });

    it('throws NotFoundException when id does not exist', async () => {
      const t = await newTenant();
      await expect(service.findById(t.id, 'nonexistent-id', SUPER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when location belongs to a different tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, { name: 'A-Loc' });
      await expect(service.findById(b.id, inA.id, SUPER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the location for ADMIN when it is in their assigned set', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      const admin = await newAdmin(t.id, [created.id]);
      const result = await service.findById(t.id, created.id, admin);
      expect(result.id).toBe(created.id);
    });

    it('throws NotFoundException for ADMIN when the location is not in their assigned set', async () => {
      const t = await newTenant();
      const studio = await service.create(t.id, { name: 'Studio' });
      const other = await service.create(t.id, { name: 'Other' });
      const admin = await newAdmin(t.id, [studio.id]);
      await expect(service.findById(t.id, other.id, admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a location scoped to the tenant', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio', address: '123 Main' });
      expect(created.tenantId).toBe(t.id);
      expect(created.name).toBe('Studio');
      expect(created.address).toBe('123 Main');
      expect(created.isActive).toBe(true);
    });

    it('allows the same name in different tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await service.create(a.id, { name: 'Main Gym' });
      await expect(service.create(b.id, { name: 'Main Gym' })).resolves.toBeDefined();
    });

    it('throws ConflictException on duplicate name within a tenant', async () => {
      const t = await newTenant();
      await service.create(t.id, { name: 'Main Gym' });
      await expect(service.create(t.id, { name: 'Main Gym' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('updates the location fields', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      const updated = await service.update(t.id, created.id, {
        name: 'Studio A',
        address: 'New addr',
        isActive: false,
      });
      expect(updated.name).toBe('Studio A');
      expect(updated.address).toBe('New addr');
      expect(updated.isActive).toBe(false);
    });

    it('throws NotFoundException when updating a location from a different tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, { name: 'A-Loc' });
      await expect(
        service.update(b.id, inA.id, { name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when renaming to a name already used in the same tenant', async () => {
      const t = await newTenant();
      await service.create(t.id, { name: 'Pool' });
      const gym = await service.create(t.id, { name: 'Gym' });
      await expect(service.update(t.id, gym.id, { name: 'Pool' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('updatePaymentDetails', () => {
    it('sets the payment fields, unrelated to name/address/isActive', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      const updated = await service.updatePaymentDetails(
        t.id,
        created.id,
        { bankIban: 'BG80BNBG96611020345678', bankAccountHolder: 'Studio EOOD', revolutHandle: '@studio' },
        SUPER,
      );
      expect(updated.bankIban).toBe('BG80BNBG96611020345678');
      expect(updated.bankAccountHolder).toBe('Studio EOOD');
      expect(updated.revolutHandle).toBe('@studio');
      expect(updated.name).toBe('Studio');
    });

    it('clears a field with an explicit null, and leaves an omitted field untouched', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      await service.updatePaymentDetails(
        t.id,
        created.id,
        { bankIban: 'BG80BNBG96611020345678', myposLink: 'https://www.mypos.com/pay/club' },
        SUPER,
      );
      const cleared = await service.updatePaymentDetails(
        t.id,
        created.id,
        { bankIban: null },
        SUPER,
      );
      expect(cleared.bankIban).toBeNull();
      expect(cleared.myposLink).toBe('https://www.mypos.com/pay/club');
    });

    it('lets an ADMIN update payment details for a location they are assigned to', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      const admin = await newAdmin(t.id, [created.id]);
      const updated = await service.updatePaymentDetails(
        t.id,
        created.id,
        { cashNote: 'Pay at the front desk' },
        admin,
      );
      expect(updated.cashNote).toBe('Pay at the front desk');
    });

    it('refuses an ADMIN outside their assigned locations', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      const admin = await newAdmin(t.id, []);
      await expect(
        service.updatePaymentDetails(t.id, created.id, { cashNote: 'x' }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for a location in a different tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, { name: 'A-Loc' });
      await expect(
        service.updatePaymentDetails(b.id, inA.id, { cashNote: 'x' }, SUPER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listPaymentDetailsForCustomer', () => {
    async function newCustomer(tenantId: string) {
      const user = await createTestUser(prisma, {
        email: `${randomUUID()}@cust.local`,
        passwordHash: 'x',
        role: UserRole.CUSTOMER,
        tenantId,
      });
      createdUserIds.push(user.id);
      return user;
    }

    it("lists a guarded trainee's assigned location, with its payment fields", async () => {
      const t = await newTenant();
      const loc = await service.create(t.id, { name: 'Studio' });
      await service.updatePaymentDetails(
        t.id,
        loc.id,
        { bankIban: 'BG80BNBG96611020345678', bankAccountHolder: 'Studio EOOD' },
        SUPER,
      );
      const parent = await newCustomer(t.id);
      await prisma.trainee.create({
        data: {
          tenantId: t.id,
          firstName: 'Kid',
          lastName: 'X',
          dateOfBirth: new Date('2015-01-01'),
          guardians: { connect: [{ id: parent.id }] },
          locations: { connect: [{ id: loc.id }] },
        },
      });

      const rows = await service.listPaymentDetailsForCustomer(t.id, parent.id);

      expect(rows).toEqual([
        {
          id: loc.id,
          name: 'Studio',
          bankIban: 'BG80BNBG96611020345678',
          bankAccountHolder: 'Studio EOOD',
          revolutHandle: null,
          myposLink: null,
          cashNote: null,
        },
      ]);
    });

    it("lists the customer's own trainee record too, not just guarded ones", async () => {
      const t = await newTenant();
      const loc = await service.create(t.id, { name: 'Studio' });
      const learner = await newCustomer(t.id);
      await prisma.trainee.create({
        data: {
          tenantId: t.id,
          firstName: 'Self',
          lastName: 'Learner',
          dateOfBirth: new Date('1990-01-01'),
          userId: learner.id,
          locations: { connect: [{ id: loc.id }] },
        },
      });

      const rows = await service.listPaymentDetailsForCustomer(t.id, learner.id);

      expect(rows.map((r) => r.id)).toEqual([loc.id]);
    });

    it("falls back to the club's shared default for a field the location never set", async () => {
      const t = await newTenant();
      await prisma.tenant.update({
        where: { id: t.id },
        data: { revolutHandle: '@clubdefault', cashNote: 'Pay at reception' },
      });
      const loc = await service.create(t.id, { name: 'Studio' });
      await service.updatePaymentDetails(
        t.id,
        loc.id,
        { bankIban: 'BG80BNBG96611020345678' },
        SUPER,
      );
      const parent = await newCustomer(t.id);
      await prisma.trainee.create({
        data: {
          tenantId: t.id,
          firstName: 'Kid',
          lastName: 'X',
          dateOfBirth: new Date('2015-01-01'),
          guardians: { connect: [{ id: parent.id }] },
          locations: { connect: [{ id: loc.id }] },
        },
      });

      const rows = await service.listPaymentDetailsForCustomer(t.id, parent.id);

      // The location's own IBAN wins; the fields it never set inherit the club default.
      expect(rows).toEqual([
        {
          id: loc.id,
          name: 'Studio',
          bankIban: 'BG80BNBG96611020345678',
          bankAccountHolder: null,
          revolutHandle: '@clubdefault',
          myposLink: null,
          cashNote: 'Pay at reception',
        },
      ]);
    });

    it('never returns a location only reachable through another family', async () => {
      const t = await newTenant();
      const loc = await service.create(t.id, { name: 'Studio' });
      const otherParent = await newCustomer(t.id);
      const parent = await newCustomer(t.id);
      await prisma.trainee.create({
        data: {
          tenantId: t.id,
          firstName: 'Other',
          lastName: 'Kid',
          dateOfBirth: new Date('2015-01-01'),
          guardians: { connect: [{ id: otherParent.id }] },
          locations: { connect: [{ id: loc.id }] },
        },
      });

      const rows = await service.listPaymentDetailsForCustomer(t.id, parent.id);

      expect(rows).toEqual([]);
    });
  });

  describe('delete', () => {
    it('removes the location', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Studio' });
      await service.delete(t.id, created.id);
      await expect(service.findById(t.id, created.id, SUPER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when deleting a location from a different tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, { name: 'A-Loc' });
      await expect(service.delete(b.id, inA.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findById(a.id, inA.id, SUPER)).resolves.toBeDefined();
    });

    // TKT-0124: the guard runs after the tenant lookup, so a wrong-tenant id keeps answering
    // 404 (the case above) rather than leaking that the hall exists and is busy.
    it('throws ConflictException when the location has a session', async () => {
      const t = await newTenant();
      const created = await service.create(t.id, { name: 'Busy Hall' });
      const cls = await prisma.class.create({
        data: {
          tenantId: t.id,
          name: `Class-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 20,
          locations: { connect: [{ id: created.id }] },
        },
      });
      await prisma.session.create({
        data: {
          tenantId: t.id,
          classId: cls.id,
          locationId: created.id,
          startsAt: new Date('2026-09-01T10:00:00Z'),
          endsAt: new Date('2026-09-01T11:00:00Z'),
        },
      });

      await expect(service.delete(t.id, created.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.findById(t.id, created.id, SUPER)).resolves.toBeDefined();
    });
  });
});
