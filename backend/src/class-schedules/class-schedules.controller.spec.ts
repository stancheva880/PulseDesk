import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BillingMode, UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { PrismaService } from '@/prisma/prisma.service';
import { ClassSchedulesModule } from './class-schedules.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  locationId: string;
  accessToken: string;
}

describe('ClassSchedulesController (e2e-ish)', () => {
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
        ClassSchedulesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // AppModule registers this as an APP_INTERCEPTOR; this spec builds its own module graph,
    // so it wires the interceptor the same way it wires the ValidationPipe above.
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
    const slug = `t-${randomUUID()}`;
    const tenant = await prisma.tenant.create({ data: { name: 'Test', slug } });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Main-${randomUUID()}` },
    });
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenant.id,
      ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenant.id,
      userId: user.id,
      locationId: location.id,
      accessToken: tokens.accessToken,
    };
  }

  async function newClass(tenantId: string) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      },
    });
  }
  async function newLocation(tenantId: string) {
    return prisma.location.create({
      data: { tenantId, name: `Loc-${randomUUID()}` },
    });
  }

  describe('POST /class-schedules', () => {
    it('admin creates a schedule (201)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const res = await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        })
        .expect(201);
      expect(res.body.tenantId).toBe(a.tenantId);
    });

    it('returns 400 when startTime is malformed', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: loc.id,
          dayOfWeek: 'MON',
          startTime: '6pm',
          endTime: '19:00',
        })
        .expect(400);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: loc.id,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        })
        .expect(403);
    });
  });

  describe('GET /class-schedules', () => {
    // Added by TKT-0046: the module had no list or detail coverage, so no controller test could
    // fail when the list shape changed. Both routes now parse through ClassScheduleSchema.
    async function createSchedule(
      a: TestActor,
      classId: string,
      body: { dayOfWeek: string; startTime: string; endTime: string },
    ) {
      const res = await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ classId, locationId: a.locationId, ...body })
        .expect(201);
      return res.body as { id: string };
    }

    it('admin lists schedules with the paginated envelope, earliest slot first', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      await createSchedule(a, cls.id, {
        dayOfWeek: 'MON',
        startTime: '18:00',
        endTime: '19:00',
      });
      await createSchedule(a, cls.id, {
        dayOfWeek: 'MON',
        startTime: '09:30',
        endTime: '10:30',
      });

      const res = await request(server)
        .get('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual([
        'items',
        'page',
        'pageSize',
        'total',
        'totalPages',
      ]);
      expect(res.body.total).toBe(2);
      expect(res.body.items.map((s: { startTime: string }) => s.startTime)).toEqual([
        '09:30',
        '18:00',
      ]);
      expect(res.body.items.map((s: { dayOfWeek: string }) => s.dayOfWeek)).toEqual([
        'MON',
        'MON',
      ]);
    });

    it('admin reads one schedule, times unchanged as HH:MM', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const created = await createSchedule(a, cls.id, {
        dayOfWeek: 'WED',
        startTime: '07:05',
        endTime: '08:15',
      });

      const res = await request(server)
        .get(`/class-schedules/${created.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.dayOfWeek).toBe('WED');
      expect(res.body.startTime).toBe('07:05');
      expect(res.body.endTime).toBe('08:15');
      expect(res.body.tenantId).toBe(a.tenantId);
    });
  });

  // TKT-? — an EMPLOYEE now reads (never writes) the schedules of the classes they teach.
  describe('GET /class-schedules — EMPLOYEE', () => {
    it('lists only schedules for classes the employee teaches (200)', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const ownClass = await newClass(e.tenantId);
      const otherClass = await newClass(e.tenantId);
      await prisma.class.update({
        where: { id: ownClass.id },
        data: { trainers: { connect: { id: e.userId } } },
      });
      await prisma.classSchedule.create({
        data: {
          tenantId: e.tenantId,
          classId: ownClass.id,
          locationId: e.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        },
      });
      await prisma.classSchedule.create({
        data: {
          tenantId: e.tenantId,
          classId: otherClass.id,
          locationId: e.locationId,
          dayOfWeek: 'TUE',
          startTime: '18:00',
          endTime: '19:00',
        },
      });

      const res = await request(server)
        .get('/class-schedules')
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].classId).toBe(ownClass.id);
    });

    it('404s on a schedule for a class the employee does not teach', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(e.tenantId);
      const sched = await prisma.classSchedule.create({
        data: {
          tenantId: e.tenantId,
          classId: cls.id,
          locationId: e.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        },
      });

      await request(server)
        .get(`/class-schedules/${sched.id}`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .expect(404);
    });
  });

  describe('PATCH /class-schedules/:id — EMPLOYEE', () => {
    it('returns 403 — schedule writes stay ADMIN-only', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(e.tenantId);
      const sched = await prisma.classSchedule.create({
        data: {
          tenantId: e.tenantId,
          classId: cls.id,
          locationId: e.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        },
      });

      await request(server)
        .patch(`/class-schedules/${sched.id}`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .send({ startTime: '17:00' })
        .expect(403);
    });
  });

  describe('DELETE /class-schedules/:id — EMPLOYEE', () => {
    it('returns 403 — schedule writes stay ADMIN-only', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(e.tenantId);
      const sched = await prisma.classSchedule.create({
        data: {
          tenantId: e.tenantId,
          classId: cls.id,
          locationId: e.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        },
      });

      await request(server)
        .delete(`/class-schedules/${sched.id}`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .expect(403);
    });
  });

  describe('POST /class-schedules/generate-sessions', () => {
    it('admin generates sessions with a summary response', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        })
        .expect(201);

      const res = await request(server)
        .post('/class-schedules/generate-sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ from: '2026-06-01', to: '2026-06-28' })
        .expect(200);
      expect(res.body).toEqual({ created: 4, skipped: 0 });
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/class-schedules/generate-sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ from: '2026-06-01', to: '2026-06-28' })
        .expect(403);
    });

    // TKT-0123: every candidate day is created inside ONE interactive transaction, each session
    // writing an attendance row per enrolled trainee plus its card consumption. Only `from <= to`
    // was checked, so a mistyped year was an outage against SQLite's single writer rather than a
    // rejected request. DashboardService already bounds its range the same way.
    it('rejects a range longer than the cap → 400', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/class-schedules/generate-sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ from: '2026-01-01', to: '2036-01-01' })
        .expect(400);
      expect(res.body.code).toBe('SCHEDULE_RANGE_TOO_LARGE');
    });

    it('accepts a full year, which is the realistic maximum a club plans ahead', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/class-schedules/generate-sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ from: '2026-01-01', to: '2026-12-31' })
        .expect(200);
    });

    // TKT-0126: the mechanism that stops a retired hall generating. Deactivating a location
    // flips its schedules (locations.controller.spec.ts) and an inactive schedule generates
    // nothing (here) — the two compose, joined by ClassSchedule.isActive. Untested before this
    // ticket, despite the filter existing since the endpoint shipped.
    it('skips an inactive schedule', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const schedule = await prisma.classSchedule.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          locationId: a.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        },
      });
      await prisma.classSchedule.update({
        where: { id: schedule.id },
        data: { isActive: false },
      });

      const res = await request(server)
        .post('/class-schedules/generate-sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ from: '2026-01-01', to: '2026-03-31' })
        .expect(200);
      expect(res.body.created).toBe(0);
      expect(await prisma.session.count({ where: { tenantId: a.tenantId } })).toBe(0);
    });
  });

  // TKT-0125: the schedules half of the same rule the sessions spec covers — a deactivated
  // hall takes no new recurring slot either. First PATCH tests in this file.
  describe('a deactivated location (TKT-0125)', () => {
    /** A second hall the actor is also assigned to, so only `isActive` can be what refuses. */
    async function secondHall(a: TestActor, opts: { active: boolean }) {
      const loc = await prisma.location.create({
        data: { tenantId: a.tenantId, name: `Retired-${randomUUID()}`, isActive: opts.active },
      });
      await prisma.user.update({
        where: { id: a.userId },
        data: { locations: { connect: [{ id: loc.id }] } },
      });
      return loc;
    }

    async function postSchedule(a: TestActor, classId: string, locationId: string) {
      const res = await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ classId, locationId, dayOfWeek: 'MON', startTime: '18:00', endTime: '19:00' })
        .expect(201);
      return res.body as { id: string; locationId: string };
    }

    it('POST /class-schedules refuses it (400 LOCATION_INACTIVE)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const retired = await secondHall(a, { active: false });

      const res = await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: retired.id,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        })
        .expect(400);
      expect(res.body.code).toBe('LOCATION_INACTIVE');
      expect(await prisma.classSchedule.count({ where: { locationId: retired.id } })).toBe(0);
    });

    it('PATCH /class-schedules/:id refuses a move onto it (400 LOCATION_INACTIVE)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const schedule = await postSchedule(a, cls.id, a.locationId);
      const retired = await secondHall(a, { active: false });

      const res = await request(server)
        .patch(`/class-schedules/${schedule.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ locationId: retired.id })
        .expect(400);
      expect(res.body.code).toBe('LOCATION_INACTIVE');

      const after = await prisma.classSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      expect(after.locationId).toBe(a.locationId);
    });

    it('PATCH /class-schedules/:id allows a resend of the row own deactivated location (200)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const hall = await secondHall(a, { active: true });
      const schedule = await postSchedule(a, cls.id, hall.id);
      await prisma.location.update({ where: { id: hall.id }, data: { isActive: false } });

      const res = await request(server)
        .patch(`/class-schedules/${schedule.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ locationId: hall.id, startTime: '17:00' })
        .expect(200);
      expect(res.body.locationId).toBe(hall.id);
      expect(res.body.startTime).toBe('17:00');
    });
  });
});
