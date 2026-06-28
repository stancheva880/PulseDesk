import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { PaymentsModule } from './payments.module';

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
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@x`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role,
        tenantId: tenant.id,
        ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
      },
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
    });
  }

  describe('POST /fees/:feeId/payments', () => {
    it('admin records a payment (201) and recomputes status', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ amount: 100, paidAt: '2026-03-15' })
        .expect(201);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PAID);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const adminA = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(adminA.tenantId, 100);
      // employee in their *own* tenant cannot record on a fee that's not theirs;
      // for this test we just use the cross-tenant fee — both expectations are 403/404,
      // but role gating fires first → 403.
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ amount: 50, paidAt: '2026-03-15' })
        .expect(403);
    });

    it('returns 400 for amount = 0', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(a.tenantId, 100, a.locationId);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ amount: 0, paidAt: '2026-03-15' })
        .expect(400);
    });

    it('returns 404 when feeId is in another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const fee = await makeFee(b.tenantId, 100);
      await request(server)
        .post(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
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
        .send({ amount: 30, paidAt: '2026-03-10' })
        .expect(201);
      const res = await request(server)
        .get(`/fees/${fee.id}/payments`)
        .set('Authorization', `Bearer ${a.accessToken}`)
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
        .send({ amount: 100, paidAt: '2026-03-15' })
        .expect(201);
      await request(server)
        .delete(`/fees/${fee.id}/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(204);
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.UNPAID);
    });
  });
});
