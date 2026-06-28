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
import { ClassSchedulesModule } from './class-schedules.module';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  locationId: string;
  accessToken: string;
}

describe('ClassSchedulesController (e2e-ish)', () => {
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
        ClassSchedulesModule,
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
    return { tenantId: tenant.id, locationId: location.id, accessToken: tokens.accessToken };
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

  describe('POST /class-schedules', () => {
    it('admin creates a schedule (201)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const res = await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        })
        .expect(201);
      expect(res.body.tenantId).toBe(a.tenantId);
    });

    it('returns 400 when startTime is malformed', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: cls.id,
          locationId: loc.id,
          dayOfWeek: 'MON',
          startTime: '6pm',
          endTime: '19:00',
        })
        .expect(400);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: cls.id,
          locationId: loc.id,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        })
        .expect(403);
    });
  });

  describe('POST /class-schedules/generate-sessions', () => {
    it('admin generates sessions with a summary response', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      await request(server)
        .post('/class-schedules')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          classId: cls.id,
          locationId: a.locationId,
          dayOfWeek: 'MON',
          startTime: '18:00',
          endTime: '19:00',
        })
        .expect(201);

      const res = await request(server)
        .post('/class-schedules/generate-sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ from: '2026-06-01', to: '2026-06-28' })
        .expect(200);
      expect(res.body).toEqual({ created: 4, skipped: 0 });
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/class-schedules/generate-sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ from: '2026-06-01', to: '2026-06-28' })
        .expect(403);
    });
  });
});
