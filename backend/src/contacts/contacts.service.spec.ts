import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ContactRelationship } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ContactsService } from './contacts.service';

describe('ContactsService', () => {
  let service: ContactsService;
  let prisma: PrismaService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ContactsService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(ContactsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
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

  async function newTrainee(tenantId: string) {
    return prisma.trainee.create({
      data: {
        tenantId,
        firstName: 'T',
        lastName: 'X',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
  }

  describe('list', () => {
    it('returns contacts for the trainee, primaries first', async () => {
      const t = await newTenant();
      const trainee = await newTrainee(t.id);
      await service.create(t.id, trainee.id, {
        firstName: 'B',
        lastName: 'B',
        relationship: ContactRelationship.GUARDIAN,
      });
      await service.create(t.id, trainee.id, {
        firstName: 'A',
        lastName: 'A',
        relationship: ContactRelationship.PARENT,
        isPrimary: true,
      });
      const list = await service.list(t.id, trainee.id);
      expect(list.map((c) => c.firstName)).toEqual(['A', 'B']);
    });

    it('throws NotFound when the trainee belongs to another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const traineeA = await newTrainee(a.id);
      await expect(service.list(b.id, traineeA.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findById', () => {
    it('throws NotFound when the contact belongs to a different trainee', async () => {
      const t = await newTenant();
      const trainee1 = await newTrainee(t.id);
      const trainee2 = await newTrainee(t.id);
      const c = await service.create(t.id, trainee1.id, {
        firstName: 'A',
        lastName: 'A',
        relationship: ContactRelationship.PARENT,
      });
      await expect(
        service.findById(t.id, trainee2.id, c.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create / update / delete', () => {
    it('creates with the right tenant + trainee scoping', async () => {
      const t = await newTenant();
      const trainee = await newTrainee(t.id);
      const c = await service.create(t.id, trainee.id, {
        firstName: 'P',
        lastName: 'X',
        relationship: ContactRelationship.PARENT,
        phone: '555',
      });
      expect(c.tenantId).toBe(t.id);
      expect(c.traineeId).toBe(trainee.id);
      expect(c.relationship).toBe(ContactRelationship.PARENT);
      expect(c.phone).toBe('555');
      expect(c.isPrimary).toBe(false);
    });

    it('updates fields', async () => {
      const t = await newTenant();
      const trainee = await newTrainee(t.id);
      const c = await service.create(t.id, trainee.id, {
        firstName: 'A',
        lastName: 'B',
        relationship: ContactRelationship.PARENT,
      });
      const updated = await service.update(t.id, trainee.id, c.id, {
        relationship: ContactRelationship.GUARDIAN,
        isPrimary: true,
      });
      expect(updated.relationship).toBe(ContactRelationship.GUARDIAN);
      expect(updated.isPrimary).toBe(true);
    });

    it('deletes the contact', async () => {
      const t = await newTenant();
      const trainee = await newTrainee(t.id);
      const c = await service.create(t.id, trainee.id, {
        firstName: 'A',
        lastName: 'B',
        relationship: ContactRelationship.PARENT,
      });
      await service.delete(t.id, trainee.id, c.id);
      await expect(
        service.findById(t.id, trainee.id, c.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
