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
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { TraineesModule } from './trainees.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

describe('CustomerTraineesController (e2e-ish)', () => {
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
        TraineesModule,
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

  async function setupCustomer() {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.CUSTOMER,
      tenantId: tenant.id,
    });
    const tokens = await auth.login(user);
    return { tenantId: tenant.id, userId: user.id, accessToken: tokens.accessToken };
  }

  describe('GET /me/trainees', () => {
    it('lists a guarded child with the classes they are enrolled in, over the wire', async () => {
      const c = await setupCustomer();
      const cls = await prisma.class.create({
        data: {
          tenantId: c.tenantId,
          name: `Cls-${randomUUID()}`,
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 100,
        },
      });
      const child = await prisma.trainee.create({
        data: {
          tenantId: c.tenantId,
          firstName: 'Kid',
          lastName: 'X',
          dateOfBirth: new Date('2015-01-01'),
          guardians: { connect: [{ id: c.userId }] },
          classes: { connect: [{ id: cls.id }] },
        },
      });

      const res = await request(server)
        .get('/me/trainees')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .set('X-Tenant-Id', c.tenantId)
        .expect(200);

      expect(res.body).toEqual([
        {
          id: child.id,
          firstName: 'Kid',
          lastName: 'X',
          dateOfBirth: child.dateOfBirth.toISOString(),
          classes: [{ id: cls.id, name: cls.name, description: null }],
        },
      ]);
    });

    it('lists an unenrolled linked trainee too, with an empty classes array', async () => {
      const c = await setupCustomer();
      await prisma.trainee.create({
        data: {
          tenantId: c.tenantId,
          firstName: 'Kid',
          lastName: 'Unenrolled',
          dateOfBirth: new Date('2015-01-01'),
          guardians: { connect: [{ id: c.userId }] },
        },
      });

      const res = await request(server)
        .get('/me/trainees')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .set('X-Tenant-Id', c.tenantId)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].classes).toEqual([]);
    });

    it('returns 403 for admin role (customer-only endpoint)', async () => {
      const tenant = await prisma.tenant.create({
        data: { name: 'Test', slug: `t-${randomUUID()}` },
      });
      tenantIds.push(tenant.id);
      const admin = await createTestUser(prisma, {
        email: `${randomUUID()}@x`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.ADMIN,
        tenantId: tenant.id,
      });
      const tokens = await auth.login(admin);
      await request(server)
        .get('/me/trainees')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(403);
    });
  });
});
