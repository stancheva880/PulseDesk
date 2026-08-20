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
});
