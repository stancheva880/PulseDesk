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
import { SessionsModule } from './sessions.module';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  locationId: string;
  accessToken: string;
}

describe('SessionsController (e2e-ish)', () => {
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
        SessionsModule,
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
    const tenant = await prisma.tenant.create({ data: { name: 'Test', slug } });
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

  async function newClass(tenantId: string) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      },
    });
  }
  async function newLocation(tenantId: string) {
    return prisma.location.create({
      data: { tenantId, name: `Loc-${randomUUID()}` },
    });
  }

  describe('POST /sessions', () => {
    it('admin creates a session (201)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const res = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(201);
      expect(res.body.tenantId).toBe(a.tenantId);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(403);
    });

    it('returns 400 when classId belongs to a different tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const classB = await newClass(b.tenantId);
      const locA = await newLocation(a.tenantId);
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: classB.id,
          locationId: locA.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(400);
    });
  });

  describe('GET /sessions visibility', () => {
    it('employee sees only sessions where they are a trainer', async () => {
      const admin = await setupActor(UserRole.ADMIN);
      const employee = await setupActor(UserRole.EMPLOYEE);
      // admin tenant-scope: create a session in employee.tenantId so employee can see (or not).
      // Use the employee's tenant — give them a separate session pair, one assigned, one not.
      const cls = await newClass(employee.tenantId);
      const loc = await newLocation(employee.tenantId);
      const otherTrainer = await prisma.user.create({
        data: {
          tenantId: employee.tenantId,
          email: `${randomUUID()}@x`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
        },
      });

      // Reuse admin auth from a different tenant won't work; we promote admin tokens to
      // employee's tenant by creating an admin in employee's tenant. Connect that admin
      // to `loc` so the new ADMIN location-scoping doesn't filter out the sessions.
      const localAdmin = await prisma.user.create({
        data: {
          tenantId: employee.tenantId,
          email: `${randomUUID()}@x`,
          passwordHash: await auth.hashPassword(PASSWORD),
          role: UserRole.ADMIN,
          locations: { connect: [{ id: loc.id }] },
        },
      });
      const localAdminTokens = await auth.login(localAdmin);

      // Session 1 — employee assigned
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .send({
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
          trainerIds: [employee.userId],
        })
        .expect(201);

      // Session 2 — only otherTrainer
      await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .send({
          classId: cls.id,
          locationId: loc.id,
          startsAt: '2026-06-08T18:00:00.000Z',
          endsAt: '2026-06-08T19:00:00.000Z',
          trainerIds: [otherTrainer.id],
        })
        .expect(201);

      // Admin sees both
      const adminList = await request(server)
        .get('/sessions')
        .set('Authorization', `Bearer ${localAdminTokens.accessToken}`)
        .expect(200);
      expect(adminList.body).toHaveLength(2);

      // Employee sees only the one they're assigned to
      const employeeList = await request(server)
        .get('/sessions')
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .expect(200);
      expect(employeeList.body).toHaveLength(1);

      // Avoid the unused-actor lint complaint; admin came from another tenant in this setup.
      void admin;
    });
  });

  describe('DELETE /sessions/:id', () => {
    it('admin deletes (204)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const created = await request(server)
        .post('/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T19:00:00.000Z',
        })
        .expect(201);
      await request(server)
        .delete(`/sessions/${created.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(204);
    });
  });
});
