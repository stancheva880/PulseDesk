import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ContactRelationship, UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { ContactsModule } from './contacts.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  locationId: string;
  accessToken: string;
}

describe('ContactsController (e2e-ish)', () => {
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
        ContactsModule,
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

  async function setupActor(role: UserRole): Promise<TestActor> {
    const slug = `t-${randomUUID()}`;
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant', slug } });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Main-${randomUUID()}` },
    });
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@test.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenant.id,
      // TKT-0054: ADMIN and EMPLOYEE are both location-scoped, so both need an assignment.
      ...(role === UserRole.ADMIN || role === UserRole.EMPLOYEE
        ? { locations: { connect: [{ id: location.id }] } }
        : {}),
    });
    const tokens = await auth.login(user);
    return { tenantId: tenant.id, locationId: location.id, accessToken: tokens.accessToken };
  }

  async function newTrainee(tenantId: string, locationId?: string) {
    return prisma.trainee.create({
      data: {
        tenantId,
        firstName: 'T',
        lastName: 'X',
        dateOfBirth: new Date('2000-01-01'),
        ...(locationId ? { locations: { connect: [{ id: locationId }] } } : {}),
      },
    });
  }

  describe('GET /trainees/:traineeId/contacts', () => {
    it('lists contacts for the trainee', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await newTrainee(a.tenantId, a.locationId);
      await prisma.contactPerson.create({
        data: {
          tenantId: a.tenantId,
          traineeId: trainee.id,
          firstName: 'P',
          lastName: 'X',
          relationship: ContactRelationship.PARENT,
        },
      });
      const res = await request(server)
        .get(`/trainees/${trainee.id}/contacts`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].firstName).toBe('P');
    });

    it('returns 404 when the trainee belongs to another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const traineeA = await newTrainee(a.tenantId);
      await request(server)
        .get(`/trainees/${traineeA.id}/contacts`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Tenant-Id', b.tenantId)
        .expect(404);
    });
  });

  describe('POST /trainees/:traineeId/contacts', () => {
    it('admin creates a contact (201)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await newTrainee(a.tenantId, a.locationId);
      const res = await request(server)
        .post(`/trainees/${trainee.id}/contacts`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ firstName: 'P', lastName: 'X', relationship: 'GUARDIAN', isPrimary: true })
        .expect(201);
      expect(res.body.tenantId).toBe(a.tenantId);
      expect(res.body.traineeId).toBe(trainee.id);
      expect(res.body.isPrimary).toBe(true);
    });

    it('returns 400 for invalid relationship', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await newTrainee(a.tenantId, a.locationId);
      await request(server)
        .post(`/trainees/${trainee.id}/contacts`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ firstName: 'P', lastName: 'X', relationship: 'COUSIN' })
        .expect(400);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const trainee = await newTrainee(a.tenantId, a.locationId);
      await request(server)
        .post(`/trainees/${trainee.id}/contacts`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ firstName: 'P', lastName: 'X', relationship: 'PARENT' })
        .expect(403);
    });
  });

  describe('GET /trainees/:traineeId/contacts/:id', () => {
    // Route removed in TKT-0010 (dead API surface, PRD-0003) — asserted gone.
    it('returns 404 for the removed GET :id route', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await newTrainee(a.tenantId, a.locationId);
      const c = await prisma.contactPerson.create({
        data: {
          tenantId: a.tenantId,
          traineeId: trainee.id,
          firstName: 'P',
          lastName: 'X',
          relationship: ContactRelationship.PARENT,
        },
      });
      await request(server)
        .get(`/trainees/${trainee.id}/contacts/${c.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(404);
    });
  });

  describe('DELETE /trainees/:traineeId/contacts/:id', () => {
    it('admin deletes (204)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainee = await newTrainee(a.tenantId, a.locationId);
      const c = await prisma.contactPerson.create({
        data: {
          tenantId: a.tenantId,
          traineeId: trainee.id,
          firstName: 'P',
          lastName: 'X',
          relationship: ContactRelationship.PARENT,
        },
      });
      await request(server)
        .delete(`/trainees/${trainee.id}/contacts/${c.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(204);
    });
  });
});
