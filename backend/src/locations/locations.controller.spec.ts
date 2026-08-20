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
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { PrismaService } from '@/prisma/prisma.service';
import { LocationsModule } from './locations.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string | null;
  userId: string;
  accessToken: string;
}

describe('LocationsController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
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
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  });

  async function newTenant() {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'Test Tenant' },
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function setupTenantActor(role: UserRole, opts?: { locationIds?: string[] }) {
    const tenant = await newTenant();
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@test.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenant.id,
      ...(opts?.locationIds?.length
        ? { locations: { connect: opts.locationIds.map((id) => ({ id })) } }
        : {}),
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return { tenantId: tenant.id, userId: user.id, accessToken: tokens.accessToken } as TestActor;
  }

  async function setupSuperAdmin(): Promise<TestActor> {
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@super.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.SUPER_ADMIN,
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return { tenantId: null, userId: user.id, accessToken: tokens.accessToken };
  }

  describe('GET /locations', () => {
    it('admin can list only their assigned locations', async () => {
      const tenant = await newTenant();
      const gym = await prisma.location.create({ data: { tenantId: tenant.id, name: 'Gym' } });
      await prisma.location.create({ data: { tenantId: tenant.id, name: 'Pool' } });
      const admin = await createTestUser(prisma, {
        email: `${randomUUID()}@a.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.ADMIN,
        tenantId: tenant.id,
        locations: { connect: [{ id: gym.id }] },
      });
      userIds.push(admin.id);
      const tokens = await auth.login(admin);
      const res = await request(server)
        .get('/locations')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);
      expect(res.body.items.map((l: { name: string }) => l.name)).toEqual(['Gym']);
    });

    it('admin with no assigned locations sees an empty list', async () => {
      const actor = await setupTenantActor(UserRole.ADMIN);
      await prisma.location.create({ data: { tenantId: actor.tenantId!, name: 'Gym' } });
      const res = await request(server)
        .get('/locations')
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('X-Tenant-Id', actor.tenantId!)
        .expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('employee lists only their assigned locations', async () => {
      const tenant = await newTenant();
      const pool = await prisma.location.create({
        data: { tenantId: tenant.id, name: 'Pool' },
      });
      await prisma.location.create({ data: { tenantId: tenant.id, name: 'Annex' } });
      const employee = await createTestUser(prisma, {
        email: `${randomUUID()}@e.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: pool.id }] },
      });
      userIds.push(employee.id);
      const tokens = await auth.login(employee);
      const res = await request(server)
        .get('/locations')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);
      expect(res.body.items.map((l: { name: string }) => l.name)).toEqual(['Pool']);
    });

    it('super_admin lists locations of the tenant given by X-Tenant-Id', async () => {
      const tenantA = await newTenant();
      const tenantB = await newTenant();
      await prisma.location.create({ data: { tenantId: tenantA.id, name: 'A-Gym' } });
      await prisma.location.create({ data: { tenantId: tenantB.id, name: 'B-Gym' } });
      const su = await setupSuperAdmin();
      const res = await request(server)
        .get('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenantA.id)
        .expect(200);
      expect(res.body.items.map((l: { name: string }) => l.name)).toEqual(['A-Gym']);
    });

    it('super_admin without X-Tenant-Id gets 400', async () => {
      const su = await setupSuperAdmin();
      await request(server)
        .get('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .expect(400);
    });

    it('super_admin with an unknown X-Tenant-Id gets 404', async () => {
      const su = await setupSuperAdmin();
      await request(server)
        .get('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', 'nonexistent-tenant-id')
        .expect(404);
    });

    it('returns 401 without auth', async () => {
      await request(server).get('/locations').expect(401);
    });

    it('returns 403 for customer role', async () => {
      const actor = await setupTenantActor(UserRole.CUSTOMER);
      await request(server)
        .get('/locations')
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('X-Tenant-Id', actor.tenantId!)
        .expect(403);
    });
  });

  describe('GET /locations/:id', () => {
    it('admin gets 404 for a location outside their assigned set', async () => {
      const tenant = await newTenant();
      const studio = await prisma.location.create({ data: { tenantId: tenant.id, name: 'Studio' } });
      const other = await prisma.location.create({ data: { tenantId: tenant.id, name: 'Other' } });
      const admin = await createTestUser(prisma, {
        email: `${randomUUID()}@a.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.ADMIN,
        tenantId: tenant.id,
        locations: { connect: [{ id: studio.id }] },
      });
      userIds.push(admin.id);
      const tokens = await auth.login(admin);
      await request(server)
        .get(`/locations/${other.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(404);
    });

    it('returns 404 when fetching a location from a different tenant', async () => {
      const a = await setupTenantActor(UserRole.ADMIN);
      const b = await setupTenantActor(UserRole.ADMIN);
      const inA = await prisma.location.create({ data: { tenantId: a.tenantId!, name: 'A-Loc' } });
      await request(server)
        .get(`/locations/${inA.id}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Tenant-Id', b.tenantId!)
        .expect(404);
    });
  });

  describe('POST /locations', () => {
    it('super_admin can create a location with X-Tenant-Id', async () => {
      const tenant = await newTenant();
      const su = await setupSuperAdmin();
      const res = await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ name: 'Main Studio', address: '123 Main' })
        .expect(201);
      expect(res.body.name).toBe('Main Studio');
      expect(res.body.tenantId).toBe(tenant.id);
    });

    it('super_admin without X-Tenant-Id gets 400', async () => {
      const su = await setupSuperAdmin();
      await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .send({ name: 'Studio' })
        .expect(400);
    });

    it('admin gets 403 (only super_admin writes locations)', async () => {
      const actor = await setupTenantActor(UserRole.ADMIN);
      await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('X-Tenant-Id', actor.tenantId!)
        .send({ name: 'Studio' })
        .expect(403);
    });

    it('employee gets 403', async () => {
      const actor = await setupTenantActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('X-Tenant-Id', actor.tenantId!)
        .send({ name: 'Studio' })
        .expect(403);
    });

    it('returns 400 when name is missing', async () => {
      const tenant = await newTenant();
      const su = await setupSuperAdmin();
      await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ address: '123 Main' })
        .expect(400);
    });

    it('returns 400 when extra non-whitelisted fields are sent', async () => {
      const tenant = await newTenant();
      const su = await setupSuperAdmin();
      await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ name: 'Studio', tenantId: 'forged' })
        .expect(400);
    });

    it('returns 409 on duplicate name in the same tenant', async () => {
      const tenant = await newTenant();
      const su = await setupSuperAdmin();
      await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ name: 'Studio' })
        .expect(201);
      await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ name: 'Studio' })
        .expect(409);
    });
  });

  describe('PATCH /locations/:id', () => {
    it('super_admin can update a location', async () => {
      const tenant = await newTenant();
      const created = await prisma.location.create({ data: { tenantId: tenant.id, name: 'Studio' } });
      const su = await setupSuperAdmin();
      const res = await request(server)
        .patch(`/locations/${created.id}`)
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ name: 'Studio A', isActive: false })
        .expect(200);
      expect(res.body.name).toBe('Studio A');
      expect(res.body.isActive).toBe(false);
    });

    it('admin gets 403', async () => {
      const actor = await setupTenantActor(UserRole.ADMIN);
      const created = await prisma.location.create({ data: { tenantId: actor.tenantId!, name: 'Studio' } });
      await request(server)
        .patch(`/locations/${created.id}`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('X-Tenant-Id', actor.tenantId!)
        .send({ name: 'Renamed' })
        .expect(403);
    });

    it('returns 404 when updating a location from a different tenant', async () => {
      const tenantA = await newTenant();
      const tenantB = await newTenant();
      const inA = await prisma.location.create({ data: { tenantId: tenantA.id, name: 'A-Loc' } });
      const su = await setupSuperAdmin();
      await request(server)
        .patch(`/locations/${inA.id}`)
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenantB.id)
        .send({ name: 'Hijacked' })
        .expect(404);
    });
  });

  describe('DELETE /locations/:id', () => {
    it('super_admin can delete a location (returns 204)', async () => {
      const tenant = await newTenant();
      const created = await prisma.location.create({ data: { tenantId: tenant.id, name: 'Studio' } });
      const su = await setupSuperAdmin();
      await request(server)
        .delete(`/locations/${created.id}`)
        .set('Authorization', `Bearer ${su.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(204);
      const remaining = await prisma.location.findFirst({ where: { id: created.id } });
      expect(remaining).toBeNull();
    });

    it('admin gets 403', async () => {
      const actor = await setupTenantActor(UserRole.ADMIN);
      const created = await prisma.location.create({ data: { tenantId: actor.tenantId!, name: 'Studio' } });
      await request(server)
        .delete(`/locations/${created.id}`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('X-Tenant-Id', actor.tenantId!)
        .expect(403);
    });

    it('employee gets 403', async () => {
      const actor = await setupTenantActor(UserRole.EMPLOYEE);
      const created = await prisma.location.create({ data: { tenantId: actor.tenantId!, name: 'Studio' } });
      await request(server)
        .delete(`/locations/${created.id}`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .set('X-Tenant-Id', actor.tenantId!)
        .expect(403);
    });
  });
});
