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

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
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

  describe('GET /fees', () => {
    it('admin lists with status filter', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newMonthlyClass(a.tenantId, [tr.id], a.locationId);
      await request(server)
        .post('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
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
        .expect(200);
      expect(res.body).toHaveLength(1);
    });

    it('employee can list (read-only)', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .get('/fees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
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
        .send({ periodStart: '2026-03-01', periodEnd: '2026-03-31' })
        .expect(200);
      expect(res.body).toEqual({ created: 1, skipped: 0 });
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/fees/generate-monthly')
        .set('Authorization', `Bearer ${a.accessToken}`)
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
        .expect(404);
    });
  });
});
