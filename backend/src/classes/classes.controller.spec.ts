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
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { PrismaService } from '@/prisma/prisma.service';
import { ClassesModule } from './classes.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  locationId: string;
  userId: string;
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
      ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenant.id,
      locationId: location.id,
      userId: user.id,
      accessToken: tokens.accessToken,
    };
  }

  describe('POST /classes', () => {
    it('admin creates a PER_MONTH class', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: 'X', billingMode: 'PER_MONTH' })
        .expect(400);
    });

    // The same bounds the fee and payment amounts carry. A class price is copied straight into a
    // fee amount by the create-fee form, so a price the fee DTO would refuse must not be storable.
    it.each([0, -5, 1.234, 1_000_001])('rejects POST /classes with sessionPrice %s', async (
      sessionPrice,
    ) => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: 'X', billingMode: 'PER_SESSION', sessionPrice })
        .expect(400);
    });

    it.each([0.01, 0.5, 1_000_000])('accepts POST /classes with sessionPrice %s', async (
      sessionPrice,
    ) => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: `Cheap ${sessionPrice}`, billingMode: 'PER_SESSION', sessionPrice })
        .expect(201);
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
        .set('X-Tenant-Id', a.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: 'X', billingMode: 'PER_SESSION', sessionPrice: 10 })
        .expect(403);
    });
  });

  describe('GET /classes', () => {
    it('employee lists only classes they teach', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      // A class the employee teaches → visible.
      await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Mine',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          trainers: { connect: [{ id: a.userId }] },
        },
      });
      // A class they don't teach (and have no session in) → hidden.
      await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'NotMine',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
        },
      });
      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Mine']);
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
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['A']);
    });
  });

  // TKT-0069: the dashboard counted active classes by paging every class in the tenant and
  // filtering in the browser. The filter belongs where the count is, and `total` is what the
  // dashboard reads — so both are asserted here, not just the rows.
  describe('GET /classes?isActive', () => {
    async function twoClasses(tenantId: string, locationId: string) {
      const base = {
        tenantId,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 5,
        locations: { connect: [{ id: locationId }] },
      };
      await prisma.class.create({ data: { ...base, name: 'Active' } });
      await prisma.class.create({ data: { ...base, name: 'Retired', isActive: false } });
    }

    it('counts only the active classes, without returning their rows', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await twoClasses(a.tenantId, a.locationId);

      const res = await request(server)
        .get('/classes?isActive=true&pageSize=1')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      // The point of the ticket: an exact count off the envelope, one row on the wire.
      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Active');
    });

    it('filters the other way too', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await twoClasses(a.tenantId, a.locationId);

      const res = await request(server)
        .get('/classes?isActive=false')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Retired']);
      expect(res.body.total).toBe(1);
    });

    it('omitting isActive returns both, so the parameter adds a filter and changes no default', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await twoClasses(a.tenantId, a.locationId);

      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(2);
    });

    // Boolean query params arrive as strings. Anything that is not 'true' or 'false' has to be a
    // 400: coercing it would answer with a filtered count the caller did not ask for.
    it('rejects a value that is not a boolean with 400', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/classes?isActive=yes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });

    // TKT-0080: the trainee form's class picker searches instead of downloading every class.
    // Same contract as GET /users?search and GET /trainees?search, over the class name.
    describe('?search', () => {
      async function threeClasses(tenantId: string, locationId: string) {
        const base = {
          tenantId,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: locationId }] },
        };
        await prisma.class.create({ data: { ...base, name: 'Йога начинаещи' } });
        await prisma.class.create({ data: { ...base, name: 'Йога напреднали', isActive: false } });
        await prisma.class.create({ data: { ...base, name: 'Плуване' } });
      }

      async function names(actor: { tenantId: string; accessToken: string }, qs: string) {
        const res = await request(server)
          .get(`/classes?${qs}`)
          .set('Authorization', `Bearer ${actor.accessToken}`)
          .set('X-Tenant-Id', actor.tenantId)
          .expect(200);
        return (res.body.items as Array<{ name: string }>).map((c) => c.name);
      }

      it('matches a substring of the class name', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);

        // Sorted on both sides: which classes match is the assertion, not where SQLite's
        // collation puts 'п' relative to 'ч'.
        expect((await names(a, 'search=Йога')).sort()).toEqual(
          ['Йога начинаещи', 'Йога напреднали'].sort(),
        );
        expect(await names(a, 'search=Плув')).toEqual(['Плуване']);
      });

      it('matches a Cyrillic name whatever case the query is typed in', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);

        expect(await names(a, 'search=плуване')).toEqual(['Плуване']);
        expect(await names(a, 'search=ПЛУВАНЕ')).toEqual(['Плуване']);
      });

      // The two filters have to compose: the picker asks for active classes matching a query.
      it('composes with isActive rather than replacing it', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);

        expect(await names(a, 'search=Йога&isActive=true')).toEqual(['Йога начинаещи']);
        expect(await names(a, 'search=Йога&isActive=false')).toEqual(['Йога напреднали']);
      });

      it('returns nothing for a query that matches no class', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);
        expect(await names(a, 'search=Бокс')).toEqual([]);
      });

      it('rejects a search longer than 100 characters with 400', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await request(server)
          .get(`/classes?search=${'a'.repeat(101)}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(400);
      });

      it('stays inside the trainer scope', async () => {
        const a = await setupActor(UserRole.EMPLOYEE);
        const base = { tenantId: a.tenantId, billingMode: BillingMode.PER_SESSION, sessionPrice: 5 };
        await prisma.class.create({
          data: { ...base, name: 'Йога моя', trainers: { connect: [{ id: a.userId }] } },
        });
        await prisma.class.create({ data: { ...base, name: 'Йога чужда' } });

        expect(await names(a, 'search=Йога')).toEqual(['Йога моя']);
      });
    });

    it('narrows within the trainer scope rather than escaping it', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const base = { tenantId: a.tenantId, billingMode: BillingMode.PER_SESSION, sessionPrice: 5 };
      // Active and taught by them → the only row they may count.
      await prisma.class.create({
        data: { ...base, name: 'MineActive', trainers: { connect: [{ id: a.userId }] } },
      });
      // Active but taught by nobody they know → must stay invisible even though isActive matches.
      await prisma.class.create({ data: { ...base, name: 'TheirsActive' } });

      const res = await request(server)
        .get('/classes?isActive=true')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['MineActive']);
      expect(res.body.total).toBe(1);
    });
  });

  describe('GET /classes/:id', () => {
    it('returns the contract-checked detail shape', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Detail',
          billingMode: 'PER_MONTH',
          monthlyAmount: 80,
          locations: { connect: [{ id: a.locationId }] },
          trainers: { connect: [{ id: a.userId }] },
        },
      });
      const res = await request(server)
        .get(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.name).toBe('Detail');
      expect(res.body.monthlyAmount).toBe('80');
      // GET /classes/:id selects only { id, name } from locations — the contract is those
      // two columns, so the whole point is that both are present and nothing more is.
      expect(res.body.locations).toEqual([{ id: a.locationId, name: expect.any(String) }]);
      expect(Object.keys(res.body.locations[0]).sort()).toEqual(['id', 'name']);
      expect(Object.keys(res.body.trainers[0]).sort()).toEqual([
        'email',
        'firstName',
        'id',
        'lastName',
      ]);
      expect(res.body.trainees).toEqual([]);
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
        .set('X-Tenant-Id', a.tenantId)
        .send({ billingMode: 'PER_SESSION' })
        .expect(400);
    });

    it.each([0, -5, 1.234, 1_000_001])('rejects PATCH /classes/:id with monthlyAmount %s', async (
      monthlyAmount,
    ) => {
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
        .set('X-Tenant-Id', a.tenantId)
        .send({ monthlyAmount })
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
        .set('X-Tenant-Id', b.tenantId)
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
        .set('X-Tenant-Id', a.tenantId)
        .expect(204);
    });
  });
});
