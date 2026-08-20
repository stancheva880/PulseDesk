import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AttendanceStatus,
  BillingMode,
  SessionStatus,
  UserRole,
} from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsService } from './sessions.service';
import { createTestUser } from '@/test-utils/create-user';

describe('SessionsService', () => {
  let service: SessionsService;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [SessionsService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(SessionsService);
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

  async function newLocation(tenantId: string) {
    return prisma.location.create({
      data: { tenantId, name: `Loc-${randomUUID()}` },
    });
  }

  async function newClass(tenantId: string, opts?: { traineeIds?: string[]; trainerIds?: string[] }) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        trainees: opts?.traineeIds?.length
          ? { connect: opts.traineeIds.map((id) => ({ id })) }
          : undefined,
        trainers: opts?.trainerIds?.length
          ? { connect: opts.trainerIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  }

  async function newTrainee(tenantId: string) {
    return prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
  }

  async function newEmployee(tenantId: string) {
    return createTestUser(prisma, {
      tenantId,
      email: `${randomUUID()}@x`,
      passwordHash: 'x',
      role: UserRole.EMPLOYEE,
    });
  }

  // Tests in this file assert "no scope filter" semantics. With the new ADMIN
  // location-scoping, that maps to SUPER_ADMIN. ADMIN scoping is covered by the
  // controller spec / dedicated scope tests.
  function adminViewer(_tenantId: string) {
    return { id: 'sa-id', email: 'sa@x', role: UserRole.SUPER_ADMIN, tenantId: null } as const;
  }

  function employeeViewer(tenantId: string, userId: string) {
    return { id: userId, email: 'e@x', role: UserRole.EMPLOYEE, tenantId } as const;
  }

  // --- create ---

  describe('create', () => {
    it('creates a session and auto-generates PENDING attendance rows for every enrolled trainee', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainee1 = await newTrainee(t.id);
      const trainee2 = await newTrainee(t.id);
      const cls = await newClass(t.id, { traineeIds: [trainee1.id, trainee2.id] });

      const session = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);

      expect(session.tenantId).toBe(t.id);
      expect(session.status).toBe(SessionStatus.SCHEDULED);

      const attendances = await prisma.attendance.findMany({
        where: { sessionId: session.id },
      });
      expect(attendances).toHaveLength(2);
      expect(attendances.every((a) => a.status === AttendanceStatus.PENDING)).toBe(true);
      expect(new Set(attendances.map((a) => a.traineeId))).toEqual(
        new Set([trainee1.id, trainee2.id]),
      );
    });

    it('creates zero attendance rows when the class has no enrolled trainees', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const cls = await newClass(t.id);

      const session = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);

      const count = await prisma.attendance.count({ where: { sessionId: session.id } });
      expect(count).toBe(0);
    });

    it('defaults trainers from the class when trainerIds is omitted', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newEmployee(t.id);
      const cls = await newClass(t.id, { trainerIds: [trainer.id] });

      const session = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);

      const withTrainers = await prisma.session.findUnique({
        where: { id: session.id },
        include: { trainers: true },
      });
      expect(withTrainers?.trainers.map((u) => u.id)).toEqual([trainer.id]);
    });

    it('respects explicit trainerIds (substitute scenario)', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const classTrainer = await newEmployee(t.id);
      const substitute = await newEmployee(t.id);
      const cls = await newClass(t.id, { trainerIds: [classTrainer.id] });

      const session = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
        trainerIds: [substitute.id],
      }, su);

      const withTrainers = await prisma.session.findUnique({
        where: { id: session.id },
        include: { trainers: true },
      });
      expect(withTrainers?.trainers.map((u) => u.id)).toEqual([substitute.id]);
    });

    it('rejects when classId is from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(a.id);
      const classB = await newClass(b.id);
      await expect(
        service.create(a.id, {
          classId: classB.id,
          locationId: loc.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when locationId is from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const cls = await newClass(a.id);
      const locB = await newLocation(b.id);
      await expect(
        service.create(a.id, {
          classId: cls.id,
          locationId: locB.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects trainerIds that are not EMPLOYEE-role users in the tenant', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const cls = await newClass(t.id);
      const admin = await createTestUser(prisma, {
        tenantId: t.id,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.ADMIN,
      });
      await expect(
        service.create(t.id, {
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
          trainerIds: [admin.id],
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when endsAt is not after startsAt', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const cls = await newClass(t.id);
      await expect(
        service.create(t.id, {
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-01T19:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // --- list / findById visibility ---

  describe('list / findById visibility', () => {
    it('admin sees all sessions in their tenant', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const cls = await newClass(t.id);
      await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);
      await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-08T18:00:00.000Z',
        endsAt: '2026-06-08T19:00:00.000Z',
      }, su);
      const result = await service.list(t.id, adminViewer(t.id));
      expect(result.items).toHaveLength(2);
    });

    it('employee only sees sessions where they are a trainer', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newEmployee(t.id);
      const otherTrainer = await newEmployee(t.id);
      const cls = await newClass(t.id);

      // Session 1: trainer assigned
      await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
        trainerIds: [trainer.id],
      }, su);
      // Session 2: only otherTrainer
      await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-08T18:00:00.000Z',
        endsAt: '2026-06-08T19:00:00.000Z',
        trainerIds: [otherTrainer.id],
      }, su);

      const result = await service.list(t.id, employeeViewer(t.id, trainer.id));
      expect(result.items).toHaveLength(1);
    });

    it('cross-tenant findById returns NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(a.id);
      const cls = await newClass(a.id);
      const inA = await service.create(a.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);
      await expect(
        service.findById(b.id, inA.id, adminViewer(b.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('employee findById on a session they do not teach returns NotFound', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const cls = await newClass(t.id);
      const trainer = await newEmployee(t.id);
      const outsider = await newEmployee(t.id);
      const session = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
        trainerIds: [trainer.id],
      }, su);
      await expect(
        service.findById(t.id, session.id, employeeViewer(t.id, outsider.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // --- update / delete ---

  describe('update / delete', () => {
    it('admin can update status (e.g., mark COMPLETED) and notes', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const cls = await newClass(t.id);
      const session = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);
      const updated = await service.update(t.id, session.id, {
        status: SessionStatus.COMPLETED,
        notes: 'Great session',
      }, su);
      expect(updated.status).toBe(SessionStatus.COMPLETED);
      expect(updated.notes).toBe('Great session');
    });

    it('cross-tenant update returns NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(a.id);
      const cls = await newClass(a.id);
      const inA = await service.create(a.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);
      await expect(
        service.update(b.id, inA.id, { notes: 'hijack' }, su),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('delete cascades attendance rows', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainee = await newTrainee(t.id);
      const cls = await newClass(t.id, { traineeIds: [trainee.id] });
      const session = await service.create(t.id, {
        classId: cls.id,
        locationId: loc.id,
        startsAt: '2026-06-01T18:00:00.000Z',
        endsAt: '2026-06-01T19:00:00.000Z',
      }, su);
      await service.delete(t.id, session.id, su);
      const orphaned = await prisma.attendance.count({ where: { sessionId: session.id } });
      expect(orphaned).toBe(0);
    });
  });
});
