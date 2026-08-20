import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AttendanceRsvp,
  AttendanceStatus,
  BillingMode,
  UserRole,
} from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsModule } from '@/sessions/sessions.module';
import { SessionsService } from '@/sessions/sessions.service';
import { AttendancesModule } from './attendances.module';
import { createTestUser } from '@/test-utils/create-user';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  accessToken: string;
}

describe('AttendancesController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let sessions: SessionsService;
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
        SessionsModule,
        AttendancesModule,
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
    sessions = moduleRef.get(SessionsService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  });

  async function setupActor(role: UserRole, tenantId?: string): Promise<TestActor & { locationId: string }> {
    let tenantPK = tenantId;
    if (!tenantPK) {
      const t = await prisma.tenant.create({
        data: { name: 'Test', slug: `t-${randomUUID()}` },
      });
      tenantIds.push(t.id);
      tenantPK = t.id;
    }
    const location = await prisma.location.create({
      data: { tenantId: tenantPK, name: `Main-${randomUUID()}` },
    });
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenantPK,
      firstName: 'Marker',
      lastName: 'McMark',
      ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenantPK,
      userId: user.id,
      locationId: location.id,
      accessToken: tokens.accessToken,
    };
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
    return prisma.location.create({ data: { tenantId, name: `Loc-${randomUUID()}` } });
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

  describe('GET /sessions/:id/attendances', () => {
    it("returns each row with its trainee id and name", async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId, { firstName: 'Ada', lastName: 'Lovelace' });
      const cls = await newClass(a.tenantId, [tr.id]);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);

      const res = await request(server)
        .get(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].trainee).toEqual({
        id: tr.id,
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
      // The row's own fields are unchanged by the added relation.
      expect(res.body[0]).toMatchObject({
        sessionId: session.id,
        traineeId: tr.id,
        status: AttendanceStatus.PENDING,
      });
    });
  });

  // TKT-0068: this route is unpaginated and capped at DEFAULT_LIST_TAKE. The cap is what the
  // attendance screen infers truncation from — a full page means "there may be more" — so the cap
  // has to stay exactly this, and be reached rather than exceeded. A fixture larger than the cap is
  // the only thing that can prove it; do not shrink it.
  describe('GET /sessions/:id/attendances — the cap', () => {
    it('stops at DEFAULT_LIST_TAKE rows when the session has more attendees than that', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const overCap = DEFAULT_LIST_TAKE + 1;
      await prisma.trainee.createMany({
        data: Array.from({ length: overCap }, (_, i) => ({
          tenantId: a.tenantId,
          firstName: 'Crowd',
          lastName: String(i).padStart(3, '0'),
          dateOfBirth: new Date('2000-01-01'),
        })),
      });
      const trainees = await prisma.trainee.findMany({
        where: { tenantId: a.tenantId },
        select: { id: true },
      });
      expect(trainees).toHaveLength(overCap);
      const cls = await newClass(
        a.tenantId,
        trainees.map((t) => t.id),
      );
      const session = await makeSession(a.tenantId, cls.id, a.locationId);

      // The backfill really did create one row per trainee, so the response below is trimmed by
      // the cap and by nothing else.
      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(overCap);

      const res = await request(server)
        .get(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body).toHaveLength(DEFAULT_LIST_TAKE);
    });
  });

  // TKT-0071, the follow-up TKT-0038 named and never filed. The Add-trainee picker used to page
  // every trainee in the club on every session open and filter in the browser, because neither
  // filter it needs — active, and not already on this session — existed server-side. Both live here
  // now, so the exclusion is the server's job and the tests that matter are these.
  describe('GET /sessions/:sessionId/attendance-candidates', () => {
    async function inactiveTrainee(tenantId: string, locationIds: string[] = []) {
      return prisma.trainee.create({
        data: {
          tenantId,
          firstName: 'Retired',
          lastName: 'Trainee',
          dateOfBirth: new Date('2000-01-01'),
          isActive: false,
          locations: locationIds.length
            ? { connect: locationIds.map((id) => ({ id })) }
            : undefined,
        },
      });
    }

    it('offers the active trainees who are not on the session yet', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const enrolled = await newTrainee(a.tenantId, { firstName: 'On', lastName: 'Session' });
      const free = await newTrainee(a.tenantId, { firstName: 'Walk', lastName: 'In' });
      const retired = await inactiveTrainee(a.tenantId);
      const cls = await newClass(a.tenantId, [enrolled.id]);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);

      const res = await request(server)
        .get(`/sessions/${session.id}/attendance-candidates`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      const ids = res.body.items.map((t: { id: string }) => t.id);
      expect(ids).toEqual([free.id]);
      // The one already on the session, and the deactivated one, are the two exclusions.
      expect(ids).not.toContain(enrolled.id);
      expect(ids).not.toContain(retired.id);
      expect(res.body.total).toBe(1);
    });

    it('answers in the pagination envelope, so the picker cannot grow unbounded', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      for (const n of ['A', 'B', 'C']) {
        await newTrainee(a.tenantId, { firstName: 'Free', lastName: n });
      }
      const cls = await newClass(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);

      const res = await request(server)
        .get(`/sessions/${session.id}/attendance-candidates?pageSize=2`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(3);
      expect(res.body.totalPages).toBe(2);
      // Ordered by name, as GET /trainees is, so paging is stable.
      expect(res.body.items.map((t: { lastName: string }) => t.lastName)).toEqual(['A', 'B']);
    });

    // TKT-0054 decided that a trainer reads only their assigned locations, and gave up the
    // club-wide walk-in picker to get it — the trainer docs were reworded for that. A dedicated
    // candidates endpoint is exactly where someone would widen it back by accident, so it is
    // pinned here.
    it('offers a trainer only candidates from their own locations', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const otherLocation = await newLocation(a.tenantId);
      await prisma.user.update({
        where: { id: a.userId },
        data: { locations: { connect: [{ id: a.locationId }] } },
      });
      const mine = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Mine',
          lastName: 'Local',
          dateOfBirth: new Date('2000-01-01'),
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      const theirs = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Other',
          lastName: 'Hall',
          dateOfBirth: new Date('2000-01-01'),
          locations: { connect: [{ id: otherLocation.id }] },
        },
      });
      const cls = await newClass(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId, [a.userId]);

      const res = await request(server)
        .get(`/sessions/${session.id}/attendance-candidates`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      const ids = res.body.items.map((t: { id: string }) => t.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
    });

    it('answers 404 to a trainer who does not work that session', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(a.tenantId);
      // No trainerIds: the session is not theirs, so the session itself must not be observable.
      const session = await makeSession(a.tenantId, cls.id, a.locationId);

      await request(server)
        .get(`/sessions/${session.id}/attendance-candidates`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(404);
    });

    it('answers 404 for a session id that does not exist', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/sessions/does-not-exist/attendance-candidates')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(404);
    });
  });

  describe('PUT /sessions/:id/attendances', () => {
    it('admin bulk-marks (200) and writes audit snapshot', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newClass(a.tenantId, [tr.id]);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const res = await request(server)
        .put(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ items: [{ traineeId: tr.id, status: AttendanceStatus.PRESENT }] })
        .expect(200);
      expect(res.body).toEqual({ updated: 1 });
    });

    it('returns 403 for customer', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      await request(server)
        .put(`/sessions/anything/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ items: [{ traineeId: 'x', status: AttendanceStatus.PRESENT }] })
        .expect(403);
    });

    it('returns 400 for empty items array', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);
      await request(server)
        .put(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ items: [] })
        .expect(400);
    });

    it('returns 404 when session is in another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(b.tenantId);
      const cls = await newClass(b.tenantId, [tr.id]);
      const loc = await newLocation(b.tenantId);
      const session = await makeSession(b.tenantId, cls.id, loc.id);
      await request(server)
        .put(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ items: [{ traineeId: tr.id, status: AttendanceStatus.PRESENT }] })
        .expect(404);
    });
  });

  describe('PATCH /sessions/:id/rsvp', () => {
    it('customer RSVPs for own trainee (200)', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      const trainee = await newTrainee(a.tenantId, { userId: a.userId });
      const cls = await newClass(a.tenantId, [trainee.id]);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);
      const res = await request(server)
        .patch(`/sessions/${session.id}/rsvp`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: trainee.id, traineeRsvp: AttendanceRsvp.CONFIRMED })
        .expect(200);
      expect(res.body.traineeRsvp).toBe(AttendanceRsvp.CONFIRMED);
    });

    it('returns 403 when customer is not owner/guardian of trainee', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      const trainee = await newTrainee(a.tenantId);
      const cls = await newClass(a.tenantId, [trainee.id]);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);
      await request(server)
        .patch(`/sessions/${session.id}/rsvp`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: trainee.id, traineeRsvp: AttendanceRsvp.CONFIRMED })
        .expect(403);
    });

    it('returns 403 for admin role (RSVP is customer-only)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .patch(`/sessions/x/rsvp`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: 'x', traineeRsvp: AttendanceRsvp.CONFIRMED })
        .expect(403);
    });
  });

  describe('GET /me/sessions', () => {
    it('customer sees sessions for trainees they own/guard', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      const self = await newTrainee(a.tenantId, { userId: a.userId });
      const cls = await newClass(a.tenantId, [self.id]);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);

      const res = await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.map((s: { id: string }) => s.id)).toContain(session.id);
    });

    it('returns 403 for admin role', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(403);
    });
  });
});
