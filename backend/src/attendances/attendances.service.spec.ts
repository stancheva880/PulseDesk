import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AttendanceRsvp,
  AttendanceStatus,
  BillingMode,
  UserRole,
} from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { ConsoleMailService } from '@/mail/console-mail.service';
import { MailService } from '@/mail/mail.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsService } from '@/sessions/sessions.service';
import { AttendancesService } from './attendances.service';
import { createTestUser } from '@/test-utils/create-user';

describe('AttendancesService', () => {
  let service: AttendancesService;
  let sessions: SessionsService;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      // TKT-0114: the service reads FRONTEND_URL for claim links — same global config
      // AppModule provides.
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        AttendancesService,
        SessionsService,
        LocationScopeService,
        PrismaService,
        // TKT-0113: the service now mails on promotion; same binding MailModule makes.
        { provide: MailService, useClass: ConsoleMailService },
      ],
    }).compile();
    service = moduleRef.get(AttendancesService);
    sessions = moduleRef.get(SessionsService);
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
  async function newTrainee(
    tenantId: string,
    opts?: { userId?: string; guardianIds?: string[]; firstName?: string; lastName?: string },
  ) {
    return prisma.trainee.create({
      data: {
        tenantId,
        firstName: opts?.firstName ?? 'T',
        lastName: opts?.lastName ?? 'X',
        dateOfBirth: new Date('2000-01-01'),
        userId: opts?.userId,
        guardians: opts?.guardianIds?.length
          ? { connect: opts.guardianIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  }
  async function newUser(tenantId: string, role: UserRole, name?: { firstName?: string; lastName?: string }) {
    return createTestUser(prisma, {
      tenantId,
      email: `${randomUUID()}@x`,
      passwordHash: 'x',
      role,
      firstName: name?.firstName,
      lastName: name?.lastName,
    });
  }
  async function makeSession(tenantId: string, classId: string, locationId: string, trainerIds?: string[]) {
    return sessions.create(tenantId, {
      classId,
      locationId,
      startsAt: '2026-06-01T18:00:00.000Z',
      endsAt: '2026-06-01T19:00:00.000Z',
      trainerIds,
    }, su);
  }

  // Tests in this file assert "no scope filter" semantics. With ADMIN now being
  // location-scoped, that maps to SUPER_ADMIN. ADMIN scoping has dedicated tests.
  function adminViewer(_tenantId: string, id = 'admin-id') {
    return { id, email: 'a@x', role: UserRole.SUPER_ADMIN, tenantId: null } as const;
  }
  function employeeViewer(tenantId: string, id: string) {
    return { id, email: 'e@x', role: UserRole.EMPLOYEE, tenantId } as const;
  }
  function customerViewer(tenantId: string, id: string) {
    return { id, email: 'c@x', role: UserRole.CUSTOMER, tenantId } as const;
  }

  // --- listForSession ---

  describe('listForSession', () => {
    it('admin sees all attendance rows for a session in their tenant', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr1 = await newTrainee(t.id);
      const tr2 = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr1.id, tr2.id]);
      const session = await makeSession(t.id, cls.id, loc.id);

      const rows = await service.listForSession(t.id, session.id, adminViewer(t.id));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === AttendanceStatus.PENDING)).toBe(true);
    });

    // The attendance screen renders a name per row. Sending the trainee with the row is
    // what lets it do that without resolving ids against a separately-paged trainee list.
    it("includes each row's trainee id and name", async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr = await newTrainee(t.id, { firstName: 'Ada', lastName: 'Lovelace' });
      const cls = await newClass(t.id, [tr.id]);
      const session = await makeSession(t.id, cls.id, loc.id);

      const rows = await service.listForSession(t.id, session.id, adminViewer(t.id));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.trainee).toEqual({
        id: tr.id,
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
    });

    it('employee can list attendances for sessions they teach', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const tr1 = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr1.id]);
      const session = await makeSession(t.id, cls.id, loc.id, [trainer.id]);

      const rows = await service.listForSession(t.id, session.id, employeeViewer(t.id, trainer.id));
      expect(rows).toHaveLength(1);
    });

    it('employee not-trainer-of-session gets NotFound', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const outsider = await newUser(t.id, UserRole.EMPLOYEE);
      const tr1 = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr1.id]);
      const session = await makeSession(t.id, cls.id, loc.id, [trainer.id]);

      await expect(
        service.listForSession(t.id, session.id, employeeViewer(t.id, outsider.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cross-tenant returns NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(a.id);
      const cls = await newClass(a.id);
      const session = await makeSession(a.id, cls.id, loc.id);
      await expect(
        service.listForSession(b.id, session.id, adminViewer(b.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // --- bulkMark ---

  describe('bulkMark', () => {
    it('admin bulk-marks statuses + notes and writes audit snapshot', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const admin = await newUser(t.id, UserRole.ADMIN, { firstName: 'Ada', lastName: 'Lovelace' });
      const tr1 = await newTrainee(t.id);
      const tr2 = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr1.id, tr2.id]);
      const session = await makeSession(t.id, cls.id, loc.id);

      const result = await service.bulkMark(t.id, session.id, adminViewer(t.id, admin.id), {
        items: [
          { traineeId: tr1.id, status: AttendanceStatus.PRESENT },
          { traineeId: tr2.id, status: AttendanceStatus.ABSENT, notes: 'sick' },
        ],
      });
      expect(result.updated).toBe(2);

      const rows = await prisma.attendance.findMany({
        where: { sessionId: session.id },
        orderBy: { traineeId: 'asc' },
      });
      const byTraineeId = new Map(rows.map((r) => [r.traineeId, r]));
      const r1 = byTraineeId.get(tr1.id)!;
      const r2 = byTraineeId.get(tr2.id)!;
      expect(r1.status).toBe(AttendanceStatus.PRESENT);
      expect(r1.markedById).toBe(admin.id);
      expect(r1.markedByEmailSnapshot).toBe(admin.email);
      expect(r1.markedByNameSnapshot).toBe('Ada Lovelace');
      expect(r1.markedAt).toBeInstanceOf(Date);
      expect(r2.status).toBe(AttendanceStatus.ABSENT);
      expect(r2.notes).toBe('sick');
    });

    it('rejects with NotFound when any traineeId is not part of this session (transaction rolls back)', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const admin = await newUser(t.id, UserRole.ADMIN);
      const tr1 = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr1.id]);
      const session = await makeSession(t.id, cls.id, loc.id);
      const orphanTrainee = await newTrainee(t.id);

      await expect(
        service.bulkMark(t.id, session.id, adminViewer(t.id, admin.id), {
          items: [
            { traineeId: tr1.id, status: AttendanceStatus.PRESENT },
            { traineeId: orphanTrainee.id, status: AttendanceStatus.PRESENT },
          ],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      // tr1 row must NOT have been mutated — transaction rolled back.
      const row = await prisma.attendance.findFirst({
        where: { sessionId: session.id, traineeId: tr1.id },
      });
      expect(row?.status).toBe(AttendanceStatus.PENDING);
      expect(row?.markedById).toBeNull();
    });

    it('employee-trainer-of-session can bulkMark', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const tr1 = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr1.id]);
      const session = await makeSession(t.id, cls.id, loc.id, [trainer.id]);

      const result = await service.bulkMark(t.id, session.id, employeeViewer(t.id, trainer.id), {
        items: [{ traineeId: tr1.id, status: AttendanceStatus.PRESENT }],
      });
      expect(result.updated).toBe(1);
    });

    it('employee not-trainer-of-session gets NotFound', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const outsider = await newUser(t.id, UserRole.EMPLOYEE);
      const tr1 = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr1.id]);
      const session = await makeSession(t.id, cls.id, loc.id, [trainer.id]);

      await expect(
        service.bulkMark(t.id, session.id, employeeViewer(t.id, outsider.id), {
          items: [{ traineeId: tr1.id, status: AttendanceStatus.PRESENT }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cross-tenant returns NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(a.id);
      const tr1 = await newTrainee(a.id);
      const cls = await newClass(a.id, [tr1.id]);
      const session = await makeSession(a.id, cls.id, loc.id);
      await expect(
        service.bulkMark(b.id, session.id, adminViewer(b.id), {
          items: [{ traineeId: tr1.id, status: AttendanceStatus.PRESENT }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // --- addTrainee ---

  describe('addTrainee', () => {
    it('adds a PENDING row for a tenant trainee not yet on the session', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const enrolled = await newTrainee(t.id);
      const cls = await newClass(t.id, [enrolled.id]);
      const session = await makeSession(t.id, cls.id, loc.id); // auto-row for `enrolled`
      const dropIn = await newTrainee(t.id); // not in the class

      const row = await service.addTrainee(t.id, session.id, adminViewer(t.id), {
        traineeId: dropIn.id,
      });
      expect(row.traineeId).toBe(dropIn.id);
      expect(row.status).toBe(AttendanceStatus.PENDING);

      const all = await prisma.attendance.findMany({ where: { sessionId: session.id } });
      expect(all).toHaveLength(2);
    });

    it('rejects a duplicate with Conflict', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr = await newTrainee(t.id);
      const cls = await newClass(t.id, [tr.id]);
      const session = await makeSession(t.id, cls.id, loc.id); // tr already has a row

      await expect(
        service.addTrainee(t.id, session.id, adminViewer(t.id), { traineeId: tr.id }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a trainee from another tenant with NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(a.id);
      const cls = await newClass(a.id);
      const session = await makeSession(a.id, cls.id, loc.id);
      const foreign = await newTrainee(b.id);

      await expect(
        service.addTrainee(a.id, session.id, adminViewer(a.id), { traineeId: foreign.id }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('employee-trainer-of-session can add a trainee', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const trainer = await newUser(t.id, UserRole.EMPLOYEE);
      const cls = await newClass(t.id);
      const session = await makeSession(t.id, cls.id, loc.id, [trainer.id]);
      const tr = await newTrainee(t.id);

      const row = await service.addTrainee(t.id, session.id, employeeViewer(t.id, trainer.id), {
        traineeId: tr.id,
      });
      expect(row.traineeId).toBe(tr.id);
    });
  });

  // --- rsvp ---

  describe('rsvp', () => {
    it('adult customer RSVPs for their own trainee record', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const customer = await newUser(t.id, UserRole.CUSTOMER);
      const trainee = await newTrainee(t.id, { userId: customer.id });
      const cls = await newClass(t.id, [trainee.id]);
      const session = await makeSession(t.id, cls.id, loc.id);

      await service.rsvp(t.id, session.id, customerViewer(t.id, customer.id), {
        traineeId: trainee.id,
        traineeRsvp: AttendanceRsvp.CONFIRMED,
      });

      const row = await prisma.attendance.findFirst({
        where: { sessionId: session.id, traineeId: trainee.id },
      });
      expect(row?.traineeRsvp).toBe(AttendanceRsvp.CONFIRMED);
      // RSVP must NOT touch trainer-side fields.
      expect(row?.status).toBe(AttendanceStatus.PENDING);
      expect(row?.markedById).toBeNull();
    });

    it('guardian customer RSVPs for a trainee they guard', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const guardian = await newUser(t.id, UserRole.CUSTOMER);
      const child = await newTrainee(t.id, { guardianIds: [guardian.id] });
      const cls = await newClass(t.id, [child.id]);
      const session = await makeSession(t.id, cls.id, loc.id);

      await service.rsvp(t.id, session.id, customerViewer(t.id, guardian.id), {
        traineeId: child.id,
        traineeRsvp: AttendanceRsvp.RESCHEDULE_REQUESTED,
      });

      const row = await prisma.attendance.findFirst({
        where: { sessionId: session.id, traineeId: child.id },
      });
      expect(row?.traineeRsvp).toBe(AttendanceRsvp.RESCHEDULE_REQUESTED);
    });

    it('rejects when customer is not the trainee user nor a guardian', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const stranger = await newUser(t.id, UserRole.CUSTOMER);
      const trainee = await newTrainee(t.id);
      const cls = await newClass(t.id, [trainee.id]);
      const session = await makeSession(t.id, cls.id, loc.id);

      await expect(
        service.rsvp(t.id, session.id, customerViewer(t.id, stranger.id), {
          traineeId: trainee.id,
          traineeRsvp: AttendanceRsvp.CONFIRMED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cross-tenant rsvp returns NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(a.id);
      const customer = await newUser(a.id, UserRole.CUSTOMER);
      const trainee = await newTrainee(a.id, { userId: customer.id });
      const cls = await newClass(a.id, [trainee.id]);
      const session = await makeSession(a.id, cls.id, loc.id);
      await expect(
        service.rsvp(b.id, session.id, customerViewer(b.id, customer.id), {
          traineeId: trainee.id,
          traineeRsvp: AttendanceRsvp.CONFIRMED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns NotFound when the trainee has no attendance row on the session', async () => {
      // Session and trainee are both valid and owned by the customer, but the trainee
      // is not enrolled in this session's class, so no attendance row exists.
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const customer = await newUser(t.id, UserRole.CUSTOMER);
      const trainee = await newTrainee(t.id, { userId: customer.id });
      const otherClass = await newClass(t.id, []);
      const session = await makeSession(t.id, otherClass.id, loc.id);

      await expect(
        service.rsvp(t.id, session.id, customerViewer(t.id, customer.id), {
          traineeId: trainee.id,
          traineeRsvp: AttendanceRsvp.CONFIRMED,
        }),
      ).rejects.toThrow('Attendance row not found for this session/trainee');
    });
  });

  // --- listCustomerSessions ---

  describe('listCustomerSessions', () => {
    it('returns sessions for trainees the customer owns or guards (de-duped)', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const customer = await newUser(t.id, UserRole.CUSTOMER);
      const self = await newTrainee(t.id, { userId: customer.id });
      const child = await newTrainee(t.id, { guardianIds: [customer.id] });

      const cls1 = await newClass(t.id, [self.id]);
      const cls2 = await newClass(t.id, [child.id]);
      const sharedCls = await newClass(t.id, [self.id, child.id]);

      const s1 = await makeSession(t.id, cls1.id, loc.id);
      const s2 = await makeSession(t.id, cls2.id, loc.id);
      const sShared = await makeSession(t.id, sharedCls.id, loc.id);

      // unrelated session in same tenant — must not appear
      const otherTrainee = await newTrainee(t.id);
      const otherCls = await newClass(t.id, [otherTrainee.id]);
      await makeSession(t.id, otherCls.id, loc.id);

      const result = await service.listCustomerSessions(t.id, customer.id);
      const ids = new Set(result.map((s) => s.id));
      expect(ids).toEqual(new Set([s1.id, s2.id, sShared.id]));
    });

    it('enriches each session with class, location, and only the customers own attendance rows (with trainee names)', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const customer = await newUser(t.id, UserRole.CUSTOMER);
      const myKid = await newTrainee(t.id, { guardianIds: [customer.id] });
      const otherKid = await newTrainee(t.id);
      const cls = await newClass(t.id, [myKid.id, otherKid.id]);
      const session = await makeSession(t.id, cls.id, loc.id);

      const result = await service.listCustomerSessions(t.id, customer.id);
      expect(result).toHaveLength(1);
      const entry = result[0]!;
      expect(entry.id).toBe(session.id);
      expect(entry.class.name).toBe(cls.name);
      expect(entry.location.name).toBe(loc.name);
      // Only my child's attendance is included, NOT the other kid in the same class.
      expect(entry.attendances).toHaveLength(1);
      expect(entry.attendances[0]!.traineeId).toBe(myKid.id);
      expect(entry.attendances[0]!.trainee.firstName).toBe(myKid.firstName);
    });

    // TKT-0122: an entry on a session that has started can never be promoted (TKT-0120 gates
    // promotion), so the portal must not present it as a live queue position. Deleting the row is
    // the sweep half of that ticket and deliberately not done here.
    it('reports myWaitlist only for sessions that have not started', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const customer = await newUser(t.id, UserRole.CUSTOMER);
      const kid = await newTrainee(t.id, { guardianIds: [customer.id] });
      const cls = await newClass(t.id, [kid.id]);
      const HOUR = 3_600_000;
      const mk = (startsAt: Date) =>
        prisma.session.create({
          data: {
            tenantId: t.id,
            classId: cls.id,
            locationId: loc.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + HOUR),
          },
        });
      const past = await mk(new Date(Date.now() - 2 * HOUR));
      const future = await mk(new Date(Date.now() + 6 * HOUR));
      await prisma.waitlistEntry.createMany({
        data: [
          { tenantId: t.id, sessionId: past.id, traineeId: kid.id },
          { tenantId: t.id, sessionId: future.id, traineeId: kid.id },
        ],
      });

      const byId = new Map(
        (await service.listCustomerSessions(t.id, customer.id)).map((r) => [r.id, r]),
      );
      expect(byId.get(past.id)!.myWaitlist).toEqual([]);
      expect(byId.get(future.id)!.myWaitlist).toEqual([kid.id]);
      // Both rows still exist — this ticket hides, it does not delete.
      expect(await prisma.waitlistEntry.count({ where: { traineeId: kid.id } })).toBe(2);
    });

    it('cross-tenant isolation: customer in tenant A does not see sessions in tenant B', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const loc = await newLocation(b.id);
      const trainee = await newTrainee(b.id);
      const cls = await newClass(b.id, [trainee.id]);
      await makeSession(b.id, cls.id, loc.id);

      const customer = await newUser(a.id, UserRole.CUSTOMER);
      const result = await service.listCustomerSessions(a.id, customer.id);
      expect(result).toHaveLength(0);
    });
  });
});
