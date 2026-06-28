import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BillingMode, DayOfWeek, UserRole } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsService } from '@/sessions/sessions.service';
import { ClassSchedulesService } from './class-schedules.service';

describe('ClassSchedulesService', () => {
  let service: ClassSchedulesService;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ClassSchedulesService, SessionsService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(ClassSchedulesService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.onModuleDestroy();
  });

  async function newTenant() {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function newClass(tenantId: string, traineeIds: string[] = []) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        trainees: traineeIds.length
          ? { connect: traineeIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  }

  async function newLocation(tenantId: string) {
    return prisma.location.create({
      data: { tenantId, name: `Loc-${randomUUID()}` },
    });
  }

  async function newTrainee(tenantId: string) {
    return prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
  }

  describe('CRUD', () => {
    it('creates a schedule scoped to the tenant', async () => {
      const t = await newTenant();
      const cls = await newClass(t.id);
      const loc = await newLocation(t.id);
      const sched = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });
      expect(sched.tenantId).toBe(t.id);
      expect(sched.dayOfWeek).toBe(DayOfWeek.MON);
      expect(sched.isActive).toBe(true);
    });

    it('rejects when classId is from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const classB = await newClass(b.id);
      const locA = await newLocation(a.id);
      await expect(
        service.create(a.id, {
          classId: classB.id,
          locationId: locA.id,
          dayOfWeek: DayOfWeek.MON,
          startTime: '18:00',
          endTime: '19:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when endTime is not after startTime', async () => {
      const t = await newTenant();
      const cls = await newClass(t.id);
      const loc = await newLocation(t.id);
      await expect(
        service.create(t.id, {
          classId: cls.id,
          locationId: loc.id,
          dayOfWeek: DayOfWeek.MON,
          startTime: '19:00',
          endTime: '19:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cross-tenant findById returns NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const cls = await newClass(a.id);
      const loc = await newLocation(a.id);
      const inA = await service.create(a.id, {
        classId: cls.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });
      await expect(service.findById(b.id, inA.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateSessions', () => {
    it('materializes Session rows for each weekday match in range', async () => {
      const t = await newTenant();
      const cls = await newClass(t.id);
      const loc = await newLocation(t.id);
      // Schedule: every Monday 18:00–19:00.
      await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });

      // 2026-06-01 is a Monday. The range covers exactly 4 Mondays:
      // 2026-06-01, 06-08, 06-15, 06-22. (06-29 is also a Monday but `to` excludes it.)
      const result = await service.generateSessions(t.id, {
        from: '2026-06-01',
        to: '2026-06-28',
      });
      expect(result.created).toBe(4);
      expect(result.skipped).toBe(0);

      const sessions = await prisma.session.findMany({
        where: { tenantId: t.id },
        orderBy: { startsAt: 'asc' },
      });
      expect(sessions).toHaveLength(4);
      // First session must land at 18:00 local on 2026-06-01.
      const first = sessions[0]!;
      expect(first.startsAt.getDay()).toBe(1); // Monday
      expect(first.startsAt.getHours()).toBe(18);
      expect(first.endsAt.getHours()).toBe(19);
    });

    it('is idempotent — re-running over the same range creates 0 new sessions', async () => {
      const t = await newTenant();
      const cls = await newClass(t.id);
      const loc = await newLocation(t.id);
      await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });
      await service.generateSessions(t.id, { from: '2026-06-01', to: '2026-06-28' });
      const second = await service.generateSessions(t.id, {
        from: '2026-06-01',
        to: '2026-06-28',
      });
      expect(second.created).toBe(0);
      expect(second.skipped).toBe(4);
    });

    it('skips inactive schedules', async () => {
      const t = await newTenant();
      const cls = await newClass(t.id);
      const loc = await newLocation(t.id);
      const sched = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });
      await service.update(t.id, sched.id, { isActive: false });
      const result = await service.generateSessions(t.id, {
        from: '2026-06-01',
        to: '2026-06-28',
      });
      expect(result.created).toBe(0);
    });

    it('only generates from the specified classId when filter is provided', async () => {
      const t = await newTenant();
      const classA = await newClass(t.id);
      const classB = await newClass(t.id);
      const loc = await newLocation(t.id);
      await service.create(t.id, {
        classId: classA.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });
      await service.create(t.id, {
        classId: classB.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '20:00',
        endTime: '21:00',
      });
      const result = await service.generateSessions(t.id, {
        from: '2026-06-01',
        to: '2026-06-28',
        classId: classA.id,
      });
      expect(result.created).toBe(4);
      const sessions = await prisma.session.findMany({ where: { tenantId: t.id } });
      expect(sessions).toHaveLength(4);
      expect(sessions.every((s) => s.classId === classA.id)).toBe(true);
    });

    it('auto-creates PENDING attendance rows for class trainees on each generated session', async () => {
      const t = await newTenant();
      const trainee = await newTrainee(t.id);
      const cls = await newClass(t.id, [trainee.id]);
      const loc = await newLocation(t.id);
      await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });
      await service.generateSessions(t.id, { from: '2026-06-01', to: '2026-06-08' });
      const attendances = await prisma.attendance.findMany({
        where: { tenantId: t.id, traineeId: trainee.id },
      });
      // 2 Mondays → 2 attendance rows.
      expect(attendances).toHaveLength(2);
      expect(attendances.every((a) => a.status === 'PENDING')).toBe(true);
    });

    it('rejects when from > to', async () => {
      const t = await newTenant();
      await expect(
        service.generateSessions(t.id, { from: '2026-06-10', to: '2026-06-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not see schedules from other tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const clsB = await newClass(b.id);
      const locB = await newLocation(b.id);
      await service.create(b.id, {
        classId: clsB.id,
        locationId: locB.id,
        dayOfWeek: DayOfWeek.MON,
        startTime: '18:00',
        endTime: '19:00',
      });
      const result = await service.generateSessions(a.id, {
        from: '2026-06-01',
        to: '2026-06-28',
      });
      expect(result.created).toBe(0);
      // Confirm tenant A has no sessions.
      const sessionsA = await prisma.session.count({ where: { tenantId: a.id } });
      expect(sessionsA).toBe(0);
      // Avoid lint complaint about unused symbol in cross-tenant check.
      void UserRole;
    });
  });
});
