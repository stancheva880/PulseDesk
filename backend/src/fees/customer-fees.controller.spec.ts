import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { PrismaService } from '@/prisma/prisma.service';
import { FeesModule } from './fees.module';
import { FeesService } from './fees.service';

const PASSWORD = 'TestPass123!';

describe('CustomerFeesController (e2e-ish)', () => {
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

  async function setupCustomer() {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@x`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.CUSTOMER,
        tenantId: tenant.id,
      },
    });
    const tokens = await auth.login(user);
    return { tenantId: tenant.id, userId: user.id, accessToken: tokens.accessToken };
  }

  describe('GET /me/fees', () => {
    it('customer sees fees only for trainees they own/guard, with embedded class+trainee+payments', async () => {
      const c = await setupCustomer();
      const own = await prisma.trainee.create({
        data: {
          tenantId: c.tenantId,
          firstName: 'Self',
          lastName: 'A',
          dateOfBirth: new Date('1990-01-01'),
          userId: c.userId,
        },
      });
      const stranger = await prisma.trainee.create({
        data: {
          tenantId: c.tenantId,
          firstName: 'Other',
          lastName: 'X',
          dateOfBirth: new Date('1990-01-01'),
        },
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: c.tenantId,
          name: `Cls-${randomUUID()}`,
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 100,
          trainees: { connect: [{ id: own.id }, { id: stranger.id }] },
        },
      });
      const ownFee = await fees.create(c.tenantId, {
        classId: cls.id,
        traineeId: own.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      });
      await fees.create(c.tenantId, {
        classId: cls.id,
        traineeId: stranger.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      });
      await prisma.payment.create({
        data: { tenantId: c.tenantId, feeId: ownFee.id, amount: 50, paidAt: new Date('2026-03-15') },
      });

      const res = await request(server)
        .get('/me/fees')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].traineeId).toBe(own.id);
      expect(res.body[0].class.name).toBe(cls.name);
      expect(res.body[0].trainee.firstName).toBe('Self');
      expect(res.body[0].payments).toHaveLength(1);
    });

    it('returns 403 for admin role (customer-only endpoint)', async () => {
      const tenant = await prisma.tenant.create({
        data: { name: 'Test', slug: `t-${randomUUID()}` },
      });
      tenantIds.push(tenant.id);
      const admin = await prisma.user.create({
        data: {
          email: `${randomUUID()}@x`,
          passwordHash: await auth.hashPassword(PASSWORD),
          role: UserRole.ADMIN,
          tenantId: tenant.id,
        },
      });
      const tokens = await auth.login(admin);
      await request(server)
        .get('/me/fees')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(403);
    });
  });
});
