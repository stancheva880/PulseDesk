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
import { ClassesModule } from './classes.module';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  locationId: string;
  accessToken: string;
}

describe('ClassesController (e2e-ish)', () => {
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
        ClassesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
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
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant', slug } });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Main-${randomUUID()}` },
    });
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role,
        tenantId: tenant.id,
        ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
      },
    });
    const tokens = await auth.login(user);
    return { tenantId: tenant.id, locationId: location.id, accessToken: tokens.accessToken };
  }

  describe('POST /classes', () => {
    it('admin creates a PER_MONTH class', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          name: 'Beginner Tennis',
          billingMode: 'PER_MONTH',
          monthlyAmount: 80,
        })
        .expect(201);
      expect(res.body.name).toBe('Beginner Tennis');
      expect(res.body.tenantId).toBe(a.tenantId);
    });

    it('returns 400 when PER_MONTH is missing monthlyAmount', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ name: 'X', billingMode: 'PER_MONTH' })
        .expect(400);
    });

    it('returns 400 when locationIds reference another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const inB = await prisma.location.create({
        data: { tenantId: b.tenantId, name: 'B-Loc' },
      });
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          name: 'X',
          billingMode: 'PER_SESSION',
          sessionPrice: 5,
          locationIds: [inB.id],
        })
        .expect(400);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ name: 'X', billingMode: 'PER_SESSION', sessionPrice: 10 })
        .expect(403);
    });
  });

  describe('GET /classes', () => {
    it('employee can list classes', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'C1',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
        },
      });
      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(res.body.map((c: { name: string }) => c.name)).toEqual(['C1']);
    });

    it('isolates classes across tenants', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'A',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      await prisma.class.create({
        data: {
          tenantId: b.tenantId,
          name: 'B',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: b.locationId }] },
        },
      });
      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(res.body.map((c: { name: string }) => c.name)).toEqual(['A']);
    });
  });

  describe('PATCH /classes/:id', () => {
    it('rejects billingMode change', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'X',
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 100,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      await request(server)
        .patch(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ billingMode: 'PER_SESSION' })
        .expect(400);
    });

    it('returns 404 for cross-tenant update', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const inA = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'X',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
        },
      });
      await request(server)
        .patch(`/classes/${inA.id}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ name: 'Hijack' })
        .expect(404);
    });
  });

  describe('DELETE /classes/:id', () => {
    it('admin deletes (204)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'X',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      await request(server)
        .delete(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(204);
    });
  });
});
