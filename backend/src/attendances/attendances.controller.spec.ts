import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AttendanceRsvp,
  AttendanceStatus,
  BillingMode,
  ContactRelationship,
  UserRole,
  WaitlistMode,
} from '@prisma/client';
import { MailService } from '@/mail/mail.service';
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
import { createTestCard } from '@/test-utils/create-card';
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
  // Approved TEST CHANGE REQUEST, 2026-08-23: hardcoded 2026-06-01T18:00Z → a relative future
  // instant for makeSession (TKT-0120, named in the approved tech plan). From this ticket on,
  // freeing a spot only promotes while the session is still upcoming, so a fixture date that has
  // drifted into the past would make these tests assert the behaviour the ticket removes.
  // Callers that need a specific instant pass one.
  async function makeSession(
    tenantId: string,
    classId: string,
    locationId: string,
    trainerIds?: string[],
    startsAt: Date = new Date(Date.now() + 6 * 3_600_000),
  ) {
    return sessions.create(tenantId, {
      classId,
      locationId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
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

    // TKT-0102: the portal calendar asks for a visible window — from inclusive, to exclusive.
    async function customerWithClass() {
      const a = await setupActor(UserRole.CUSTOMER);
      const self = await newTrainee(a.tenantId, { userId: a.userId });
      const cls = await newClass(a.tenantId, [self.id]);
      const loc = await newLocation(a.tenantId);
      return { a, cls, loc };
    }
    function sessionRow(
      tenantId: string,
      classId: string,
      locationId: string,
      startsAt: string,
    ) {
      return {
        tenantId,
        classId,
        locationId,
        startsAt: new Date(startsAt),
        endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
      };
    }

    it('returns only sessions inside from/to', async () => {
      const { a, cls, loc } = await customerWithClass();
      await prisma.session.createMany({
        data: [
          sessionRow(a.tenantId, cls.id, loc.id, '2026-07-01T10:00:00.000Z'),
          sessionRow(a.tenantId, cls.id, loc.id, '2026-07-08T10:00:00.000Z'),
        ],
      });

      const res = await request(server)
        .get('/me/sessions?from=2026-07-01T00:00:00.000Z&to=2026-07-08T00:00:00.000Z')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].startsAt).toBe('2026-07-01T10:00:00.000Z');
    });

    it('answers an inverted range with an empty list', async () => {
      const { a, cls, loc } = await customerWithClass();
      await prisma.session.createMany({
        data: [sessionRow(a.tenantId, cls.id, loc.id, '2026-07-01T10:00:00.000Z')],
      });

      const res = await request(server)
        .get('/me/sessions?from=2026-07-08T00:00:00.000Z&to=2026-07-01T00:00:00.000Z')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('drops the DEFAULT_LIST_TAKE cap only when a range is given', async () => {
      const { a, cls, loc } = await customerWithClass();
      const overCap = DEFAULT_LIST_TAKE + 1;
      await prisma.session.createMany({
        data: Array.from({ length: overCap }, (_, i) =>
          sessionRow(
            a.tenantId,
            cls.id,
            loc.id,
            new Date(Date.UTC(2026, 6, 1, 6, i)).toISOString(),
          ),
        ),
      });

      const capped = await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(capped.body).toHaveLength(DEFAULT_LIST_TAKE);

      const ranged = await request(server)
        .get('/me/sessions?from=2026-07-01T00:00:00.000Z&to=2026-07-02T00:00:00.000Z')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(ranged.body).toHaveLength(overCap);
    });
  });
  describe('capacity (TKT-0103)', () => {
    async function cappedSetup(capacity: number | null) {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Cap-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 10,
          capacity,
          trainees: { connect: [{ id: tr.id }] },
        },
      });
      // makeSession runs auto-attendance, so the session starts with 1 row (tr).
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      return { a, session };
    }

    // Every attendance row consumes a spot — a declined RSVP does not free one.
    it('returns 409 with capacity and count when the session is full', async () => {
      const { a, session } = await cappedSetup(1);
      // The one occupant declines — the spot must still count as taken.
      await prisma.attendance.updateMany({
        where: { sessionId: session.id },
        data: { traineeRsvp: 'DECLINED' },
      });
      const dropIn = await newTrainee(a.tenantId);

      const res = await request(server)
        .post(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: dropIn.id })
        .expect(409);

      expect(res.body.code).toBe('ATTENDANCE_SESSION_FULL');
      expect(res.body.params).toEqual({ capacity: 1, count: 1 });
    });

    it('keeps accepting on an unlimited class', async () => {
      const { a, session } = await cappedSetup(null);
      const dropIn = await newTrainee(a.tenantId);

      await request(server)
        .post(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: dropIn.id })
        .expect(201);
    });

    it('candidates carry spotsLeft, and null when unlimited', async () => {
      const capped = await cappedSetup(3);
      const cappedRes = await request(server)
        .get(`/sessions/${capped.session.id}/attendance-candidates`)
        .set('Authorization', `Bearer ${capped.a.accessToken}`)
        .set('X-Tenant-Id', capped.a.tenantId)
        .expect(200);
      // capacity 3, one auto-enrolled occupant → 2 spots left.
      expect(cappedRes.body.spotsLeft).toBe(2);

      const unlimited = await cappedSetup(null);
      const unlimitedRes = await request(server)
        .get(`/sessions/${unlimited.session.id}/attendance-candidates`)
        .set('Authorization', `Bearer ${unlimited.a.accessToken}`)
        .set('X-Tenant-Id', unlimited.a.tenantId)
        .expect(200);
      expect(unlimitedRes.body.spotsLeft).toBeNull();
    });
  });

  // TKT-0107: booking consumes a visit from the trainee's best usable card;
  // deleting the booking returns it (FK cascade on CardConsumption).
  describe('card consumption (TKT-0107)', () => {
    async function bareSetup() {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId); // no enrolled trainees — no auto-attendance noise
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const dropIn = await newTrainee(a.tenantId);
      return { a, cls, session, dropIn };
    }
    function addTrainee(a: TestActor, sessionId: string, traineeId: string) {
      return request(server)
        .post(`/sessions/${sessionId}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId });
    }

    // TKT-0123: the duplicate check used to sit outside the transaction that inserts, leaving
    // @@unique([sessionId, traineeId]) as the only real barrier — and a raw P2002 answers 500
    // where the sequential case answers 409. Two simultaneous adds must land on the same door.
    it('two simultaneous adds of the same trainee: one 201, one 409, never a 500', async () => {
      const { a, session, dropIn } = await bareSetup();

      const results = await Promise.all([
        addTrainee(a, session.id, dropIn.id),
        addTrainee(a, session.id, dropIn.id),
      ]);
      const statuses = results.map((r) => r.status).sort();

      expect(statuses).toEqual([201, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(conflict.body.code).toBe('ATTENDANCE_TRAINEE_ALREADY_ON_SESSION');
      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it('manual add consumes a visit from the matching card', async () => {
      const { a, session, dropIn } = await bareSetup();
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: dropIn.id,
        totalVisits: 12,
      });

      const res = await addTrainee(a, session.id, dropIn.id).expect(201);

      const consumptions = await prisma.cardConsumption.findMany({ where: { cardId: card.id } });
      expect(consumptions).toHaveLength(1);
      expect(consumptions[0]!.attendanceId).toBe(res.body.id);
    });

    it('prefers the class-scoped card over the tenant-wide one', async () => {
      const { a, cls, session, dropIn } = await bareSetup();
      const tenantWide = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: dropIn.id,
        totalVisits: 5,
      });
      const classScoped = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: dropIn.id,
        classId: cls.id,
        totalVisits: 5,
      });

      await addTrainee(a, session.id, dropIn.id).expect(201);

      expect(await prisma.cardConsumption.count({ where: { cardId: classScoped.id } })).toBe(1);
      expect(await prisma.cardConsumption.count({ where: { cardId: tenantWide.id } })).toBe(0);
    });

    it('a card scoped to another class is not consumed (attendance still created)', async () => {
      const { a, session, dropIn } = await bareSetup();
      const otherClass = await newClass(a.tenantId);
      await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: dropIn.id,
        classId: otherClass.id,
        totalVisits: 5,
      });

      await addTrainee(a, session.id, dropIn.id).expect(201);

      expect(await prisma.cardConsumption.count({ where: { tenantId: a.tenantId } })).toBe(0);
    });

    it('skips cancelled and expired cards (attendance still created)', async () => {
      const { a, session, dropIn } = await bareSetup();
      await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: dropIn.id,
        totalVisits: 5,
        cancelledAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: dropIn.id,
        totalVisits: 5,
        expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await addTrainee(a, session.id, dropIn.id).expect(201);

      expect(await prisma.cardConsumption.count({ where: { tenantId: a.tenantId } })).toBe(0);
    });

    it('deleting the attendance removes the consumption (visit returned)', async () => {
      const { a, session, dropIn } = await bareSetup();
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: dropIn.id,
        totalVisits: 12,
      });
      const res = await addTrainee(a, session.id, dropIn.id).expect(201);
      expect(await prisma.cardConsumption.count({ where: { cardId: card.id } })).toBe(1);

      // No per-attendance endpoint exists — every delete path is a cascade, which this pins.
      await prisma.attendance.delete({ where: { id: res.body.id } });
      expect(await prisma.cardConsumption.count({ where: { cardId: card.id } })).toBe(0);
    });
  });

  // TKT-0108: candidates carry the card a booking would consume, and whether the trainee
  // holds any card at all — the pair the picker's warning is built from.
  describe('candidates card info (TKT-0108)', () => {
    async function candidatesFor(a: TestActor, sessionId: string) {
      const res = await request(server)
        .get(`/sessions/${sessionId}/attendance-candidates`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      return res.body.items as {
        id: string;
        card: { id: string; visitsRemaining: number } | null;
        hasCards: boolean;
      }[];
    }

    it('a usable-card holder carries the card that would be consumed', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const cls = await newClass(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const tr = await newTrainee(a.tenantId);
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: tr.id,
        totalVisits: 12,
      });

      const items = await candidatesFor(a, session.id);
      const row = items.find((i) => i.id === tr.id)!;
      expect(row.card).toMatchObject({ id: card.id, visitsRemaining: 12, classScoped: false });
      expect(row.hasCards).toBe(true);
    });

    it('an exhausted-card holder gets card null but hasCards true', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const cls = await newClass(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const otherSession = await makeSession(a.tenantId, cls.id, a.locationId);
      const tr = await newTrainee(a.tenantId);
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: tr.id,
        totalVisits: 1,
      });
      // Drain the single visit with a booking on the other session.
      const spent = await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: otherSession.id, traineeId: tr.id },
      });
      await prisma.cardConsumption.create({
        data: { tenantId: a.tenantId, cardId: card.id, attendanceId: spent.id },
      });

      const items = await candidatesFor(a, session.id);
      const row = items.find((i) => i.id === tr.id)!;
      expect(row.card).toBeNull();
      expect(row.hasCards).toBe(true);
    });

    it('a never-carded trainee gets card null and hasCards false', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const cls = await newClass(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const tr = await newTrainee(a.tenantId);

      const items = await candidatesFor(a, session.id);
      const row = items.find((i) => i.id === tr.id)!;
      expect(row.card).toBeNull();
      expect(row.hasCards).toBe(false);
    });

    it('a card scoped to another class does not surface as consumable here', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const cls = await newClass(a.tenantId);
      const otherClass = await newClass(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const tr = await newTrainee(a.tenantId);
      await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: tr.id,
        classId: otherClass.id,
        totalVisits: 5,
      });

      const items = await candidatesFor(a, session.id);
      const row = items.find((i) => i.id === tr.id)!;
      expect(row.card).toBeNull();
      expect(row.hasCards).toBe(true);
    });
  });

  describe('DELETE /sessions/:id/attendances/:id + FIFO promotion (TKT-0113)', () => {
    const send = (a: TestActor) => ({
      Authorization: `Bearer ${a.accessToken}`,
      'X-Tenant-Id': a.tenantId,
    });

    async function queueClass(
      tenantId: string,
      locationId: string,
      opts: { capacity?: number; waitlistMode?: WaitlistMode; cutoff?: number } = {},
    ) {
      return prisma.class.create({
        data: {
          tenantId,
          name: `Q-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 10,
          capacity: opts.capacity ?? 1,
          waitlistMode: opts.waitlistMode ?? WaitlistMode.FIFO_AUTO,
          // A cutoff only exists on a self-bookable class — keep the pair consistent.
          allowSelfBooking: opts.cutoff !== undefined,
          bookingCutoffMin: opts.cutoff,
          locations: { connect: [{ id: locationId }] },
        },
      });
    }
    const attend = (tenantId: string, sessionId: string, traineeId: string) =>
      prisma.attendance.create({ data: { tenantId, sessionId, traineeId } });
    const queue = (tenantId: string, sessionId: string, traineeId: string, createdAt: string) =>
      prisma.waitlistEntry.create({ data: { tenantId, sessionId, traineeId, createdAt: new Date(createdAt) } });
    const del = (a: TestActor, sessionId: string, attendanceId: string) =>
      request(server)
        .delete(`/sessions/${sessionId}/attendances/${attendanceId}`)
        .set(send(a));

    it('promotes the oldest queued trainee when a spot frees (FIFO_AUTO)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const older = await newTrainee(a.tenantId);
      const newer = await newTrainee(a.tenantId);
      await queue(a.tenantId, session.id, older.id, '2026-05-01T08:00:00Z');
      await queue(a.tenantId, session.id, newer.id, '2026-05-01T09:00:00Z');

      await del(a, session.id, row.id).expect(204);

      const rows = await prisma.attendance.findMany({ where: { sessionId: session.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.traineeId).toBe(older.id);
      expect(rows[0]!.status).toBe(AttendanceStatus.PENDING);
      const left = await prisma.waitlistEntry.findMany({ where: { sessionId: session.id } });
      expect(left).toHaveLength(1);
      expect(left[0]!.traineeId).toBe(newer.id);
    });

    it('a promotion consumes a card visit like any booking', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const promotee = await newTrainee(a.tenantId);
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: promotee.id,
        totalVisits: 3,
      });
      await queue(a.tenantId, session.id, promotee.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row.id).expect(204);

      const consumptions = await prisma.cardConsumption.findMany({ where: { cardId: card.id } });
      expect(consumptions).toHaveLength(1);
      const booked = await prisma.attendance.findFirstOrThrow({
        where: { sessionId: session.id, traineeId: promotee.id },
      });
      expect(consumptions[0]!.attendanceId).toBe(booked.id);
    });

    it('does not promote when the class mode is CLAIM', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId, { waitlistMode: WaitlistMode.CLAIM });
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const queued = await newTrainee(a.tenantId);
      await queue(a.tenantId, session.id, queued.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row.id).expect(204);

      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it('plain delete when the queue is empty', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);

      await del(a, session.id, row.id).expect(204);
      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(0);
    });

    // AC #3 — a delete on an over-full session (backfill overflow) frees no spot.
    it('does not promote while the session is still at capacity', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId, { capacity: 1 });
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const t1 = await newTrainee(a.tenantId);
      const t2 = await newTrainee(a.tenantId);
      const row1 = await attend(a.tenantId, session.id, t1.id);
      await attend(a.tenantId, session.id, t2.id);
      const queued = await newTrainee(a.tenantId);
      await queue(a.tenantId, session.id, queued.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row1.id).expect(204);

      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(1);
      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(1);
    });

    // AC #3 — several freed spots fill oldest-first, and only up to capacity.
    it('fills multiple freed spots oldest first', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId, { capacity: 2 });
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const tA = await newTrainee(a.tenantId);
      const tB = await newTrainee(a.tenantId);
      const tC = await newTrainee(a.tenantId);
      await queue(a.tenantId, session.id, tA.id, '2026-05-01T08:00:00Z');
      await queue(a.tenantId, session.id, tB.id, '2026-05-01T09:00:00Z');
      await queue(a.tenantId, session.id, tC.id, '2026-05-01T10:00:00Z');

      await del(a, session.id, row.id).expect(204);

      const rows = await prisma.attendance.findMany({ where: { sessionId: session.id } });
      expect(rows.map((r) => r.traineeId).sort()).toEqual([tA.id, tB.id].sort());
      const left = await prisma.waitlistEntry.findMany({ where: { sessionId: session.id } });
      expect(left).toHaveLength(1);
      expect(left[0]!.traineeId).toBe(tC.id);
    });

    it('mails the linked account when the promoted trainee has one', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const mail = app.get(MailService);
      const spy = vi.spyOn(mail, 'sendWaitlistPromotion').mockResolvedValue(undefined);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const account = await createTestUser(prisma, {
        email: `${randomUUID()}@promoted.example`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.CUSTOMER,
        tenantId: a.tenantId,
      });
      const promotee = await newTrainee(a.tenantId, { userId: account.id });
      await queue(a.tenantId, session.id, promotee.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row.id).expect(204);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].to).toBe(account.email);
      spy.mockRestore();
    });

    it('mails every contact-person email when there is no linked account', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const mail = app.get(MailService);
      const spy = vi.spyOn(mail, 'sendWaitlistPromotion').mockResolvedValue(undefined);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const promotee = await newTrainee(a.tenantId);
      await prisma.contactPerson.createMany({
        data: [
          {
            tenantId: a.tenantId, traineeId: promotee.id, firstName: 'P', lastName: '1',
            relationship: ContactRelationship.PARENT, email: 'parent1@example.test',
          },
          {
            tenantId: a.tenantId, traineeId: promotee.id, firstName: 'P', lastName: '2',
            relationship: ContactRelationship.PARENT, email: 'parent2@example.test',
          },
          {
            tenantId: a.tenantId, traineeId: promotee.id, firstName: 'P', lastName: '3',
            relationship: ContactRelationship.OTHER, email: null,
          },
        ],
      });
      await queue(a.tenantId, session.id, promotee.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row.id).expect(204);

      const recipients = spy.mock.calls.map((c) => c[0].to).sort();
      expect(recipients).toEqual(['parent1@example.test', 'parent2@example.test']);
      spy.mockRestore();
    });

    it('skips the mail but still promotes when no address exists anywhere', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const mail = app.get(MailService);
      const spy = vi.spyOn(mail, 'sendWaitlistPromotion').mockResolvedValue(undefined);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const promotee = await newTrainee(a.tenantId);
      await queue(a.tenantId, session.id, promotee.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row.id).expect(204);

      expect(spy).not.toHaveBeenCalled();
      expect(
        await prisma.attendance.count({ where: { sessionId: session.id, traineeId: promotee.id } }),
      ).toBe(1);
      spy.mockRestore();
    });

    it('404 on an unknown attendance id', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      await del(a, session.id, 'nope').expect(404);
    });

    // TKT-0120 — the cutoff gates promotion, not just the customer doors: a spot freed too
    // late stays free, and staff can still fill it by hand.
    it('does not promote when the session is inside its class cutoff', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId, { cutoff: 60 });
      const session = await makeSession(
        a.tenantId,
        cls.id,
        a.locationId,
        undefined,
        new Date(Date.now() + 30 * 60_000),
      );
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const queued = await newTrainee(a.tenantId);
      await queue(a.tenantId, session.id, queued.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row.id).expect(204);

      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(1);

      // The spot is genuinely free — the staff add door still fills it.
      await request(server)
        .post(`/sessions/${session.id}/attendances`)
        .set(send(a))
        .send({ traineeId: queued.id })
        .expect(201);
    });

    // TKT-0120 — a null cutoff closes at the start itself, so a started session never promotes.
    it('does not promote on a session that has already started', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(
        a.tenantId,
        cls.id,
        a.locationId,
        undefined,
        new Date(Date.now() - 2 * 3_600_000),
      );
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);
      const queued = await newTrainee(a.tenantId);
      await queue(a.tenantId, session.id, queued.id, '2026-05-01T08:00:00Z');

      await del(a, session.id, row.id).expect(204);

      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it('an EMPLOYEE who trains the session can free a spot', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const cls = await queueClass(a.tenantId, a.locationId);
      const session = await makeSession(a.tenantId, cls.id, a.locationId, [a.userId]);
      const sitting = await newTrainee(a.tenantId);
      const row = await attend(a.tenantId, session.id, sitting.id);

      await del(a, session.id, row.id).expect(204);
    });
  });

  describe('customer booking (TKT-0118)', () => {
    const HOUR = 3_600_000;
    function book(a: TestActor, sessionId: string, traineeId: string) {
      return request(server)
        .post(`/me/sessions/${sessionId}/bookings`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId });
    }
    // A future session of a self-bookable class enrolling the customer's own trainee.
    async function bookableSetup(opts?: {
      allow?: boolean;
      cutoff?: number | null;
      capacity?: number | null;
      startsInMs?: number;
      guarded?: boolean;
    }) {
      const a = await setupActor(UserRole.CUSTOMER);
      const trainee = await newTrainee(
        a.tenantId,
        opts?.guarded ? { guardianIds: [a.userId] } : { userId: a.userId },
      );
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Book-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 10,
          allowSelfBooking: opts?.allow ?? true,
          bookingCutoffMin: opts?.cutoff ?? null,
          capacity: opts?.capacity ?? null,
          trainees: { connect: [{ id: trainee.id }] },
        },
      });
      const loc = await newLocation(a.tenantId);
      const startsAt = new Date(Date.now() + (opts?.startsInMs ?? 6 * HOUR));
      const session = await prisma.session.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          locationId: loc.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR),
        },
      });
      return { a, trainee, cls, session };
    }

    it('a linked customer books: 201, PENDING row with RSVP already CONFIRMED', async () => {
      const { a, trainee, session } = await bookableSetup();
      const res = await book(a, session.id, trainee.id).expect(201);
      expect(res.body.traineeId).toBe(trainee.id);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.traineeRsvp).toBe('CONFIRMED');
    });

    it('a guardian books for a guarded trainee, and the booking consumes a card visit', async () => {
      const { a, trainee, session } = await bookableSetup({ guarded: true });
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: trainee.id,
        totalVisits: 5,
      });
      const res = await book(a, session.id, trainee.id).expect(201);
      const consumptions = await prisma.cardConsumption.findMany({ where: { cardId: card.id } });
      expect(consumptions).toHaveLength(1);
      expect(consumptions[0]!.attendanceId).toBe(res.body.id);
    });

    it("rejects another family's trainee with 403", async () => {
      const { a, session } = await bookableSetup();
      const stranger = await newTrainee(a.tenantId);
      await book(a, session.id, stranger.id).expect(403);
    });

    it('answers 404 for an unknown session', async () => {
      const { a, trainee } = await bookableSetup();
      await book(a, 'nope', trainee.id).expect(404);
    });

    it('rejects a class with self-booking off (409 SELF_BOOKING_DISABLED)', async () => {
      const { a, trainee, session } = await bookableSetup({ allow: false });
      const res = await book(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('SELF_BOOKING_DISABLED');
    });

    it('rejects a trainee not enrolled in the class (409 SELF_BOOKING_NOT_ENROLLED)', async () => {
      const { a, session } = await bookableSetup();
      const unenrolled = await newTrainee(a.tenantId, { userId: undefined, guardianIds: [a.userId] });
      const res = await book(a, session.id, unenrolled.id).expect(409);
      expect(res.body.code).toBe('SELF_BOOKING_NOT_ENROLLED');
    });

    it('rejects inside the cutoff and after start (409 BOOKING_CLOSED)', async () => {
      // Starts in 30 minutes with a 60-minute cutoff — closed.
      const inside = await bookableSetup({ cutoff: 60, startsInMs: HOUR / 2 });
      let res = await book(inside.a, inside.session.id, inside.trainee.id).expect(409);
      expect(res.body.code).toBe('BOOKING_CLOSED');
      // Already started, no cutoff at all — still closed.
      const past = await bookableSetup({ startsInMs: -HOUR });
      res = await book(past.a, past.session.id, past.trainee.id).expect(409);
      expect(res.body.code).toBe('BOOKING_CLOSED');
    });

    it('rejects a full session (409 ATTENDANCE_SESSION_FULL)', async () => {
      const { a, trainee, session } = await bookableSetup({ capacity: 1 });
      const sitting = await newTrainee(a.tenantId);
      await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: sitting.id },
      });
      const res = await book(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('ATTENDANCE_SESSION_FULL');
    });

    it('rejects a duplicate booking (409 ATTENDANCE_TRAINEE_ALREADY_ON_SESSION)', async () => {
      const { a, trainee, session } = await bookableSetup();
      await book(a, session.id, trainee.id).expect(201);
      const res = await book(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('ATTENDANCE_TRAINEE_ALREADY_ON_SESSION');
    });

    it('two concurrent books of the last spot: exactly one 201, one 409', async () => {
      const { a, trainee, cls, session } = await bookableSetup({ capacity: 1 });
      const sibling = await newTrainee(a.tenantId, { userId: undefined, guardianIds: [a.userId] });
      await prisma.class.update({
        where: { id: cls.id },
        data: { trainees: { connect: [{ id: sibling.id }] } },
      });
      const results = await Promise.all([
        book(a, session.id, trainee.id),
        book(a, session.id, sibling.id),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
    });

    it('staff roles cannot use the customer door (403)', async () => {
      const { trainee, session } = await bookableSetup();
      const admin = await setupActor(UserRole.ADMIN, trainee.tenantId);
      await book(admin, session.id, trainee.id).expect(403);
    });

    it('GET /me/sessions carries spotsLeft, the class flag pair and myTrainees', async () => {
      const { a, trainee, session } = await bookableSetup({ capacity: 3, cutoff: 60 });
      const sitting = await newTrainee(a.tenantId);
      await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: sitting.id },
      });
      const res = await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      const entry = res.body.find((e: { id: string }) => e.id === session.id);
      expect(entry.spotsLeft).toBe(2);
      expect(entry.class.allowSelfBooking).toBe(true);
      expect(entry.class.bookingCutoffMin).toBe(60);
      expect(entry.myTrainees).toEqual([
        { id: trainee.id, firstName: trainee.firstName, lastName: trainee.lastName },
      ]);
    });

    // TKT-0121: the portal cannot tell "no spots left" from "join the queue" without the mode,
    // nor render a queued row without knowing who is queued.
    it('GET /me/sessions carries the class waitlistMode and the family myWaitlist', async () => {
      const { a, trainee, cls, session } = await bookableSetup({ capacity: 1 });
      await prisma.class.update({
        where: { id: cls.id },
        data: { waitlistMode: WaitlistMode.FIFO_AUTO },
      });
      const sitting = await newTrainee(a.tenantId);
      await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: sitting.id },
      });
      await prisma.waitlistEntry.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: trainee.id },
      });
      // Another family's queued trainee must not appear.
      const other = await newTrainee(a.tenantId);
      await prisma.waitlistEntry.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: other.id },
      });

      const res = await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      const entry = res.body.find((e: { id: string }) => e.id === session.id);
      expect(entry.class.waitlistMode).toBe('FIFO_AUTO');
      expect(entry.myWaitlist).toEqual([trainee.id]);
      expect(entry.spotsLeft).toBe(0);
    });
  });

  describe('customer cancel (TKT-0119)', () => {
    const HOUR = 3_600_000;
    // A booked seat on a future session of a self-bookable class, owned by the customer.
    async function bookedSetup(opts?: {
      cutoff?: number | null;
      startsInMs?: number;
      guarded?: boolean;
      waitlistMode?: WaitlistMode;
      capacity?: number | null;
      allow?: boolean;
    }) {
      const a = await setupActor(UserRole.CUSTOMER);
      const trainee = await newTrainee(
        a.tenantId,
        opts?.guarded ? { guardianIds: [a.userId] } : { userId: a.userId },
      );
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Cancel-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 10,
          allowSelfBooking: opts?.allow ?? true,
          bookingCutoffMin: opts?.cutoff ?? null,
          capacity: opts?.capacity ?? null,
          waitlistMode: opts?.waitlistMode ?? WaitlistMode.NONE,
          trainees: { connect: [{ id: trainee.id }] },
        },
      });
      const loc = await newLocation(a.tenantId);
      const startsAt = new Date(Date.now() + (opts?.startsInMs ?? 6 * HOUR));
      const session = await prisma.session.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          locationId: loc.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR),
        },
      });
      return { a, trainee, cls, session };
    }
    function cancel(a: TestActor, sessionId: string, traineeId: string) {
      return request(server)
        .delete(`/me/sessions/${sessionId}/bookings/${traineeId}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId);
    }
    const seat = (tenantId: string, sessionId: string, traineeId: string) =>
      prisma.attendance.create({ data: { tenantId, sessionId, traineeId } });

    it('a linked customer cancels their own booking: 204 and the row is gone', async () => {
      const { a, trainee, session } = await bookedSetup();
      await seat(a.tenantId, session.id, trainee.id);

      await cancel(a, session.id, trainee.id).expect(204);

      expect(
        await prisma.attendance.count({ where: { sessionId: session.id, traineeId: trainee.id } }),
      ).toBe(0);
    });

    it('a guardian cancels a staff-created booking', async () => {
      const { a, trainee, session } = await bookedSetup({ guarded: true });
      await seat(a.tenantId, session.id, trainee.id);

      await cancel(a, session.id, trainee.id).expect(204);
    });

    it("rejects another family's trainee with 403", async () => {
      const { a, session } = await bookedSetup();
      const stranger = await newTrainee(a.tenantId);
      await seat(a.tenantId, session.id, stranger.id);

      await cancel(a, session.id, stranger.id).expect(403);
    });

    it('answers 404 for an unknown session and for a trainee with no booking', async () => {
      const { a, trainee, session } = await bookedSetup();
      await cancel(a, 'nope', trainee.id).expect(404);
      await cancel(a, session.id, trainee.id).expect(404);
    });

    it('rejects a cancel past the cutoff (409 BOOKING_CLOSED)', async () => {
      const { a, trainee, session } = await bookedSetup({ cutoff: 60, startsInMs: HOUR / 2 });
      await seat(a.tenantId, session.id, trainee.id);

      const res = await cancel(a, session.id, trainee.id).expect(409);
      expect(res.body.code).toBe('BOOKING_CLOSED');
    });

    it('staff roles cannot use the customer cancel door (403)', async () => {
      const { a, trainee, session } = await bookedSetup();
      await seat(a.tenantId, session.id, trainee.id);
      const admin = await setupActor(UserRole.ADMIN, a.tenantId);

      await cancel(admin, session.id, trainee.id).expect(403);
    });

    it('returns the consumed card visit', async () => {
      const { a, trainee, session } = await bookedSetup();
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: trainee.id,
        totalVisits: 5,
      });
      const row = await seat(a.tenantId, session.id, trainee.id);
      await prisma.cardConsumption.create({
        data: { tenantId: a.tenantId, cardId: card.id, attendanceId: row.id },
      });

      await cancel(a, session.id, trainee.id).expect(204);

      expect(await prisma.cardConsumption.count({ where: { cardId: card.id } })).toBe(0);
    });

    it('the freed spot promotes the queue head on a FIFO_AUTO class', async () => {
      const { a, trainee, session } = await bookedSetup({
        capacity: 1,
        waitlistMode: WaitlistMode.FIFO_AUTO,
      });
      await seat(a.tenantId, session.id, trainee.id);
      const waiting = await newTrainee(a.tenantId);
      await prisma.waitlistEntry.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: waiting.id },
      });

      await cancel(a, session.id, trainee.id).expect(204);

      const rows = await prisma.attendance.findMany({ where: { sessionId: session.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.traineeId).toBe(waiting.id);
      expect(
        await prisma.waitlistEntry.count({ where: { sessionId: session.id } }),
      ).toBe(0);
    });
  });
});
