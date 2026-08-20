import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
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
import { calculateAge, TraineesService } from './trainees.service';
import { createTestUser } from '@/test-utils/create-user';

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
    return createTestUser(prisma, {
      tenantId,
      email: `${randomUUID()}@test.local`,
      passwordHash: 'x',
      role: UserRole.CUSTOMER,
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
      }, su);
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

      await service.update(t.id, trainee.id, { classIds: [cls.id] }, su);

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
        }, su),
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
      }, su);
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
        }, su),
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
        }, su),
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
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects userId that is not a CUSTOMER', async () => {
      const t = await newTenant();
      const admin = await createTestUser(prisma, {
        tenantId: t.id,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.ADMIN,
      });
      await expect(
        service.create(t.id, {
          firstName: 'X',
          lastName: 'Y',
          dateOfBirth: adultDobIso,
          userId: admin.id,
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects guardianUserIds that are not CUSTOMERs', async () => {
      const t = await newTenant();
      const employee = await createTestUser(prisma, {
        tenantId: t.id,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
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
        }, su),
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
      }, su);
      const fetched = await service.findById(t.id, trainee.id, su);
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
      }, su);
      await service.create(b.id, {
        firstName: 'B',
        lastName: 'B',
        dateOfBirth: adultDobIso,
      }, su);
      const list = await service.list(a.id, su);
      expect(list.items.map((t) => t.lastName)).toEqual(['A']);
    });

    it('findById throws NotFound for cross-tenant fetches', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        firstName: 'A',
        lastName: 'A',
        dateOfBirth: adultDobIso,
      }, su);
      await expect(service.findById(b.id, inA.id, su)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('list orders by lastName then firstName', async () => {
      const t = await newTenant();
      await service.create(t.id, { firstName: 'A', lastName: 'Smith', dateOfBirth: adultDobIso }, su);
      await service.create(t.id, { firstName: 'Z', lastName: 'Adams', dateOfBirth: adultDobIso }, su);
      await service.create(t.id, { firstName: 'B', lastName: 'Smith', dateOfBirth: adultDobIso }, su);
      const list = await service.list(t.id, su);
      expect(list.items.map((tr) => `${tr.lastName} ${tr.firstName}`)).toEqual([
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
      }, su);
      await expect(
        service.update(b.id, inA.id, { firstName: 'Hijack' }, su),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound deleting a trainee in another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        firstName: 'X',
        lastName: 'Y',
        dateOfBirth: adultDobIso,
      }, su);
      await expect(service.delete(b.id, inA.id, su)).rejects.toBeInstanceOf(NotFoundException);
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
      }, su);
      await service.update(t.id, trainee.id, { locationIds: [loc2.id] }, su);
      const fetched = await service.findById(t.id, trainee.id, su);
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
      }, su);
      await service.delete(t.id, trainee.id, su);
      const orphaned = await prisma.contactPerson.count({ where: { traineeId: trainee.id } });
      expect(orphaned).toBe(0);
    });
  });
});

describe('calculateAge', () => {
  it('returns 18 the day someone turns 18 (boundary — not under 18)', () => {
    expect(calculateAge(new Date('2008-05-06'), new Date('2026-05-06'))).toBe(18);
  });

  it('returns 17 the day before someone turns 18', () => {
    expect(calculateAge(new Date('2008-05-06'), new Date('2026-05-05'))).toBe(17);
  });

  it('returns 17 when the birthday has not yet occurred this year', () => {
    expect(calculateAge(new Date('2008-12-31'), new Date('2026-05-06'))).toBe(17);
  });

  it('returns 18 when the birthday has already passed this year', () => {
    expect(calculateAge(new Date('2008-01-01'), new Date('2026-05-06'))).toBe(18);
  });

  it('returns 25 for a clearly adult date of birth', () => {
    expect(calculateAge(new Date('2001-01-01'), new Date('2026-05-06'))).toBe(25);
  });

  it('returns 0 for a baby born today', () => {
    expect(calculateAge(new Date('2026-05-06'), new Date('2026-05-06'))).toBe(0);
  });
});
