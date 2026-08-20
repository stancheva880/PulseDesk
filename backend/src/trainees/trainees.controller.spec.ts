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
import { TraineesModule } from './trainees.module';
import { createTestUser } from '@/test-utils/create-user';

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

  describe('POST /trainees — under-18 rule (PRD)', () => {
    it('returns 400 when a minor is submitted without contacts', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.items.map((t: { lastName: string }) => t.lastName)).toEqual(['A']);
    });

    // TKT-0079: the class roster picker searches instead of paging the whole table. Same contract
    // as GET /users?search — substring over email, first name, last name, matched against four
    // casings of the query because SQLite folds case for ASCII only.
    describe('?search', () => {
      async function tenantWithTwo(actor: { tenantId: string; locationId: string }) {
        const georgi = await prisma.trainee.create({
          data: {
            tenantId: actor.tenantId,
            firstName: 'Георги',
            lastName: 'Иванов',
            email: 'georgi@example.com',
            dateOfBirth: new Date(adultDobIso),
            locations: { connect: [{ id: actor.locationId }] },
          },
        });
        const maria = await prisma.trainee.create({
          data: {
            tenantId: actor.tenantId,
            firstName: 'Мария',
            lastName: 'Петрова',
            dateOfBirth: new Date(adultDobIso),
            locations: { connect: [{ id: actor.locationId }] },
          },
        });
        return { georgi, maria };
      }

      async function search(actor: { tenantId: string; accessToken: string }, query: string) {
        const res = await request(server)
          .get(`/trainees?search=${encodeURIComponent(query)}`)
          .set('Authorization', `Bearer ${actor.accessToken}`)
          .set('X-Tenant-Id', actor.tenantId)
          .expect(200);
        return res.body.items.map((t: { id: string }) => t.id) as string[];
      }

      it('matches a first name, a last name and an email substring', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const { georgi, maria } = await tenantWithTwo(a);

        expect(await search(a, 'Иванов')).toEqual([georgi.id]);
        expect(await search(a, 'georgi@')).toEqual([georgi.id]);
        expect(await search(a, 'Мария')).toEqual([maria.id]);
      });

      it('finds a capitalized Cyrillic name whatever case the query is typed in', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const { georgi } = await tenantWithTwo(a);

        expect(await search(a, 'георги')).toEqual([georgi.id]);
        expect(await search(a, 'ГЕОРГИ')).toEqual([georgi.id]);
        expect(await search(a, 'Георги')).toEqual([georgi.id]);
      });

      it('returns nothing for a query that matches nobody', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await tenantWithTwo(a);
        expect(await search(a, 'Несъществуващ')).toEqual([]);
      });

      it('rejects a search longer than 100 characters with 400', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await request(server)
          .get(`/trainees?search=${'a'.repeat(101)}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(400);
      });

      it('stays inside the tenant and the actor location scope', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const other = await prisma.location.create({
          data: { tenantId: a.tenantId, name: `Other-${randomUUID()}` },
        });
        const elsewhere = await setupActor(UserRole.ADMIN);
        await prisma.trainee.create({
          data: {
            tenantId: a.tenantId,
            firstName: 'Георги',
            lastName: 'Скрит',
            dateOfBirth: new Date(adultDobIso),
            locations: { connect: [{ id: other.id }] },
          },
        });
        await prisma.trainee.create({
          data: {
            tenantId: elsewhere.tenantId,
            firstName: 'Георги',
            lastName: 'ДругКлуб',
            dateOfBirth: new Date(adultDobIso),
            locations: { connect: [{ id: elsewhere.locationId }] },
          },
        });

        // Neither the other location's trainee nor the other club's is reachable.
        expect(await search(a, 'Георги')).toEqual([]);
      });
    });
  });

  describe('GET /trainees/:id', () => {
    it('returns the contract-checked detail shape', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const guardian = await createTestUser(prisma, {
        email: `${randomUUID()}@test.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.CUSTOMER,
        tenantId: a.tenantId,
      });
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Detail',
          lastName: 'Trainee',
          dateOfBirth: new Date(adultDobIso),
          locations: { connect: [{ id: a.locationId }] },
          guardians: { connect: [{ id: guardian.id }] },
          contacts: {
            create: [
              {
                tenantId: a.tenantId,
                firstName: 'Maria',
                lastName: 'Petrova',
                relationship: 'PARENT',
              },
            ],
          },
        },
      });
      const res = await request(server)
        .get(`/trainees/${trainee.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.firstName).toBe('Detail');
      // dateOfBirth crosses the wire as a full ISO timestamp; the form slices it to a day.
      expect(res.body.dateOfBirth).toBe(new Date(adultDobIso).toISOString());
      // guardians and user are narrowed by `select` — exactly these columns, nothing more.
      expect(Object.keys(res.body.guardians[0]).sort()).toEqual([
        'email',
        'firstName',
        'id',
        'lastName',
      ]);
      expect(res.body.user).toBeNull();
      // contacts and locations are included whole.
      expect(res.body.contacts[0].relationship).toBe('PARENT');
      expect(Object.keys(res.body.locations[0]).sort()).toEqual([
        'address',
        'createdAt',
        'id',
        'isActive',
        'name',
        'tenantId',
        'updatedAt',
      ]);
      expect(res.body.classes).toEqual([]);
    });
  });

  describe('Role gating', () => {
    it('lets an employee read a trainee with the guardian contacts', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: e.tenantId,
          firstName: 'Kid',
          lastName: 'Smith',
          dateOfBirth: new Date(minorDobIso),
          phone: '555-9999',
          // TKT-0054: a trainer reads their own locations, so the fixture shares theirs.
          locations: { connect: [{ id: e.locationId }] },
          contacts: {
            create: [
              {
                tenantId: e.tenantId,
                firstName: 'Parent',
                lastName: 'Smith',
                relationship: 'PARENT',
                phone: '555-1234',
                isPrimary: true,
              },
            ],
          },
        },
      });

      const res = await request(server)
        .get(`/trainees/${trainee.id}`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .expect(200);

      // The read-only detail screen shows exactly these — a trainer needs the phone numbers.
      expect(res.body.phone).toBe('555-9999');
      expect(res.body.contacts).toHaveLength(1);
      expect(res.body.contacts[0].phone).toBe('555-1234');
    });

    it('hides a trainee at a location the trainer is not assigned to', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      const other = await prisma.location.create({
        data: { tenantId: e.tenantId, name: `Annex-${randomUUID()}` },
      });
      const mine = await prisma.trainee.create({
        data: {
          tenantId: e.tenantId,
          firstName: 'Mine',
          lastName: 'Smith',
          dateOfBirth: new Date(adultDobIso),
          locations: { connect: [{ id: e.locationId }] },
        },
      });
      const theirs = await prisma.trainee.create({
        data: {
          tenantId: e.tenantId,
          firstName: 'Theirs',
          lastName: 'Jones',
          dateOfBirth: new Date(adultDobIso),
          locations: { connect: [{ id: other.id }] },
        },
      });

      const list = await request(server)
        .get('/trainees')
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .expect(200);
      expect(list.body.items.map((t: { id: string }) => t.id)).toEqual([mine.id]);
      expect(list.body.total).toBe(1);

      await request(server)
        .get(`/trainees/${theirs.id}`)
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
        .expect(404);
    });

    it('returns 403 when an employee tries to create', async () => {
      const e = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/trainees')
        .set('Authorization', `Bearer ${e.accessToken}`)
        .set('X-Tenant-Id', e.tenantId)
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
        .set('X-Tenant-Id', c.tenantId)
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
        .set('X-Tenant-Id', b.tenantId)
        .send({ firstName: 'Hijack' })
        .expect(404);
    });
  });
});
