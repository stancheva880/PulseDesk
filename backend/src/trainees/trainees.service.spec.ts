import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AttendanceStatus,
  BillingMode,
  ContactRelationship,
  SessionStatus,
  UserRole,
} from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import { TraineesService } from './trainees.service';

describe('TraineesService', () => {
  let service: TraineesService;
  let prisma: PrismaService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [TraineesService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(TraineesService);
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

  async function newCustomer(tenantId: string) {
    return prisma.user.create({
      data: {
        tenantId,
        email: `${randomUUID()}@test.local`,
        passwordHash: 'x',
        role: UserRole.CUSTOMER,
      },
    });
  }

  // 17 years old today (PRD's <18 boundary).
  const minorDob = new Date();
  minorDob.setFullYear(minorDob.getFullYear() - 17);
  const minorDobIso = minorDob.toISOString().slice(0, 10);

  // 25 years old today.
  const adultDob = new Date();
  adultDob.setFullYear(adultDob.getFullYear() - 25);
  const adultDobIso = adultDob.toISOString().slice(0, 10);

  describe('update — class enrolment backfill', () => {
    it('back-fills future scheduled sessions when classIds gains a class', async () => {
      const t = await newTenant();
      const loc = await prisma.location.create({
        data: { tenantId: t.id, name: `L-${randomUUID()}` },
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: t.id,
          name: `C-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 10,
        },
      });
      const trainee = await service.create(t.id, {
        firstName: 'A',
        lastName: 'B',
        dateOfBirth: adultDobIso,
      });
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const session = await prisma.session.create({
        data: {
          tenantId: t.id,
          classId: cls.id,
          locationId: loc.id,
          startsAt: future,
          endsAt: new Date(future.getTime() + 3_600_000),
          status: SessionStatus.SCHEDULED,
        },
      });

      await service.update(t.id, trainee.id, { classIds: [cls.id] });

      const rows = await prisma.attendance.findMany({
        where: { sessionId: session.id, traineeId: trainee.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe(AttendanceStatus.PENDING);
    });
  });

  describe('create — under-18 contact rule (PRD)', () => {
    it('rejects a minor without contacts (400)', async () => {
      const t = await newTenant();
      await expect(
        service.create(t.id, {
          firstName: 'Kid',
          lastName: 'Smith',
          dateOfBirth: minorDobIso,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a minor with at least one contact, persisting it via nested create', async () => {
      const t = await newTenant();
      const trainee = await service.create(t.id, {
        firstName: 'Kid',
        lastName: 'Smith',
        dateOfBirth: minorDobIso,
        contacts: [
          {
            firstName: 'Parent',
            lastName: 'Smith',
            relationship: ContactRelationship.PARENT,
            phone: '555-1234',
            isPrimary: true,
          },
        ],
      });
      const persisted = await prisma.contactPerson.findMany({
        where: { traineeId: trainee.id },
      });
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.firstName).toBe('Parent');
      expect(persisted[0]?.tenantId).toBe(t.id);
      expect(persisted[0]?.relationship).toBe(ContactRelationship.PARENT);
    });

    it('accepts an adult with no contacts', async () => {
      const t = await newTenant();
      await expect(
        service.create(t.id, {
          firstName: 'Adult',
          lastName: 'Smith',
          dateOfBirth: adultDobIso,
        }),
      ).resolves.toBeDefined();
    });

    it('accepts an adult with contacts (no constraint — adults may still have emergency contacts)', async () => {
      const t = await newTenant();
      await expect(
        service.create(t.id, {
          firstName: 'Adult',
          lastName: 'Smith',
          dateOfBirth: adultDobIso,
          contacts: [
            {
              firstName: 'Spouse',
              lastName: 'Smith',
              relationship: ContactRelationship.OTHER,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('create — FK validation', () => {
    it('rejects locationIds from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inB = await prisma.location.create({ data: { tenantId: b.id, name: 'B-Loc' } });
      await expect(
        service.create(a.id, {
          firstName: 'X',
          lastName: 'Y',
          dateOfBirth: adultDobIso,
          locationIds: [inB.id],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects userId that is not a CUSTOMER', async () => {
      const t = await newTenant();
      const admin = await prisma.user.create({
        data: { tenantId: t.id, email: `${randomUUID()}@x`, passwordHash: 'x', role: UserRole.ADMIN },
      });
      await expect(
        service.create(t.id, {
          firstName: 'X',
          lastName: 'Y',
          dateOfBirth: adultDobIso,
          userId: admin.id,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects guardianUserIds that are not CUSTOMERs', async () => {
      const t = await newTenant();
      const employee = await prisma.user.create({
        data: { tenantId: t.id, email: `${randomUUID()}@x`, passwordHash: 'x', role: UserRole.EMPLOYEE },
      });
      await expect(
        service.create(t.id, {
          firstName: 'X',
          lastName: 'Y',
          dateOfBirth: minorDobIso,
          contacts: [
            { firstName: 'P', lastName: 'S', relationship: ContactRelationship.PARENT },
          ],
          guardianUserIds: [employee.id],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('connects guardian customers in the tenant', async () => {
      const t = await newTenant();
      const guardian = await newCustomer(t.id);
      const trainee = await service.create(t.id, {
        firstName: 'Kid',
        lastName: 'X',
        dateOfBirth: minorDobIso,
        guardianUserIds: [guardian.id],
        contacts: [
          { firstName: 'P', lastName: 'X', relationship: ContactRelationship.GUARDIAN },
        ],
      });
      const fetched = await service.findById(t.id, trainee.id);
      expect(fetched.guardians.map((g) => g.id)).toEqual([guardian.id]);
    });
  });

  describe('list / findById / cross-tenant', () => {
    it('does not list trainees from other tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await service.create(a.id, {
        firstName: 'A',
        lastName: 'A',
        dateOfBirth: adultDobIso,
      });
      await service.create(b.id, {
        firstName: 'B',
        lastName: 'B',
        dateOfBirth: adultDobIso,
      });
      const list = await service.list(a.id);
      expect(list.map((t) => t.lastName)).toEqual(['A']);
    });

    it('findById throws NotFound for cross-tenant fetches', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        firstName: 'A',
        lastName: 'A',
        dateOfBirth: adultDobIso,
      });
      await expect(service.findById(b.id, inA.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('list orders by lastName then firstName', async () => {
      const t = await newTenant();
      await service.create(t.id, { firstName: 'A', lastName: 'Smith', dateOfBirth: adultDobIso });
      await service.create(t.id, { firstName: 'Z', lastName: 'Adams', dateOfBirth: adultDobIso });
      await service.create(t.id, { firstName: 'B', lastName: 'Smith', dateOfBirth: adultDobIso });
      const list = await service.list(t.id);
      expect(list.map((tr) => `${tr.lastName} ${tr.firstName}`)).toEqual([
        'Adams Z',
        'Smith A',
        'Smith B',
      ]);
    });
  });

  describe('update / delete', () => {
    it('throws NotFound updating a trainee in another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        firstName: 'X',
        lastName: 'Y',
        dateOfBirth: adultDobIso,
      });
      await expect(
        service.update(b.id, inA.id, { firstName: 'Hijack' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound deleting a trainee in another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        firstName: 'X',
        lastName: 'Y',
        dateOfBirth: adultDobIso,
      });
      await expect(service.delete(b.id, inA.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replaces locations on update (set semantics)', async () => {
      const t = await newTenant();
      const loc1 = await prisma.location.create({ data: { tenantId: t.id, name: 'A' } });
      const loc2 = await prisma.location.create({ data: { tenantId: t.id, name: 'B' } });
      const trainee = await service.create(t.id, {
        firstName: 'X',
        lastName: 'Y',
        dateOfBirth: adultDobIso,
        locationIds: [loc1.id],
      });
      await service.update(t.id, trainee.id, { locationIds: [loc2.id] });
      const fetched = await service.findById(t.id, trainee.id);
      expect(fetched.locations.map((l) => l.name)).toEqual(['B']);
    });

    it('cascades contact deletion when the trainee is deleted', async () => {
      const t = await newTenant();
      const trainee = await service.create(t.id, {
        firstName: 'Kid',
        lastName: 'X',
        dateOfBirth: minorDobIso,
        contacts: [
          { firstName: 'P', lastName: 'X', relationship: ContactRelationship.PARENT },
        ],
      });
      await service.delete(t.id, trainee.id);
      const orphaned = await prisma.contactPerson.count({ where: { traineeId: trainee.id } });
      expect(orphaned).toBe(0);
    });
  });
});
