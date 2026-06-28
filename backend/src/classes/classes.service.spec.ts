import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AttendanceStatus, BillingMode, SessionStatus, UserRole } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PrismaService } from '@/prisma/prisma.service';
import { ClassesService } from './classes.service';

describe('ClassesService', () => {
  let service: ClassesService;
  let prisma: PrismaService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ClassesService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(ClassesService);
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

  async function newLocation(tenantId: string, name = `Loc-${randomUUID()}`) {
    return prisma.location.create({ data: { tenantId, name } });
  }

  async function newUser(tenantId: string, role: UserRole) {
    return prisma.user.create({
      data: {
        tenantId,
        email: `${randomUUID()}@test.local`,
        passwordHash: 'x',
        role,
      },
    });
  }

  async function newTrainee(tenantId: string) {
    return prisma.trainee.create({
      data: {
        tenantId,
        firstName: 'Test',
        lastName: 'Trainee',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
  }

  describe('create — billing validation', () => {
    it('creates a PER_MONTH class with monthlyAmount', async () => {
      const t = await newTenant();
      const cls = await service.create(t.id, {
        name: 'Beginner Tennis',
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 100,
      });
      expect(cls.billingMode).toBe(BillingMode.PER_MONTH);
      expect(Number(cls.monthlyAmount)).toBe(100);
      expect(cls.sessionPrice).toBeNull();
    });

    it('creates a PER_SESSION class with sessionPrice', async () => {
      const t = await newTenant();
      const cls = await service.create(t.id, {
        name: 'Drop-in Yoga',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 25,
      });
      expect(cls.billingMode).toBe(BillingMode.PER_SESSION);
      expect(Number(cls.sessionPrice)).toBe(25);
      expect(cls.monthlyAmount).toBeNull();
    });

    it('rejects PER_MONTH without monthlyAmount', async () => {
      const t = await newTenant();
      await expect(
        service.create(t.id, {
          name: 'X',
          billingMode: BillingMode.PER_MONTH,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects PER_MONTH with sessionPrice', async () => {
      const t = await newTenant();
      await expect(
        service.create(t.id, {
          name: 'X',
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 100,
          sessionPrice: 10,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects PER_SESSION without sessionPrice', async () => {
      const t = await newTenant();
      await expect(
        service.create(t.id, {
          name: 'X',
          billingMode: BillingMode.PER_SESSION,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update — roster backfill', () => {
    it('back-fills future scheduled sessions when a trainee is added to the class', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr = await newTrainee(t.id);
      const cls = await service.create(t.id, {
        name: `Roster-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        locationIds: [loc.id],
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

      await service.update(t.id, cls.id, { traineeIds: [tr.id] });

      const rows = await prisma.attendance.findMany({
        where: { sessionId: session.id, traineeId: tr.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe(AttendanceStatus.PENDING);
    });
  });

  describe('create — FK tenant scoping', () => {
    it('connects locations within the tenant', async () => {
      const t = await newTenant();
      const loc1 = await newLocation(t.id, 'Gym');
      const loc2 = await newLocation(t.id, 'Pool');
      const cls = await service.create(t.id, {
        name: 'Aqua Class',
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 50,
        locationIds: [loc1.id, loc2.id],
      });
      const fetched = await service.findById(t.id, cls.id);
      expect(fetched.locations.map((l) => l.name).sort()).toEqual(['Gym', 'Pool']);
    });

    it('rejects locationIds from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inB = await newLocation(b.id);
      await expect(
        service.create(a.id, {
          name: 'X',
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 50,
          locationIds: [inB.id],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects trainerIds that are not EMPLOYEE role', async () => {
      const t = await newTenant();
      const admin = await newUser(t.id, UserRole.ADMIN);
      await expect(
        service.create(t.id, {
          name: 'X',
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 50,
          trainerIds: [admin.id],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts EMPLOYEE trainerIds in the tenant', async () => {
      const t = await newTenant();
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const cls = await service.create(t.id, {
        name: 'Class',
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 50,
        trainerIds: [trainer.id],
      });
      const fetched = await service.findById(t.id, cls.id);
      expect(fetched.trainers.map((u) => u.id)).toEqual([trainer.id]);
    });

    it('rejects traineeIds from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const traineeB = await newTrainee(b.id);
      await expect(
        service.create(a.id, {
          name: 'X',
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 50,
          traineeIds: [traineeB.id],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('uniqueness + cross-tenant', () => {
    it('rejects duplicate name within the same tenant', async () => {
      const t = await newTenant();
      await service.create(t.id, {
        name: 'Yoga',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 20,
      });
      await expect(
        service.create(t.id, {
          name: 'Yoga',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 20,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows same name in different tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await service.create(a.id, {
        name: 'Yoga',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 20,
      });
      await expect(
        service.create(b.id, {
          name: 'Yoga',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 20,
        }),
      ).resolves.toBeDefined();
    });

    it('does not list classes from other tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await service.create(a.id, {
        name: 'A-Class',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      await service.create(b.id, {
        name: 'B-Class',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      const list = await service.list(a.id);
      expect(list.map((c) => c.name)).toEqual(['A-Class']);
    });

    it('findById throws NotFound for cross-tenant fetches', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        name: 'A-Class',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      await expect(service.findById(b.id, inA.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates name and isActive', async () => {
      const t = await newTenant();
      const cls = await service.create(t.id, {
        name: 'Y',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      const updated = await service.update(t.id, cls.id, { name: 'Y2', isActive: false });
      expect(updated.name).toBe('Y2');
      expect(updated.isActive).toBe(false);
    });

    it('rejects changing billingMode after creation', async () => {
      const t = await newTenant();
      const cls = await service.create(t.id, {
        name: 'X',
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 100,
      });
      await expect(
        service.update(t.id, cls.id, { billingMode: BillingMode.PER_SESSION }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects setting sessionPrice on a PER_MONTH class', async () => {
      const t = await newTenant();
      const cls = await service.create(t.id, {
        name: 'X',
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 100,
      });
      await expect(
        service.update(t.id, cls.id, { sessionPrice: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('replaces locations on update (set semantics)', async () => {
      const t = await newTenant();
      const loc1 = await newLocation(t.id, 'A');
      const loc2 = await newLocation(t.id, 'B');
      const loc3 = await newLocation(t.id, 'C');
      const cls = await service.create(t.id, {
        name: 'X',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        locationIds: [loc1.id, loc2.id],
      });
      await service.update(t.id, cls.id, { locationIds: [loc3.id] });
      const fetched = await service.findById(t.id, cls.id);
      expect(fetched.locations.map((l) => l.name)).toEqual(['C']);
    });

    it('throws NotFound when updating a class from a different tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        name: 'X',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      await expect(
        service.update(b.id, inA.id, { name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('EMPLOYEE scoping (list + findById)', () => {
    function employeeViewer(tenantId: string, userId: string): AuthenticatedUser {
      return { id: userId, email: 'e@x', role: UserRole.EMPLOYEE, tenantId };
    }

    it('lists only classes the employee teaches', async () => {
      const t = await newTenant();
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const mine = await service.create(t.id, {
        name: `Mine-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        trainerIds: [trainer.id],
      });
      await service.create(t.id, {
        name: `Other-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      const list = await service.list(t.id, employeeViewer(t.id, trainer.id));
      expect(list.map((c) => c.id)).toEqual([mine.id]);
    });

    it('also lists a class the employee does not teach but has a session in', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const cls = await service.create(t.id, {
        name: `Sub-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        locationIds: [loc.id],
      });
      await prisma.session.create({
        data: {
          tenantId: t.id,
          classId: cls.id,
          locationId: loc.id,
          startsAt: new Date('2026-06-01T18:00:00.000Z'),
          endsAt: new Date('2026-06-01T19:00:00.000Z'),
          status: SessionStatus.SCHEDULED,
          trainers: { connect: { id: trainer.id } },
        },
      });
      const list = await service.list(t.id, employeeViewer(t.id, trainer.id));
      expect(list.map((c) => c.id)).toContain(cls.id);
    });

    it('findById returns a class the employee teaches', async () => {
      const t = await newTenant();
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const mine = await service.create(t.id, {
        name: `Mine-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        trainerIds: [trainer.id],
      });
      const fetched = await service.findById(t.id, mine.id, employeeViewer(t.id, trainer.id));
      expect(fetched.id).toBe(mine.id);
    });

    it('findById throws NotFound for a class the employee neither teaches nor has a session in', async () => {
      const t = await newTenant();
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const other = await service.create(t.id, {
        name: `Other-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      await expect(
        service.findById(t.id, other.id, employeeViewer(t.id, trainer.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete', () => {
    it('removes the class', async () => {
      const t = await newTenant();
      const cls = await service.create(t.id, {
        name: 'X',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      await service.delete(t.id, cls.id);
      await expect(service.findById(t.id, cls.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when deleting a class from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const inA = await service.create(a.id, {
        name: 'X',
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      });
      await expect(service.delete(b.id, inA.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
