import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PrismaService } from '@/prisma/prisma.service';
import { LocationsService } from './locations.service';

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
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@x.local`,
        passwordHash: 'x',
        role: UserRole.ADMIN,
        tenantId,
        locations: { connect: locationIds.map((id) => ({ id })) },
      },
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
      expect(result.map((l) => l.name)).toEqual(['Field', 'Gym', 'Pool']);
    });

    it('does not return locations from other tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await service.create(a.id, { name: 'A-Loc' });
      await service.create(b.id, { name: 'B-Loc' });
      const result = await service.list(a.id, SUPER);
      expect(result.map((l) => l.name)).toEqual(['A-Loc']);
    });

    it('returns only ADMIN-assigned locations for ADMIN', async () => {
      const t = await newTenant();
      const gym = await service.create(t.id, { name: 'Gym' });
      const pool = await service.create(t.id, { name: 'Pool' });
      await service.create(t.id, { name: 'Field' });
      const admin = await newAdmin(t.id, [gym.id, pool.id]);
      const result = await service.list(t.id, admin);
      expect(result.map((l) => l.name)).toEqual(['Gym', 'Pool']);
    });

    it('returns [] for ADMIN with no assigned locations', async () => {
      const t = await newTenant();
      await service.create(t.id, { name: 'Gym' });
      const admin = await newAdmin(t.id, []);
      const result = await service.list(t.id, admin);
      expect(result).toEqual([]);
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
  });
});
