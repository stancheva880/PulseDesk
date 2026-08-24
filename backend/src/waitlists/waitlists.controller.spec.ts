import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BillingMode, SessionStatus, UserRole, WaitlistMode } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { AttendancesModule } from '@/attendances/attendances.module';
import { WaitlistsModule } from './waitlists.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  locationId: string;
  accessToken: string;
}

describe('WaitlistsController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        LocationScopeModule,
        AuthModule,
        MailModule,
        WaitlistsModule,
        // TKT-0121 AC #4 drives a staff removal through the real route to prove a
        // customer-created entry promotes like any other.
        AttendancesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(
      new ResponseSchemaInterceptor(app.get(Reflector), app.get(ConfigService)),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  });

  async function setupActor(role: UserRole): Promise<TestActor> {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Main-${randomUUID()}` },
    });
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenant.id,
      ...(role === UserRole.ADMIN || role === UserRole.EMPLOYEE
        ? { locations: { connect: [{ id: location.id }] } }
        : {}),
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenant.id,
      userId: user.id,
      locationId: location.id,
      accessToken: tokens.accessToken,
    };
  }

  const send = (a: TestActor) => ({
    Authorization: `Bearer ${a.accessToken}`,
    'X-Tenant-Id': a.tenantId,
  });

  const newTrainee = (tenantId: string) =>
    prisma.trainee.create({
      data: {
        tenantId,
        firstName: 'T',
        lastName: randomUUID().slice(0, 8),
        dateOfBirth: new Date('2000-01-01'),
      },
    });

  async function mkSession(
    a: TestActor,
    opts: { capacity?: number | null; waitlistMode?: WaitlistMode; trainerId?: string } = {},
  ) {
    const cls = await prisma.class.create({
      data: {
        tenantId: a.tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 5,
        capacity: opts.capacity === undefined ? 1 : opts.capacity,
        waitlistMode: opts.waitlistMode ?? WaitlistMode.FIFO_AUTO,
        locations: { connect: [{ id: a.locationId }] },
      },
    });
    return prisma.session.create({
      data: {
        tenantId: a.tenantId,
        classId: cls.id,
        locationId: a.locationId,
        startsAt: new Date('2026-10-01T10:00:00Z'),
        endsAt: new Date('2026-10-01T11:00:00Z'),
        status: SessionStatus.SCHEDULED,
        ...(opts.trainerId ? { trainers: { connect: [{ id: opts.trainerId }] } } : {}),
      },
    });
  }

  /** Fill the session with n attendance rows (fresh trainees). */
  async function fill(tenantId: string, sessionId: string, n: number) {
    for (let i = 0; i < n; i += 1) {
      const t = await newTrainee(tenantId);
      await prisma.attendance.create({
        data: { tenantId, sessionId, traineeId: t.id },
      });
    }
  }

  describe('POST /sessions/:id/waitlist', () => {
    it('queues a trainee on a full session (201)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a);
      await fill(a.tenantId, session.id, 1);
      const t = await newTrainee(a.tenantId);

      const res = await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(201);
      expect(res.body.traineeId).toBe(t.id);
      expect(res.body.sessionId).toBe(session.id);
    });

    it('rejects a duplicate entry (409)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a);
      await fill(a.tenantId, session.id, 1);
      const t = await newTrainee(a.tenantId);
      await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(201);
      const res = await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(409);
      expect(res.body.code).toBe('WAITLIST_TRAINEE_ALREADY_QUEUED');
    });

    it('rejects when the class waitlist mode is NONE (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a, { waitlistMode: WaitlistMode.NONE });
      await fill(a.tenantId, session.id, 1);
      const t = await newTrainee(a.tenantId);
      const res = await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(400);
      expect(res.body.code).toBe('WAITLIST_DISABLED');
    });

    it('rejects while spots remain (400 SESSION_NOT_FULL)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a, { capacity: 2 });
      await fill(a.tenantId, session.id, 1);
      const t = await newTrainee(a.tenantId);
      const res = await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(400);
      expect(res.body.code).toBe('SESSION_NOT_FULL');
    });

    it('rejects on an unlimited-capacity class (400 SESSION_NOT_FULL)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a, { capacity: null });
      await fill(a.tenantId, session.id, 3);
      const t = await newTrainee(a.tenantId);
      const res = await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(400);
      expect(res.body.code).toBe('SESSION_NOT_FULL');
    });

    it('rejects a trainee already on the session (409)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a);
      const t = await newTrainee(a.tenantId);
      await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: t.id },
      });
      const res = await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(409);
      expect(res.body.code).toBe('ATTENDANCE_TRAINEE_ALREADY_ON_SESSION');
    });

    it('consumes no card visit (AC #5 pin)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a);
      await fill(a.tenantId, session.id, 1);
      const t = await newTrainee(a.tenantId);
      const fee = await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          traineeId: t.id,
          amount: 100,
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-12-01'),
        },
      });
      const card = await prisma.card.create({
        data: {
          tenantId: a.tenantId,
          traineeId: t.id,
          feeId: fee.id,
          totalVisits: 10,
          price: 100,
        },
      });
      await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(201);
      const consumed = await prisma.cardConsumption.count({ where: { cardId: card.id } });
      expect(consumed).toBe(0);
    });

    it('allows an EMPLOYEE who trains the session', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const session = await mkSession(a, { trainerId: a.userId });
      await fill(a.tenantId, session.id, 1);
      const t = await newTrainee(a.tenantId);
      await request(server)
        .post(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .send({ traineeId: t.id })
        .expect(201);
    });

    it('rejects a CUSTOMER (403)', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      await request(server)
        .post(`/sessions/whatever/waitlist`)
        .set(send(a))
        .send({ traineeId: 'x' })
        .expect(403);
    });
  });

  describe('GET /sessions/:id/waitlist', () => {
    it('lists entries in createdAt order with trainee names', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a);
      const t1 = await newTrainee(a.tenantId);
      const t2 = await newTrainee(a.tenantId);
      // Explicit timestamps — API-created rows could tie on SQLite's clock.
      await prisma.waitlistEntry.create({
        data: {
          tenantId: a.tenantId,
          sessionId: session.id,
          traineeId: t2.id,
          createdAt: new Date('2026-09-02T10:00:00Z'),
        },
      });
      await prisma.waitlistEntry.create({
        data: {
          tenantId: a.tenantId,
          sessionId: session.id,
          traineeId: t1.id,
          createdAt: new Date('2026-09-01T10:00:00Z'),
        },
      });

      const res = await request(server)
        .get(`/sessions/${session.id}/waitlist`)
        .set(send(a))
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].traineeId).toBe(t1.id);
      expect(res.body[1].traineeId).toBe(t2.id);
      expect(res.body[0].trainee.lastName).toBe(t1.lastName);
    });
  });

  describe('DELETE /sessions/:id/waitlist/:entryId', () => {
    it('removes an entry (204)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a);
      const t = await newTrainee(a.tenantId);
      const entry = await prisma.waitlistEntry.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: t.id },
      });
      await request(server)
        .delete(`/sessions/${session.id}/waitlist/${entry.id}`)
        .set(send(a))
        .expect(204);
      const left = await prisma.waitlistEntry.count({ where: { sessionId: session.id } });
      expect(left).toBe(0);
    });

    it('404 on an unknown entry', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const session = await mkSession(a);
      await request(server)
        .delete(`/sessions/${session.id}/waitlist/nope`)
        .set(send(a))
        .expect(404);
    });
  });

  describe('customer waitlist (TKT-0121)', () => {
    const HOUR = 3_600_000;
    /** A self-bookable, queueable session; `full` seats it to capacity like a real full class. */
    async function queueSetup(opts?: {
      allow?: boolean;
      cutoff?: number | null;
      capacity?: number | null;
      waitlistMode?: WaitlistMode;
      startsInMs?: number;
      guarded?: boolean;
      enrolled?: boolean;
      full?: boolean;
    }) {
      const a = await setupActor(UserRole.CUSTOMER);
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'T',
          lastName: randomUUID().slice(0, 8),
          dateOfBirth: new Date('2000-01-01'),
          ...(opts?.guarded
            ? { guardians: { connect: [{ id: a.userId }] } }
            : { userId: a.userId }),
        },
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Queue-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          capacity: opts?.capacity === undefined ? 1 : opts.capacity,
          waitlistMode: opts?.waitlistMode ?? WaitlistMode.FIFO_AUTO,
          allowSelfBooking: opts?.allow ?? true,
          bookingCutoffMin: opts?.cutoff ?? null,
          locations: { connect: [{ id: a.locationId }] },
          ...(opts?.enrolled === false ? {} : { trainees: { connect: [{ id: trainee.id }] } }),
        },
      });
      const startsAt = new Date(Date.now() + (opts?.startsInMs ?? 6 * HOUR));
      const session = await prisma.session.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          locationId: a.locationId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR),
          status: SessionStatus.SCHEDULED,
        },
      });
      if (opts?.full !== false) await fill(a.tenantId, session.id, opts?.capacity ?? 1);
      return { a, trainee, cls, session };
    }
    const join = (a: TestActor, sessionId: string, traineeId: string) =>
      request(server).post(`/me/sessions/${sessionId}/waitlist`).set(send(a)).send({ traineeId });
    const leave = (a: TestActor, sessionId: string, traineeId: string) =>
      request(server).delete(`/me/sessions/${sessionId}/waitlist/${traineeId}`).set(send(a));

    it('a linked customer queues on a full session (201)', async () => {
      const { a, trainee, session } = await queueSetup();
      const res = await join(a, session.id, trainee.id).expect(201);
      expect(res.body.traineeId).toBe(trainee.id);
      expect(
        await prisma.waitlistEntry.count({ where: { sessionId: session.id, traineeId: trainee.id } }),
      ).toBe(1);
    });

    it('a guardian queues a guarded trainee (201)', async () => {
      const { a, trainee, session } = await queueSetup({ guarded: true });
      await join(a, session.id, trainee.id).expect(201);
    });

    it("rejects another family's trainee with 403", async () => {
      const { a, session } = await queueSetup();
      const stranger = await newTrainee(a.tenantId);
      await join(a, session.id, stranger.id).expect(403);
    });

    it('answers 404 for an unknown session', async () => {
      const { a, trainee } = await queueSetup();
      await join(a, 'nope', trainee.id).expect(404);
    });

    it('rejects a class with self-booking off (409 SELF_BOOKING_DISABLED)', async () => {
      const { a, trainee, session } = await queueSetup({ allow: false });
      const res = await join(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('SELF_BOOKING_DISABLED');
    });

    it('rejects a trainee not enrolled in the class (409 SELF_BOOKING_NOT_ENROLLED)', async () => {
      const { a, trainee, session } = await queueSetup({ enrolled: false });
      const res = await join(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('SELF_BOOKING_NOT_ENROLLED');
    });

    it('rejects a join inside the cutoff (409 BOOKING_CLOSED)', async () => {
      const { a, trainee, session } = await queueSetup({ cutoff: 60, startsInMs: HOUR / 2 });
      const res = await join(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('BOOKING_CLOSED');
    });

    it('rejects while the session still has spots (400 SESSION_NOT_FULL)', async () => {
      const { a, trainee, session } = await queueSetup({ capacity: 2, full: false });
      const res = await join(a, session.id, trainee.id).expect(400);
      expect(res.body.code).toBe('SESSION_NOT_FULL');
    });

    it('rejects a class with no waitlist (400 WAITLIST_DISABLED)', async () => {
      const { a, trainee, session } = await queueSetup({ waitlistMode: WaitlistMode.NONE });
      const res = await join(a, session.id, trainee.id).expect(400);
      expect(res.body.code).toBe('WAITLIST_DISABLED');
    });

    it('rejects a trainee already on the session (409 ATTENDANCE_TRAINEE_ALREADY_ON_SESSION)', async () => {
      // Capacity 1 taken by the trainee themselves — full, but they are the one sitting in it.
      const { a, trainee, session } = await queueSetup({ full: false });
      await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: trainee.id },
      });
      const res = await join(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('ATTENDANCE_TRAINEE_ALREADY_ON_SESSION');
    });

    it('rejects a second join (409 WAITLIST_TRAINEE_ALREADY_QUEUED)', async () => {
      const { a, trainee, session } = await queueSetup();
      await join(a, session.id, trainee.id).expect(201);
      const res = await join(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('WAITLIST_TRAINEE_ALREADY_QUEUED');
    });

    it('staff roles cannot use the customer join door (403)', async () => {
      const { trainee, session } = await queueSetup();
      const admin = await setupActor(UserRole.ADMIN);
      await join(admin, session.id, trainee.id).expect(403);
    });

    it('leaving removes the entry (204)', async () => {
      const { a, trainee, session } = await queueSetup();
      await join(a, session.id, trainee.id).expect(201);

      await leave(a, session.id, trainee.id).expect(204);

      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(0);
    });

    // AC #2: leaving is always safe, so the cutoff does not gate it.
    it('leaving works past the cutoff (204)', async () => {
      const { a, trainee, session } = await queueSetup({ cutoff: 60, startsInMs: HOUR / 2 });
      await prisma.waitlistEntry.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: trainee.id },
      });

      await leave(a, session.id, trainee.id).expect(204);

      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(0);
    });

    it('answers 404 when the trainee is not queued', async () => {
      const { a, trainee, session } = await queueSetup();
      await leave(a, session.id, trainee.id).expect(404);
    });

    it("rejects leaving for another family's trainee with 403", async () => {
      const { a, session } = await queueSetup();
      const stranger = await newTrainee(a.tenantId);
      await prisma.waitlistEntry.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: stranger.id },
      });

      await leave(a, session.id, stranger.id).expect(403);
      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it('staff roles cannot use the customer leave door (403)', async () => {
      const { trainee, session } = await queueSetup();
      const admin = await setupActor(UserRole.ADMIN);
      await leave(admin, session.id, trainee.id).expect(403);
    });

    // AC #4: no new entry kind — a staff removal promotes a customer-created entry like any other.
    it('a customer-created entry is promoted by a staff removal like a staff-created one', async () => {
      const { a, trainee, session } = await queueSetup();
      await join(a, session.id, trainee.id).expect(201);
      const sitting = await prisma.attendance.findFirstOrThrow({
        where: { sessionId: session.id },
      });
      // setupActor always mints a fresh tenant, so the staff actor for this session is made here.
      const admin = await createTestUser(prisma, {
        email: `${randomUUID()}@x`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.ADMIN,
        tenantId: a.tenantId,
        locations: { connect: [{ id: a.locationId }] },
      });
      const tokens = await auth.login(admin);
      await request(server)
        .delete(`/sessions/${session.id}/attendances/${sitting.id}`)
        .set({ Authorization: `Bearer ${tokens.accessToken}`, 'X-Tenant-Id': a.tenantId })
        .expect(204);

      expect(
        await prisma.attendance.count({ where: { sessionId: session.id, traineeId: trainee.id } }),
      ).toBe(1);
      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(0);
    });
  });

  it('deleting a session deletes its waitlist entries (cascade)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const session = await mkSession(a);
    const t = await newTrainee(a.tenantId);
    await prisma.waitlistEntry.create({
      data: { tenantId: a.tenantId, sessionId: session.id, traineeId: t.id },
    });
    await prisma.session.delete({ where: { id: session.id } });
    const left = await prisma.waitlistEntry.count({ where: { tenantId: a.tenantId } });
    expect(left).toBe(0);
  });
});
