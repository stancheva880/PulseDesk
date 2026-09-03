import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
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
import { FeesModule } from '@/fees/fees.module';
import { FeesService } from '@/fees/fees.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { PaymentsModule } from './payments.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

describe('PaymentsController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let fees: FeesService;
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
        PaymentsModule,
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
    fees = moduleRef.get(FeesService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  });

  async function setupActor(role: UserRole) {
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

  async function makeFee(tenantId: string, amount = 100, locationId?: string, trainerId?: string) {
    const trainee = await prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
    const cls = await prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: amount,
        trainees: { connect: [{ id: trainee.id }] },
        locations: locationId ? { connect: [{ id: locationId }] } : undefined,
        trainers: trainerId ? { connect: [{ id: trainerId }] } : undefined,
      },
    });
    return fees.create(tenantId, {
      classId: cls.id,
      traineeId: trainee.id,
      amount,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
    }, su);
  }

  describe('POST /fees/:feeId/payments', () => {
    it('admin records a payment (201) and recomputes status', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 100, paidAt: '2026-03-15' })
        .expect(201);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PAID);
    });

    it('returns 404 for employee on a fee outside their tenant', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const adminA = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(adminA.tenantId, 100);
      // Role gating now lets an employee through; the fee still isn't visible to them
      // because it's in another tenant, so assertFeeAccessible reports it as not found.
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 50, paidAt: '2026-03-15' })
        .expect(404);
    });

    // TKT-0129: an employee records payments only for a fee on a class they teach.
    it('an employee records a payment for a fee on a class they teach', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const fee = await makeFee(e.tenantId, 100, e.locationId, e.userId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .send({ amount: 60, paidAt: '2026-03-15' })
        .expect(201);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PARTIAL);
    });

    it('an employee gets 404 recording a payment for a fee on a class they do not teach', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const fee = await makeFee(e.tenantId, 100, e.locationId); // no trainerId
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .send({ amount: 50, paidAt: '2026-03-15' })
        .expect(404);
    });

    it('returns 400 for amount = 0', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 0, paidAt: '2026-03-15' })
        .expect(400);
    });

    it.each([-5, 1.234, 1_000_001])('returns 400 for amount %s', async (amount) => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount, paidAt: '2026-03-15' })
        .expect(400);
    });

    it('returns 400 when the payment exceeds the outstanding balance', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 60, paidAt: '2026-03-10' })
        .expect(201);
      // The message carries the balance, because "400" alone does not tell the club what to type.
      const res = await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 41, paidAt: '2026-03-20' })
        .expect(400);
      expect(res.body.message).toContain('40');
      expect(await prisma.payment.count({ where: { feeId: fee.id } })).toBe(1);
    });

    it('returns 404 when feeId is in another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(b.tenantId, 100);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 50, paidAt: '2026-03-15' })
        .expect(404);
    });
  });

  describe('GET /fees/:feeId/payments', () => {
    it('returns list of payments', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 30, paidAt: '2026-03-10' })
        .expect(201);
      const res = await request(server)
        .get(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('DELETE /fees/:feeId/payments/:id', () => {
    it('deletes a payment (204) and recomputes status', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      const created = await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 100, paidAt: '2026-03-15' })
        .expect(201);
      await request(server)
        .delete(`/fees/${fee.id}/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(204);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.UNPAID);
    });
  });

  // TKT-0105: money out is a Refund ledger; deleting a payment may not strand refunds
  // above what remains collected — net paid never goes negative.
  describe('DELETE /fees/:feeId/payments/:id with refunds on the fee', () => {
    it('returns 400 PAYMENT_DELETE_BELOW_REFUNDED and keeps the payment', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      const created = await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 100, paidAt: '2026-03-15' })
        .expect(201);
      // Seeded directly: this spec's module graph has no refunds controller, and the guard
      // reads the rows, not the route.
      await prisma.refund.create({
        data: {
          tenantId: a.tenantId,
          feeId: fee.id,
          amount: 50,
          refundedAt: new Date('2026-03-20'),
        },
      });
      const res = await request(server)
        .delete(`/fees/${fee.id}/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
      expect(res.body.code).toBe('PAYMENT_DELETE_BELOW_REFUNDED');
      expect(await prisma.payment.count({ where: { feeId: fee.id } })).toBe(1);
    });
  });

  // TKT-0106: class-less (card purchase) fees are tenant-level money — the fee-accessibility
  // gate must not hide them from a location-scoped admin.
  describe('payments on a class-less fee', () => {
    it('location-scoped admin records and lists payments on a fee without a class', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'T',
          lastName: 'X',
          dateOfBirth: new Date('2000-01-01'),
        },
      });
      const fee = await prisma.fee.create({
        data: {
          tenantId: a.tenantId,
          classId: null,
          traineeId: trainee.id,
          periodStart: new Date('2026-03-01'),
          periodEnd: new Date('2026-03-01'),
          amount: 100,
        },
      });

      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ amount: 40, paidAt: '2026-03-05' })
        .expect(201);

      const res = await request(server)
        .get(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body).toHaveLength(1);
    });
  });
});
