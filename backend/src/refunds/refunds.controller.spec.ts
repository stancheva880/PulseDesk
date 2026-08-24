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
import { PaymentsModule } from '@/payments/payments.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { RefundsModule } from './refunds.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

describe('RefundsController (e2e-ish)', () => {
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
        // Payments ride along so the tests can build a fee's ledger through the real endpoints.
        PaymentsModule,
        RefundsModule,
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

  async function makeFee(tenantId: string, amount = 100, locationId?: string) {
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

  function pay(a: { tenantId: string; accessToken: string }, feeId: string, amount: number) {
    return request(server)
      .post(`/fees/${feeId}/payments`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .set('X-Tenant-Id', a.tenantId)
      .send({ amount, paidAt: '2026-03-10' });
  }

  function refund(a: { tenantId: string; accessToken: string }, feeId: string, body: object) {
    return request(server)
      .post(`/fees/${feeId}/refunds`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .set('X-Tenant-Id', a.tenantId)
      .send(body);
  }

  describe('POST /fees/:feeId/refunds', () => {
    it('admin records a refund (201) with the audit snapshot; status recomputes to PARTIAL', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 100).expect(201);

      const res = await refund(a, fee.id, {
        amount: 40,
        refundedAt: '2026-03-20',
        method: 'cash',
      }).expect(201);
      expect(res.body).toMatchObject({
        feeId: fee.id,
        amount: '40',
        method: 'cash',
        recordedById: a.userId,
      });
      expect(res.body.recordedByEmailSnapshot).toContain('@x');

      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PARTIAL);
    });

    it('refunding down to a net of zero flips the fee to UNPAID', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 50).expect(201);
      await refund(a, fee.id, { amount: 50, refundedAt: '2026-03-20' }).expect(201);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.UNPAID);
    });

    it('returns 400 REFUND_EXCEEDS_NET_PAID when the refund exceeds net paid', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 50).expect(201);
      const res = await refund(a, fee.id, { amount: 60, refundedAt: '2026-03-20' }).expect(400);
      expect(res.body.code).toBe('REFUND_EXCEEDS_NET_PAID');
      // The message carries the net, so the club knows the most it can give back.
      expect(res.body.message).toContain('50');
      expect(await prisma.refund.count({ where: { feeId: fee.id } })).toBe(0);
    });

    it('returns 400 on a fee with no payments at all', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      const res = await refund(a, fee.id, { amount: 10, refundedAt: '2026-03-20' }).expect(400);
      expect(res.body.code).toBe('REFUND_EXCEEDS_NET_PAID');
    });

    it.each([0, -5, 1.234, 1_000_001])('returns 400 for amount %s', async (amount) => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 100).expect(201);
      await refund(a, fee.id, { amount, refundedAt: '2026-03-20' }).expect(400);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const adminA = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(adminA.tenantId, 100);
      await refund(a, fee.id, { amount: 10, refundedAt: '2026-03-20' }).expect(403);
    });

    it('returns 404 when feeId is in another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(b.tenantId, 100);
      await refund(a, fee.id, { amount: 10, refundedAt: '2026-03-20' }).expect(404);
    });
  });

  describe('GET /fees/:feeId/refunds', () => {
    it('returns a plain array of refunds', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 100).expect(201);
      await refund(a, fee.id, { amount: 30, refundedAt: '2026-03-20' }).expect(201);
      const res = await request(server)
        .get(`/fees/${fee.id}/refunds`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('DELETE /fees/:feeId/refunds/:id', () => {
    it('deletes a refund (204) and recomputes status back', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 100).expect(201);
      const created = await refund(a, fee.id, { amount: 40, refundedAt: '2026-03-20' }).expect(201);
      await request(server)
        .delete(`/fees/${fee.id}/refunds/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(204);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PAID);
    });

    // Approved AC deviation (tech plan): without this guard, pay 100 / refund 50 / re-pay 50 /
    // delete the refund leaves net paid at 150 on a 100 fee — a state FeeStatus cannot express.
    it('returns 400 REFUND_DELETE_EXCEEDS_AMOUNT when deleting would push net paid above the amount', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 100).expect(201);
      const created = await refund(a, fee.id, { amount: 50, refundedAt: '2026-03-20' }).expect(201);
      await pay(a, fee.id, 50).expect(201);
      const res = await request(server)
        .delete(`/fees/${fee.id}/refunds/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
      expect(res.body.code).toBe('REFUND_DELETE_EXCEEDS_AMOUNT');
      expect(await prisma.refund.count({ where: { feeId: fee.id } })).toBe(1);
    });
  });

  // The refunded slice reopens the balance: net paid, not gross, is what the payment guard sees.
  describe('interplay with the payment guard (AC #6)', () => {
    it('a refunded slice can be re-collected, and one unit more still cannot', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await pay(a, fee.id, 100).expect(201);
      await refund(a, fee.id, { amount: 40, refundedAt: '2026-03-20' }).expect(201);
      await pay(a, fee.id, 41).expect(400);
      await pay(a, fee.id, 40).expect(201);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PAID);
    });
  });
});
