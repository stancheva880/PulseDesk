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
import { SessionsModule } from './sessions.module';
import { createTestUser } from '@/test-utils/create-user';
import { createTestCard } from '@/test-utils/create-card';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  locationId: string;
  accessToken: string;
}

describe('SessionsController (e2e-ish)', () => {
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
        SessionsModule,
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

  describe('GET /sessions/:id', () => {
    // Added by TKT-0047: the module had no detail coverage, so no controller test could fail
    // when a relation select changed. The response now parses through SessionDetailSchema.
    it('admin reads one session with its class, location and trainers', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      // trainerIds must be EMPLOYEE members of the tenant (assertTrainerIds), not the admin.
      const trainer = await createTestUser(prisma, {
        tenantId: a.tenantId,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
      });
      const created = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
          trainerIds: [trainer.id],
        })
        .expect(201);

      const res = await request(server)
        .get(`/sessions/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      // The instants stay exactly what JSON.stringify produced before the schema existed.
      expect(res.body.startsAt).toBe('2026-06-01T18:00:00.000Z');
      expect(res.body.endsAt).toBe('2026-06-01T19:00:00.000Z');
      expect(res.body.status).toBe('SCHEDULED');

      // TKT-0103 (approved TCR #3): `capacity` joined the select deliberately — the pin stays exact.
      // TKT-0112 (named in the approved plan): `waitlistMode` joined it too.
      expect(Object.keys(res.body.class).sort()).toEqual([
        'billingMode',
        'capacity',
        'id',
        'name',
        'waitlistMode',
      ]);
      expect(res.body.class.billingMode).toBe('PER_SESSION');
      expect(Object.keys(res.body.location).sort()).toEqual(['id', 'name']);
      expect(Object.keys(res.body.trainers[0]).sort()).toEqual([
        'email',
        'firstName',
        'id',
        'lastName',
      ]);
    });
  });

  describe('POST /sessions', () => {
    it('admin creates a session (201)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const res = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(201);
      expect(res.body.tenantId).toBe(a.tenantId);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(403);
    });

    // TKT-0107: auto-attendance at session creation is a booking — it draws down the card.
    it('creating a session consumes a visit from an enrolled trainee card', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'T',
          lastName: 'X',
          dateOfBirth: new Date('2000-01-01'),
        },
      });
      const cls = await newClass(a.tenantId);
      await prisma.class.update({
        where: { id: cls.id },
        data: { trainees: { connect: [{ id: trainee.id }] } },
      });
      const card = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: trainee.id,
        totalVisits: 10,
      });

      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(201);

      expect(await prisma.cardConsumption.count({ where: { cardId: card.id } })).toBe(1);
    });

    // TKT-0123: an archived trainee stays on the class roster, and auto-attendance took the whole
    // roster — so every new session booked them and drew a visit off their card, for someone who
    // has left. The manual add and the candidates list both require isActive; this is the same rule.
    it('skips an inactive trainee on the roster — no row, no card draw', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const active = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Here',
          lastName: 'X',
          dateOfBirth: new Date('2000-01-01'),
        },
      });
      const archived = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Gone',
          lastName: 'X',
          dateOfBirth: new Date('2000-01-01'),
          isActive: false,
        },
      });
      const cls = await newClass(a.tenantId);
      await prisma.class.update({
        where: { id: cls.id },
        data: { trainees: { connect: [{ id: active.id }, { id: archived.id }] } },
      });
      const archivedCard = await createTestCard(prisma, {
        tenantId: a.tenantId,
        traineeId: archived.id,
        totalVisits: 10,
      });

      const res = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          startsAt: '2026-06-02T18:00:00.000Z',
          endsAt: '2026-06-02T19:00:00.000Z',
        })
        .expect(201);

      const rows = await prisma.attendance.findMany({
        where: { sessionId: res.body.id },
        select: { traineeId: true },
      });
      expect(rows.map((r) => r.traineeId)).toEqual([active.id]);
      expect(await prisma.cardConsumption.count({ where: { cardId: archivedCard.id } })).toBe(0);
    });

    it('returns 400 when classId belongs to a different tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const classB = await newClass(b.tenantId);
      const locA = await newLocation(a.tenantId);
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: classB.id,
          locationId: locA.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(400);
    });
  });

  // TKT-0069: the dashboard counted this week's sessions by paging every session in the tenant
  // and comparing timestamps in the browser. The range is half-open — startsAtBefore is exclusive —
  // because a week boundary is an instant, and the page's own comparison has always been
  // `ts >= start && ts < end`. An inclusive upper bound would count the first session of the next
  // week in both weeks.
  describe('GET /sessions date range', () => {
    const FROM = '2026-06-08T00:00:00.000Z';
    const BEFORE = '2026-06-15T00:00:00.000Z';

    async function threeSessions(tenantId: string, locationId: string) {
      const cls = await newClass(tenantId);
      const at = (startsAt: string) =>
        prisma.session.create({
          data: {
            tenantId,
            classId: cls.id,
            locationId,
            startsAt: new Date(startsAt),
            endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
          },
        });
      await at('2026-06-07T23:59:59.999Z'); // one millisecond before the window
      await at('2026-06-10T18:00:00.000Z'); // inside
      await at(BEFORE); // exactly on the exclusive end
    }

    it('counts only the sessions inside the half-open window', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await threeSessions(a.tenantId, a.locationId);

      const res = await request(server)
        .get(`/sessions?startsAtFrom=${FROM}&startsAtBefore=${BEFORE}&pageSize=1`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      // One row on the wire, an exact count off the envelope.
      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].startsAt).toBe('2026-06-10T18:00:00.000Z');
    });

    it('includes a session exactly on the inclusive lower bound', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      await prisma.session.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          locationId: a.locationId,
          startsAt: new Date(FROM),
          endsAt: new Date(new Date(FROM).getTime() + 3_600_000),
        },
      });

      const res = await request(server)
        .get(`/sessions?startsAtFrom=${FROM}&startsAtBefore=${BEFORE}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(1);
    });

    it('accepts either bound on its own', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await threeSessions(a.tenantId, a.locationId);

      const from = await request(server)
        .get(`/sessions?startsAtFrom=${FROM}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(from.body.total).toBe(2);

      const before = await request(server)
        .get(`/sessions?startsAtBefore=${BEFORE}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(before.body.total).toBe(2);
    });

    it('rejects a bound that is not a date with 400', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/sessions?startsAtFrom=last-monday')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });

    it('narrows within the trainer scope rather than escaping it', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(a.tenantId);
      const inside = {
        tenantId: a.tenantId,
        classId: cls.id,
        locationId: a.locationId,
        startsAt: new Date('2026-06-10T18:00:00.000Z'),
        endsAt: new Date('2026-06-10T19:00:00.000Z'),
      };
      // Inside the window and theirs → counted.
      await prisma.session.create({
        data: { ...inside, trainers: { connect: [{ id: a.userId }] } },
      });
      // Inside the window and somebody else's → must stay invisible.
      await prisma.session.create({ data: inside });

      const res = await request(server)
        .get(`/sessions?startsAtFrom=${FROM}&startsAtBefore=${BEFORE}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(1);
    });
  });

  describe('GET /sessions visibility', () => {
    it('employee sees only sessions where they are a trainer', async () => {
      const admin = await setupActor(UserRole.ADMIN);
      const employee = await setupActor(UserRole.EMPLOYEE);
      // admin tenant-scope: create a session in employee.tenantId so employee can see (or not).
      // Use the employee's tenant — give them a separate session pair, one assigned, one not.
      const cls = await newClass(employee.tenantId);
      const loc = await newLocation(employee.tenantId);
      const otherTrainer = await createTestUser(prisma, {
        tenantId: employee.tenantId,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
      });

      // Reuse admin auth from a different tenant won't work; we promote admin tokens to
      // employee's tenant by creating an admin in employee's tenant. Connect that admin
      // to `loc` so the new ADMIN location-scoping doesn't filter out the sessions.
      const localAdmin = await createTestUser(prisma, {
        tenantId: employee.tenantId,
        email: `${randomUUID()}@x`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.ADMIN,
        locations: { connect: [{ id: loc.id }] },
      });
      const localAdminTokens = await auth.login(localAdmin);

      // Session 1 — employee assigned
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .set('X-Tenant-Id', employee.tenantId)
        .send({
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
          trainerIds: [employee.userId],
        })
        .expect(201);

      // Session 2 — only otherTrainer
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .set('X-Tenant-Id', employee.tenantId)
        .send({
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-08T18:00:00.000Z',
          endsAt: '2026-06-08T19:00:00.000Z',
          trainerIds: [otherTrainer.id],
        })
        .expect(201);

      // Admin sees both
      const adminList = await request(server)
        .get('/sessions')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .set('X-Tenant-Id', employee.tenantId)
        .expect(200);
      expect(adminList.body.items).toHaveLength(2);

      // Employee sees only the one they're assigned to
      const employeeList = await request(server)
        .get('/sessions')
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .set('X-Tenant-Id', employee.tenantId)
        .expect(200);
      expect(employeeList.body.items).toHaveLength(1);

      // Avoid the unused-actor lint complaint; admin came from another tenant in this setup.
      void admin;
    });
  });

  describe('GET /sessions filters (TKT-0100)', () => {
    // Well-formed cuid that matches nothing — malformed ids are a different case (400).
    const UNKNOWN_ID = 'cabcdefghij0123456789klm';

    async function seedSession(
      tenantId: string,
      classId: string,
      locationId: string,
      startsAt: string,
      trainerIds: string[] = [],
    ) {
      return prisma.session.create({
        data: {
          tenantId,
          classId,
          locationId,
          startsAt: new Date(startsAt),
          endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
          ...(trainerIds.length
            ? { trainers: { connect: trainerIds.map((id) => ({ id })) } }
            : {}),
        },
      });
    }

    it('filters by classId', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const clsA = await newClass(a.tenantId);
      const clsB = await newClass(a.tenantId);
      await seedSession(a.tenantId, clsA.id, a.locationId, '2026-07-06T10:00:00.000Z');
      await seedSession(a.tenantId, clsB.id, a.locationId, '2026-07-07T10:00:00.000Z');

      const res = await request(server)
        .get(`/sessions?classId=${clsA.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].classId).toBe(clsA.id);
    });

    // TKT-0103: occupancy for the calendar's X/Y chips rides on every list row.
    it('list rows carry the attendance count', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const s = await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-06T10:00:00.000Z');
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'T',
          lastName: 'Count',
          dateOfBirth: new Date('2000-01-01'),
        },
      });
      await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: s.id, traineeId: trainee.id },
      });

      const res = await request(server)
        .get(`/sessions?classId=${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items[0]._count).toEqual({ attendances: 1 });
    });

    // The sessions table shows who is teaching each row — the list response needs the
    // trainer roster the same way the detail endpoint (GET /sessions/:id) already carries it.
    it('list rows carry their trainers', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const trainer = await createTestUser(prisma, {
        tenantId: a.tenantId,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
        firstName: 'Tina',
        lastName: 'Trainer',
      });
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-06T10:00:00.000Z', [
        trainer.id,
      ]);

      const res = await request(server)
        .get(`/sessions?classId=${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items[0].trainers).toEqual([
        { id: trainer.id, firstName: 'Tina', lastName: 'Trainer', email: trainer.email },
      ]);
    });

    it('list rows with no trainer connected carry an empty array, not undefined', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-06T10:00:00.000Z');

      const res = await request(server)
        .get(`/sessions?classId=${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items[0].trainers).toEqual([]);
    });

    it('filters by trainerId for an admin', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const trainer = await createTestUser(prisma, {
        tenantId: a.tenantId,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
      });
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-06T10:00:00.000Z', [
        trainer.id,
      ]);
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-07T10:00:00.000Z');

      const res = await request(server)
        .get(`/sessions?trainerId=${trainer.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(1);
    });

    it('combines filters with AND', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-06T10:00:00.000Z');

      const res = await request(server)
        .get(`/sessions?classId=${cls.id}&locationId=${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(0);
    });

    it('rejects a malformed classId with 400', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/sessions?classId=not-a-cuid')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });

    it('returns an empty page for an unknown classId', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-06T10:00:00.000Z');

      const res = await request(server)
        .get(`/sessions?classId=${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(0);
    });

    // setupActor connects the ADMIN to exactly one location, so they are location-scoped.
    // The filter must intersect that scope, not replace it — a direct `where.locationId =`
    // assignment would hand the admin any location they name.
    it('location filter cannot widen a scoped admin access', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const outside = await newLocation(a.tenantId);
      const cls = await newClass(a.tenantId);
      await seedSession(a.tenantId, cls.id, outside.id, '2026-07-06T10:00:00.000Z');

      const res = await request(server)
        .get(`/sessions?locationId=${outside.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(0);
    });

    // The EMPLOYEE's own-sessions narrowing must survive a trainerId filter: filtering for
    // a colleague yields the intersection (shared sessions), never the colleague's roster.
    it('employee filtering another trainer sees only shared sessions', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const other = await createTestUser(prisma, {
        tenantId: a.tenantId,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
      });
      const cls = await newClass(a.tenantId);
      // The colleague's solo session — invisible even when filtered for.
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-06T10:00:00.000Z', [
        other.id,
      ]);
      // A shared session — the only visible match.
      await seedSession(a.tenantId, cls.id, a.locationId, '2026-07-07T10:00:00.000Z', [
        other.id,
        a.userId,
      ]);

      const res = await request(server)
        .get(`/sessions?trainerId=${other.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(1);
    });
  });

  describe('DELETE /sessions/:id', () => {
    it('admin deletes (204)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const created = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(201);
      await request(server)
        .delete(`/sessions/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(204);
    });
  });

  // TKT-0125: Location.isActive was written by the edit form and read by nothing, so a
  // deactivated hall still accepted new dated work. These are the first PATCH tests in this
  // file — there was no update coverage at all before.
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

    async function createSession(a: TestActor, classId: string, locationId: string) {
      const res = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId,
          locationId,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(201);
      return res.body as { id: string; locationId: string };
    }

    it('POST /sessions refuses it (400 LOCATION_INACTIVE)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const retired = await secondHall(a, { active: false });

      const res = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          locationId: retired.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(400);
      expect(res.body.code).toBe('LOCATION_INACTIVE');
      expect(await prisma.session.count({ where: { locationId: retired.id } })).toBe(0);
    });

    it('PATCH /sessions/:id refuses a move onto it (400 LOCATION_INACTIVE)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const session = await createSession(a, cls.id, a.locationId);
      const retired = await secondHall(a, { active: false });

      const res = await request(server)
        .patch(`/sessions/${session.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ locationId: retired.id })
        .expect(400);
      expect(res.body.code).toBe('LOCATION_INACTIVE');

      const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.locationId).toBe(a.locationId);
    });

    // The exemption that keeps an existing row editable: both edit forms always send
    // locationId, so without this a session at a retired hall could not even have its time
    // fixed.
    it('PATCH /sessions/:id allows a resend of the row own deactivated location (200)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const hall = await secondHall(a, { active: true });
      const session = await createSession(a, cls.id, hall.id);
      await prisma.location.update({ where: { id: hall.id }, data: { isActive: false } });

      const res = await request(server)
        .patch(`/sessions/${session.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        // 18:30, not 19:00 — endsAt is 19:00 and assertTimeRange is strict.
        .send({ locationId: hall.id, startsAt: '2026-06-01T18:30:00.000Z' })
        .expect(200);
      expect(res.body.locationId).toBe(hall.id);
      expect(new Date(res.body.startsAt).toISOString()).toBe('2026-06-01T18:30:00.000Z');
    });

    // Guards the `## Do not change` trap: if getAccessibleLocationIds ever starts filtering
    // isActive, an admin assigned only to a retired hall loses its whole history and this
    // goes red.
    it('an admin assigned only to a deactivated hall still reads its sessions', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const session = await createSession(a, cls.id, a.locationId);
      await prisma.location.update({ where: { id: a.locationId }, data: { isActive: false } });

      const res = await request(server)
        .get('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.items.map((s: { id: string }) => s.id)).toContain(session.id);
    });
  });
});
