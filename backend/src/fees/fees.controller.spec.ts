import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BillingMode, FeeStatus, UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { FeesModule } from './fees.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  locationId: string;
  accessToken: string;
}

describe('FeesController (e2e-ish)', () => {
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
        FeesModule,
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
      // TKT-0054: ADMIN and EMPLOYEE are both location-scoped, so both need an assignment.
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
  async function newTrainee(tenantId: string) {
    return prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
  }
  async function newMonthlyClass(
    tenantId: string,
    traineeIds: string[] = [],
    locationId?: string,
    trainerIds: string[] = [],
  ) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 100,
        trainees: traineeIds.length
          ? { connect: traineeIds.map((id) => ({ id })) }
          : undefined,
        locations: locationId ? { connect: [{ id: locationId }] } : undefined,
        trainers: trainerIds.length ? { connect: trainerIds.map((id) => ({ id })) } : undefined,
      },
    });
  }

  describe('POST /fees', () => {
    it('admin creates a fee (201)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      const res = await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          traineeId: tr.id,
          amount: 50,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        })
        .expect(201);
      expect(res.body.tenantId).toBe(a.tenantId);
    });

    // sessionId removed from CreateFeeDto in TKT-0010 (PRD-0003) — forbidNonWhitelisted
    // rejects it. Uses a real session so the 400 can only come from the whitelist.
    it('returns 400 when sessionId is sent on manual create', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      const session = await prisma.session.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          locationId: a.locationId,
          startsAt: new Date('2026-03-10T10:00:00Z'),
          endsAt: new Date('2026-03-10T11:00:00Z'),
        },
      });
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          traineeId: tr.id,
          amount: 50,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          sessionId: session.id,
        })
        .expect(400);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: 'x',
          traineeId: 'y',
          amount: 1,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        })
        .expect(403);
    });

    it('returns 400 for negative amount', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          traineeId: tr.id,
          amount: -5,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        })
        .expect(400);
    });
  });

  // The amount is money in a Decimal column, so the API is the boundary that has to hold: the
  // form's rules are a convenience a caller can skip. `@Min(0)` used to allow a zero-amount fee
  // over the API while the create form rejected it.
  describe('fee amount validation', () => {
    async function newFeeBody(tenantId: string, locationId: string) {
      const tr = await newTrainee(tenantId);
      const cls = await newMonthlyClass(tenantId, [tr.id], locationId);
      return {
        classId: cls.id,
        traineeId: tr.id,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      };
    }

    it.each([0, -5, 1.234, 1_000_001])('rejects POST /fees with amount %s', async (amount) => {
      const a = await setupActor(UserRole.ADMIN);
      const body = await newFeeBody(a.tenantId, a.locationId);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ ...body, amount })
        .expect(400);
    });

    it.each([0.01, 99.99, 1_000_000])('accepts POST /fees with amount %s', async (amount) => {
      const a = await setupActor(UserRole.ADMIN);
      const body = await newFeeBody(a.tenantId, a.locationId);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ ...body, amount })
        .expect(201);
    });

    it.each([0, -5, 1.234, 1_000_001])(
      'rejects PATCH /fees/:id with amount %s',
      async (amount) => {
        const a = await setupActor(UserRole.ADMIN);
        const body = await newFeeBody(a.tenantId, a.locationId);
        const created = await request(server)
          .post('/fees')
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .send({ ...body, amount: 100 })
          .expect(201);

        await request(server)
          .patch(`/fees/${created.body.id}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .send({ amount })
          .expect(400);
      },
    );

    it('rejects PATCH /fees/:id lowering the amount below what is already paid', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const body = await newFeeBody(a.tenantId, a.locationId);
      const created = await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ ...body, amount: 100 })
        .expect(201);
      // Seeded directly: this test module holds FeesModule only, so the payments route is not
      // mounted here. The guard reads the ledger, not the route that wrote it.
      await prisma.payment.create({
        data: {
          tenantId: a.tenantId,
          feeId: created.body.id,
          amount: 40,
          paidAt: new Date('2026-03-15'),
        },
      });

      const res = await request(server)
        .patch(`/fees/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 39 })
        .expect(400);
      expect(res.body.message).toContain('40');
    });
  });

  describe('GET /fees', () => {
    it('admin lists with status filter', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          traineeId: tr.id,
          amount: 50,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        })
        .expect(201);
      const res = await request(server)
        .get('/fees?status=UNPAID')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('employee can list (read-only)', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .get('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
    });

    it('list items carry status and string amounts', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          traineeId: tr.id,
          amount: 120,
          periodStart: '2026-04-01',
          periodEnd: '2026-04-30',
        })
        .expect(201);
      const res = await request(server)
        .get('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      const [row] = res.body.items;
      expect(row.status).toBe('UNPAID');
      // Amounts cross the wire as strings; a number here would silently drop the cents.
      expect(row.amount).toBe('120');
      expect(typeof row.amount).toBe('string');
      // No payments yet, so the aggregate is a zero string rather than null.
      expect(row.paid).toBe('0');
      expect(typeof row.paid).toBe('string');
    });
  });

  describe('POST /fees/generate-monthly', () => {
    it('admin generates fees and gets {created, skipped}', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      const res = await request(server)
        .post('/fees/generate-monthly')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ periodStart: '2026-03-01', periodEnd: '2026-03-31' })
        .expect(200);
      expect(res.body).toEqual({ created: 1, skipped: 0 });
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/fees/generate-monthly')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ periodStart: '2026-03-01', periodEnd: '2026-03-31' })
        .expect(403);
    });
  });

  // TKT-0110: gap-healer for PER_COURSE classes — the class carries its own period and price.
  describe('POST /fees/generate-course', () => {
    const COURSE_START = new Date('2026-03-01');
    const COURSE_END = new Date('2026-08-31');
    async function newCourseClass(
      tenantId: string,
      traineeIds: string[] = [],
      locationId?: string,
      coursePrice = 300,
    ) {
      return prisma.class.create({
        data: {
          tenantId,
          name: `Course-${randomUUID()}`,
          billingMode: BillingMode.PER_COURSE,
          courseStart: COURSE_START,
          courseEnd: COURSE_END,
          coursePrice,
          trainees: traineeIds.length
            ? { connect: traineeIds.map((id) => ({ id })) }
            : undefined,
          locations: locationId ? { connect: [{ id: locationId }] } : undefined,
        },
      });
    }
    const generate = (a: TestActor, body: object = {}) =>
      request(server)
        .post('/fees/generate-course')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send(body);

    it('creates the missing course fees and skips already-billed trainees', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const t1 = await newTrainee(a.tenantId);
      const t2 = await newTrainee(a.tenantId);
      const cls = await newCourseClass(a.tenantId, [t1.id, t2.id], a.locationId);
      // t1 is already billed for exactly this period — the generator must not double-bill.
      await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          traineeId: t1.id,
          periodStart: COURSE_START,
          periodEnd: COURSE_END,
          amount: 300,
        },
      });

      const res = await generate(a).expect(200);
      expect(res.body).toEqual({ created: 1, skipped: 1 });

      const fee = await prisma.fee.findFirst({
        where: { classId: cls.id, traineeId: t2.id },
      });
      expect(Number(fee?.amount)).toBe(300);
      expect(fee?.periodStart.toISOString()).toBe(COURSE_START.toISOString());
      expect(fee?.periodEnd.toISOString()).toBe(COURSE_END.toISOString());
      expect(fee?.sessionId).toBeNull();
    });

    it('honors the classId filter', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const t1 = await newTrainee(a.tenantId);
      const t2 = await newTrainee(a.tenantId);
      const target = await newCourseClass(a.tenantId, [t1.id], a.locationId);
      const other = await newCourseClass(a.tenantId, [t2.id], a.locationId);

      const res = await generate(a, { classId: target.id }).expect(200);
      expect(res.body).toEqual({ created: 1, skipped: 0 });
      expect(await prisma.fee.count({ where: { classId: other.id } })).toBe(0);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await generate(a).expect(403);
    });

    // AC #4: edits never rewrite money rows; the generator bills the *current* values.
    it('leaves an existing fee untouched after a price edit, and bills new gaps at the new price', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const t1 = await newTrainee(a.tenantId);
      const cls = await newCourseClass(a.tenantId, [t1.id], a.locationId);
      await generate(a, { classId: cls.id }).expect(200);
      const before = await prisma.fee.findFirst({
        where: { classId: cls.id, traineeId: t1.id },
      });
      expect(Number(before?.amount)).toBe(300);

      // Price edit + a second, not-yet-billed enrollee (seeded directly — the sync-on-enroll
      // path is pinned in classes/trainees specs; this test isolates the generator).
      await prisma.class.update({ where: { id: cls.id }, data: { coursePrice: 400 } });
      const t2 = await newTrainee(a.tenantId);
      await prisma.class.update({
        where: { id: cls.id },
        data: { trainees: { connect: [{ id: t2.id }] } },
      });

      const res = await generate(a, { classId: cls.id }).expect(200);
      expect(res.body).toEqual({ created: 1, skipped: 1 });
      const after = await prisma.fee.findFirst({
        where: { classId: cls.id, traineeId: t1.id },
      });
      expect(after).toEqual(before);
      const t2Fee = await prisma.fee.findFirst({
        where: { classId: cls.id, traineeId: t2.id },
      });
      expect(Number(t2Fee?.amount)).toBe(400);
    });
  });

  describe('DELETE /fees/:id', () => {
    it('admin deletes (204)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      const created = await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          classId: cls.id,
          traineeId: tr.id,
          amount: 50,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        })
        .expect(201);
      await request(server)
        .delete(`/fees/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(204);
    });

    it('cross-tenant returns 404', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(b.tenantId);
      const cls = await newMonthlyClass(b.tenantId, [tr.id], b.locationId);
      const created = await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Tenant-Id', b.tenantId)
        .send({
          classId: cls.id,
          traineeId: tr.id,
          amount: 50,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        })
        .expect(201);
      await request(server)
        .delete(`/fees/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(404);
    });
  });

  // TKT-0129: PATCH opened to EMPLOYEE, scoped to fees whose class they teach.
  describe('PATCH /fees/:id — EMPLOYEE scope', () => {
    it('an employee can edit a fee for a class they teach', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const tr = await newTrainee(e.tenantId);
      const cls = await newMonthlyClass(e.tenantId, [tr.id], e.locationId, [e.userId]);
      const fee = await prisma.fee.create({
        data: {
          tenantId: e.tenantId,
          classId: cls.id,
          traineeId: tr.id,
          periodStart: new Date('2026-05-01'),
          periodEnd: new Date('2026-05-31'),
          amount: 100,
        },
      });

      const res = await request(server)
        .patch(`/fees/${fee.id}`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .send({ notes: 'Paid in cash at the front desk' })
        .expect(200);
      expect(res.body.notes).toBe('Paid in cash at the front desk');
    });

    it('an employee gets 404 editing a fee for a class they do not teach', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const tr = await newTrainee(e.tenantId);
      // No trainerIds — the class exists at the employee's own location, but nobody
      // connected them as its trainer.
      const cls = await newMonthlyClass(e.tenantId, [tr.id], e.locationId);
      const fee = await prisma.fee.create({
        data: {
          tenantId: e.tenantId,
          classId: cls.id,
          traineeId: tr.id,
          periodStart: new Date('2026-05-01'),
          periodEnd: new Date('2026-05-31'),
          amount: 100,
        },
      });

      await request(server)
        .patch(`/fees/${fee.id}`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .send({ notes: 'Should not land' })
        .expect(404);
    });
  });

  describe('GET /fees — period filter validation', () => {
    it('rejects an unparseable periodStartFrom (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/fees?periodStartFrom=not-a-date')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });

    it('rejects an inverted period window (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/fees?periodStartFrom=2026-04-01&periodStartTo=2026-03-01')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });

    it('accepts a valid period window (200)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .get('/fees?periodStartFrom=2026-03-01&periodStartTo=2026-03-31')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
  // "Who still owes for this class this month" is one question, and PARTIAL owes as much as
  // UNPAID does. OUTSTANDING is not a FeeStatus — it is the pair of them.
  describe('GET /fees?status=OUTSTANDING', () => {
    async function threeFees(a: TestActor) {
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      const base = {
        tenantId: a.tenantId,
        classId: cls.id,
        traineeId: tr.id,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-05-31'),
        amount: 100,
      };
      const unpaid = await prisma.fee.create({ data: { ...base, status: FeeStatus.UNPAID } });
      const partial = await prisma.fee.create({ data: { ...base, status: FeeStatus.PARTIAL } });
      const paid = await prisma.fee.create({ data: { ...base, status: FeeStatus.PAID } });
      return { unpaid, partial, paid };
    }

    it('returns the UNPAID and PARTIAL fees and excludes the PAID one', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { unpaid, partial, paid } = await threeFees(a);
      const res = await request(server)
        .get('/fees?status=OUTSTANDING')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      const ids = res.body.items.map((f: { id: string }) => f.id);
      expect(ids).toContain(unpaid.id);
      expect(ids).toContain(partial.id);
      expect(ids).not.toContain(paid.id);
    });

    it('leaves the plain status filters alone', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { unpaid, partial, paid } = await threeFees(a);
      const res = await request(server)
        .get('/fees?status=UNPAID')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      const ids = res.body.items.map((f: { id: string }) => f.id);
      expect(ids).toEqual([unpaid.id]);
      expect(ids).not.toContain(partial.id);
      expect(ids).not.toContain(paid.id);
    });

    it('rejects a status value that is neither a FeeStatus nor OUTSTANDING (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/fees?status=OVERPAID')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });
  });

  // TKT-0095: server-side fee search. Matching runs over the related trainee (first/last/email)
  // through searchVariants; the clause nests under AND so it narrows the tenant and location
  // scope rather than widening it (the RES-0003 trap).
  describe('GET /fees?search=', () => {
    async function seedFee(
      a: TestActor,
      trainee: { firstName: string; lastName: string; email?: string },
      opts: { status?: FeeStatus; locationId?: string; trainerId?: string } = {},
    ) {
      const tr = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: trainee.firstName,
          lastName: trainee.lastName,
          email: trainee.email,
          dateOfBirth: new Date('2000-01-01'),
        },
      });
      const cls = await newMonthlyClass(
        a.tenantId,
        [tr.id],
        opts.locationId ?? a.locationId,
        opts.trainerId ? [opts.trainerId] : [],
      );
      const fee = await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          traineeId: tr.id,
          periodStart: new Date('2026-05-01'),
          periodEnd: new Date('2026-05-31'),
          amount: 100,
          ...(opts.status ? { status: opts.status } : {}),
        },
      });
      return { tr, cls, fee };
    }

    const listWith = (a: TestActor, qs: string) =>
      request(server)
        .get(`/fees${qs}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId);

    const idsOf = (res: { body: { items: Array<{ id: string }> } }) =>
      res.body.items.map((f) => f.id);

    it('rejects a 101-character search (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await listWith(a, `?search=${'x'.repeat(101)}`).expect(400);
    });

    it('an omitted search changes nothing', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await seedFee(a, { firstName: 'Ада', lastName: 'Лъвлейс' });
      await seedFee(a, { firstName: 'Боб', lastName: 'Строителят' });

      const res = await listWith(a, '').expect(200);

      expect(res.body.items).toHaveLength(2);
    });

    it("finds a fee by the trainee's Cyrillic last name in any casing", async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { fee } = await seedFee(a, { firstName: 'Георги', lastName: 'Иванов' });
      await seedFee(a, { firstName: 'Мария', lastName: 'Петрова' });

      for (const q of ['иванов', 'ИВАНОВ', 'Иванов']) {
        const res = await listWith(a, `?search=${encodeURIComponent(q)}`).expect(200);
        expect(idsOf(res), q).toEqual([fee.id]);
      }
    });

    it("matches the trainee's email substring", async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { fee } = await seedFee(a, {
        firstName: 'Ада',
        lastName: 'Лъвлейс',
        email: `ada-${randomUUID()}@math.example`,
      });
      await seedFee(a, {
        firstName: 'Боб',
        lastName: 'Строителят',
        email: `bob-${randomUUID()}@build.example`,
      });

      const res = await listWith(a, '?search=math').expect(200);

      expect(idsOf(res)).toEqual([fee.id]);
    });

    it('composes with status as AND', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { fee: unpaid } = await seedFee(a, { firstName: 'Иван', lastName: 'Иванов' });
      await seedFee(a, { firstName: 'Иванка', lastName: 'Иванова' }, { status: FeeStatus.PAID });

      const res = await listWith(
        a,
        `?search=${encodeURIComponent('иван')}&status=UNPAID`,
      ).expect(200);

      expect(idsOf(res)).toEqual([unpaid.id]);
    });

    // TKT-0129: EMPLOYEE is scoped by which classes they teach, not by location — a location
    // can host classes taught by other trainers too.
    it("does not return a fee outside the caller's class scope, with or without search", async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const hidden = await seedFee(a, { firstName: 'Скрит', lastName: 'Иванов' });
      const visible = await seedFee(
        a,
        { firstName: 'Видим', lastName: 'Иванов' },
        { trainerId: a.userId },
      );

      const unfiltered = await listWith(a, '').expect(200);
      expect(idsOf(unfiltered)).toEqual([visible.fee.id]);

      const searched = await listWith(a, `?search=${encodeURIComponent('иванов')}`).expect(200);
      expect(idsOf(searched)).toEqual([visible.fee.id]);
      expect(idsOf(searched)).not.toContain(hidden.fee.id);
    });
  });

  // A trainee nobody billed has no fee row, so no status filter can ever surface them.
  // This is the other half of "who has not paid".
  describe('GET /fees/unbilled', () => {
    const PERIOD = 'periodStart=2026-06-01&periodEnd=2026-06-30';

    it('lists enrolled trainees with no fee for the period, and drops them once billed', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const billed = await newTrainee(a.tenantId);
      const missing = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [billed.id, missing.id], a.locationId);
      await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          traineeId: billed.id,
          periodStart: new Date('2026-06-01'),
          periodEnd: new Date('2026-06-30'),
          amount: 100,
        },
      });

      const res = await request(server)
        .get(`/fees/unbilled?classId=${cls.id}&${PERIOD}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        classId: cls.id,
        className: cls.name,
        traineeId: missing.id,
        amount: '100',
      });

      // Generating closes the gap the preview reported — same query path, so they agree.
      await request(server)
        .post('/fees/generate-monthly')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ classId: cls.id, periodStart: '2026-06-01', periodEnd: '2026-06-30' })
        .expect(200);

      const after = await request(server)
        .get(`/fees/unbilled?classId=${cls.id}&${PERIOD}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(after.body).toEqual([]);
    });

    it('is not swallowed by GET /fees/:id', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .get(`/fees/unbilled?${PERIOD}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('hides a class in a location the caller is not assigned to', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const other = await prisma.location.create({
        data: { tenantId: a.tenantId, name: `Other-${randomUUID()}` },
      });
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], other.id);

      const res = await request(server)
        .get(`/fees/unbilled?${PERIOD}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.map((r: { classId: string }) => r.classId)).not.toContain(cls.id);
    });

    it('lets an employee read it (200)', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .get(`/fees/unbilled?${PERIOD}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
    });

    it('rejects an inverted period (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/fees/unbilled?periodStart=2026-06-30&periodEnd=2026-06-01')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });
  });

  // TKT-0104: a fee may have no class (tenant-wide card purchase fees, TKT-0106).
  // Serialization must admit the null; creation paths still require a class.
  describe('fees without a class', () => {
    it('lists a fee without a class (super admin)', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const tr = await newTrainee(a.tenantId);
      const fee = await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: null,
          traineeId: tr.id,
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-01'),
          amount: 120,
        },
      });

      const res = await request(server)
        .get('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      const row = res.body.items.find((f: { id: string }) => f.id === fee.id);
      expect(row).toBeDefined();
      expect(row.classId).toBeNull();
    });

    it('returns detail for a fee without a class (super admin)', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const tr = await newTrainee(a.tenantId);
      const fee = await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: null,
          traineeId: tr.id,
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-01'),
          amount: 120,
        },
      });

      const res = await request(server)
        .get(`/fees/${fee.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.classId).toBeNull();
      expect(res.body.class).toBeNull();
      expect(res.body.trainee.id).toBe(tr.id);
    });

    // TKT-0106: class-less fees are tenant-level money — location scoping must not hide them.
    it('location-scoped admin still sees a class-less fee in list and detail', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const fee = await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: null,
          traineeId: tr.id,
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-01'),
          amount: 120,
        },
      });

      const list = await request(server)
        .get('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(list.body.items.map((f: { id: string }) => f.id)).toContain(fee.id);

      await request(server)
        .get(`/fees/${fee.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
    });

    // TKT-0105: the staff detail page renders both ledgers from one fetch.
    it('detail embeds refunds[] beside payments[]', async () => {
      const a = await setupActor(UserRole.SUPER_ADMIN);
      const tr = await newTrainee(a.tenantId);
      const fee = await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: null,
          traineeId: tr.id,
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-01'),
          amount: 120,
          payments: { create: { tenantId: a.tenantId, amount: 100, paidAt: new Date('2026-08-05') } },
          refunds: { create: { tenantId: a.tenantId, amount: 30, refundedAt: new Date('2026-08-10') } },
        },
      });

      const res = await request(server)
        .get(`/fees/${fee.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.payments).toHaveLength(1);
      expect(res.body.refunds).toHaveLength(1);
      expect(res.body.refunds[0].amount).toBe('30');
    });
  });
});
