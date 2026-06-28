import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { TraineesModule } from './trainees.module';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  locationId: string;
  accessToken: string;
}

describe('TraineesController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;

  // 17 years old today.
  const minorDob = new Date();
  minorDob.setFullYear(minorDob.getFullYear() - 17);
  const minorDobIso = minorDob.toISOString().slice(0, 10);

  // 25 years old today.
  const adultDob = new Date();
  adultDob.setFullYear(adultDob.getFullYear() - 25);
  const adultDobIso = adultDob.toISOString().slice(0, 10);

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

  describe('POST /trainees — under-18 rule (PRD)', () => {
    it('returns 400 when a minor is submitted without contacts', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          firstName: 'Kid',
          lastName: 'Smith',
          dateOfBirth: minorDobIso,
        })
        .expect(400);
    });

    it('returns 201 when a minor is submitted with at least one contact', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          firstName: 'Kid',
          lastName: 'Smith',
          dateOfBirth: minorDobIso,
          contacts: [
            {
              firstName: 'Parent',
              lastName: 'Smith',
              relationship: 'PARENT',
              phone: '555-1234',
            },
          ],
        })
        .expect(201);
      expect(res.body.tenantId).toBe(a.tenantId);
      const contacts = await prisma.contactPerson.findMany({
        where: { traineeId: res.body.id },
      });
      expect(contacts).toHaveLength(1);
      expect(contacts[0]?.relationship).toBe(ContactRelationship.PARENT);
    });

    it('returns 201 when an adult is submitted without contacts', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          firstName: 'Adult',
          lastName: 'X',
          dateOfBirth: adultDobIso,
        })
        .expect(201);
    });
  });

  describe('POST /trainees — DTO validation', () => {
    it('returns 400 for invalid dateOfBirth format', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          firstName: 'X',
          lastName: 'Y',
          dateOfBirth: 'not-a-date',
        })
        .expect(400);
    });

    it('returns 400 for invalid contact relationship enum', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({
          firstName: 'Kid',
          lastName: 'X',
          dateOfBirth: minorDobIso,
          contacts: [
            { firstName: 'P', lastName: 'X', relationship: 'COUSIN' },
          ],
        })
        .expect(400);
    });
  });

  describe('GET /trainees', () => {
    it('isolates trainees across tenants', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'A',
          lastName: 'A',
          dateOfBirth: new Date(adultDobIso),
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      await prisma.trainee.create({
        data: {
          tenantId: b.tenantId,
          firstName: 'B',
          lastName: 'B',
          dateOfBirth: new Date(adultDobIso),
          locations: { connect: [{ id: b.locationId }] },
        },
      });
      const res = await request(server)
        .get('/trainees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(res.body.map((t: { lastName: string }) => t.lastName)).toEqual(['A']);
    });
  });

  describe('Role gating', () => {
    it('returns 403 when an employee tries to create', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${e.accessToken}`)
        .send({
          firstName: 'X',
          lastName: 'Y',
          dateOfBirth: adultDobIso,
        })
        .expect(403);
    });

    it('returns 403 when a customer tries to read', async () => {
      const c = await setupActor(UserRole.CUSTOMER);
      await request(server)
        .get('/trainees')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(403);
    });
  });

  describe('PATCH /trainees/:id — cross-tenant', () => {
    it('returns 404 when updating a trainee in another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const inA = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'X',
          lastName: 'Y',
          dateOfBirth: new Date(adultDobIso),
        },
      });
      await request(server)
        .patch(`/trainees/${inA.id}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ firstName: 'Hijack' })
        .expect(404);
    });
  });
});
