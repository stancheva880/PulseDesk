import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { LocationsModule } from './locations.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

describe('CustomerLocationsController (e2e-ish)', () => {
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
        LocationsModule,
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

  describe('GET /me/locations', () => {
    it('lists a guarded child\'s assigned location, with its payment details', async () => {
      const c = await setupCustomer();
      const loc = await prisma.location.create({
        data: {
          tenantId: c.tenantId,
          name: 'Studio',
          bankIban: 'BG80BNBG96611020345678',
          bankAccountHolder: 'Studio EOOD',
        },
      });
      await prisma.trainee.create({
        data: {
          tenantId: c.tenantId,
          firstName: 'Kid',
          lastName: 'X',
          dateOfBirth: new Date('2015-01-01'),
          guardians: { connect: [{ id: c.userId }] },
          locations: { connect: [{ id: loc.id }] },
        },
      });

      const res = await request(server)
        .get('/me/locations')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .set('X-Tenant-Id', c.tenantId)
        .expect(200);

      expect(res.body).toEqual([
        {
          id: loc.id,
          name: 'Studio',
          bankIban: 'BG80BNBG96611020345678',
          bankAccountHolder: 'Studio EOOD',
          revolutHandle: null,
          myposLink: null,
          cashNote: null,
        },
      ]);
    });

    it('returns an empty list when no trainee is linked', async () => {
      const c = await setupCustomer();
      const res = await request(server)
        .get('/me/locations')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .set('X-Tenant-Id', c.tenantId)
        .expect(200);
      expect(res.body).toEqual([]);
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
        .get('/me/locations')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(403);
    });
  });
});
