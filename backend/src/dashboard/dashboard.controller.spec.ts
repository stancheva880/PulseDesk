import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
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
import { FeesModule } from '@/fees/fees.module';
import { FeesService } from '@/fees/fees.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { DashboardModule } from './dashboard.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

describe('DashboardController (e2e-ish)', () => {
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
        DashboardModule,
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
      ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
    });
    const tokens = await auth.login(user);
    return { tenantId: tenant.id, locationId: location.id, accessToken: tokens.accessToken };
  }

  describe('GET /dashboard/fees-summary', () => {
    it('admin gets a 200 and zero-filled months for an empty range', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .get('/dashboard/fees-summary?from=2026-01-01&to=2026-03-31')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body).toEqual([
        { period: '2026-01', collected: 0, pending: 0 },
        { period: '2026-02', collected: 0, pending: 0 },
        { period: '2026-03', collected: 0, pending: 0 },
      ]);
    });

    it('reflects payments collected against fees in the period', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'T',
          lastName: 'X',
          dateOfBirth: new Date('2000-01-01'),
        },
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Cls-${randomUUID()}`,
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 100,
          trainees: { connect: [{ id: trainee.id }] },
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      const fee = await fees.create(a.tenantId, {
        classId: cls.id,
        traineeId: trainee.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await prisma.payment.create({
        data: { tenantId: a.tenantId, feeId: fee.id, amount: 60, paidAt: new Date('2026-03-15') },
      });

      const res = await request(server)
        .get('/dashboard/fees-summary?from=2026-03-01&to=2026-03-31')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body).toEqual([{ period: '2026-03', collected: 60, pending: 40 }]);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .get('/dashboard/fees-summary?from=2026-01-01&to=2026-03-31')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(403);
    });

    it('uses last-6-months default when no range is provided', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .get('/dashboard/fees-summary')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body).toHaveLength(6);
    });
  });

  describe('GET /dashboard/cashflow-summary', () => {
    it('returns {period, collected, billed} keyed by paidAt month', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'T',
          lastName: 'X',
          dateOfBirth: new Date('2000-01-01'),
        },
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Cls-${randomUUID()}`,
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 100,
          trainees: { connect: [{ id: trainee.id }] },
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      const fee = await fees.create(a.tenantId, {
        classId: cls.id,
        traineeId: trainee.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await prisma.payment.create({
        data: { tenantId: a.tenantId, feeId: fee.id, amount: 100, paidAt: new Date('2026-04-10') },
      });

      const res = await request(server)
        .get('/dashboard/cashflow-summary?from=2026-03-01&to=2026-04-30')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body).toEqual([
        { period: '2026-03', collected: 0, billed: 100 },
        { period: '2026-04', collected: 100, billed: 0 },
      ]);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .get('/dashboard/cashflow-summary')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(403);
    });
  });
});
