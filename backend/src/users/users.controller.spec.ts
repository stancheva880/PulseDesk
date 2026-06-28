import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { UsersModule } from './users.module';

const PASSWORD = 'TestPass123!';

describe('UsersController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const userIds: string[] = [];
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
        UsersModule,
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
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await app.close();
  });

  async function newSuperAdmin() {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@super.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.SUPER_ADMIN,
        tenantId: null,
      },
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return { user, accessToken: tokens.accessToken };
  }

  async function newTenantWithLocation() {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'Test Tenant' },
    });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Main-${randomUUID()}` },
    });
    return { tenant, location };
  }

  async function newAdmin(tenantId: string, locationIds: string[] = []) {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@a.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.ADMIN,
        tenantId,
        locations: { connect: locationIds.map((id) => ({ id })) },
      },
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return { user, accessToken: tokens.accessToken };
  }

  describe('POST /users', () => {
    it('SUPER_ADMIN creates another SUPER_ADMIN (tenantId omitted) → 201', async () => {
      const sa = await newSuperAdmin();
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .send({
          email: `${randomUUID()}@super.local`,
          password: 'Pass1234!',
          role: UserRole.SUPER_ADMIN,
        })
        .expect(201);
      expect(res.body.role).toBe(UserRole.SUPER_ADMIN);
      expect(res.body.tenantId).toBeNull();
      userIds.push(res.body.id);
    });

    it('SUPER_ADMIN creates an ADMIN with X-Tenant-Id and locationIds → 201', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@a.local`,
          password: 'Pass1234!',
          role: UserRole.ADMIN,
          locationIds: [location.id],
        })
        .expect(201);
      expect(res.body.role).toBe(UserRole.ADMIN);
      expect(res.body.tenantId).toBe(tenant.id);
      expect(res.body.locations).toEqual([
        expect.objectContaining({ id: location.id }),
      ]);
      userIds.push(res.body.id);
    });

    it('SUPER_ADMIN creating a tenant user without X-Tenant-Id → 400', async () => {
      const sa = await newSuperAdmin();
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .send({
          email: `${randomUUID()}@a.local`,
          password: 'Pass1234!',
          role: UserRole.ADMIN,
          locationIds: ['loc'],
        })
        .expect(400);
    });

    it('ADMIN cannot create a SUPER_ADMIN → 403', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          email: `${randomUUID()}@super.local`,
          password: 'Pass1234!',
          role: UserRole.SUPER_ADMIN,
        })
        .expect(403);
    });

    it('ADMIN cannot create another ADMIN → 403', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          email: `${randomUUID()}@a.local`,
          password: 'Pass1234!',
          role: UserRole.ADMIN,
          locationIds: [location.id],
        })
        .expect(403);
    });

    it('ADMIN creates an EMPLOYEE in their tenant + their assigned location → 201', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          email: `${randomUUID()}@e.local`,
          password: 'Pass1234!',
          role: UserRole.EMPLOYEE,
          locationIds: [location.id],
        })
        .expect(201);
      expect(res.body.role).toBe(UserRole.EMPLOYEE);
      expect(res.body.tenantId).toBe(tenant.id);
      userIds.push(res.body.id);
    });

    it('ADMIN cannot assign a location outside their set → 403', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const otherLocation = await prisma.location.create({
        data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
      });
      const admin = await newAdmin(tenant.id, [location.id]);
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          email: `${randomUUID()}@e.local`,
          password: 'Pass1234!',
          role: UserRole.EMPLOYEE,
          locationIds: [otherLocation.id],
        })
        .expect(403);
    });

    it('returns 401 without auth', async () => {
      await request(server).post('/users').send({}).expect(401);
    });

    it('returns 409 on duplicate email within a tenant', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const email = `${randomUUID()}@dup.local`;
      const first = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email,
          password: 'Pass1234!',
          role: UserRole.EMPLOYEE,
          locationIds: [location.id],
        })
        .expect(201);
      userIds.push(first.body.id);
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email,
          password: 'Pass1234!',
          role: UserRole.EMPLOYEE,
          locationIds: [location.id],
        })
        .expect(409);
    });
  });

  describe('DELETE /users/:id', () => {
    it('ADMIN deleting a SUPER_ADMIN → 403', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      const sa = await newSuperAdmin();
      await request(server)
        .delete(`/users/${sa.user.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(403);
    });

    it('SUPER_ADMIN deleting themselves → 403', async () => {
      const sa = await newSuperAdmin();
      await request(server)
        .delete(`/users/${sa.user.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .expect(403);
    });

    it('SUPER_ADMIN deletes another SUPER_ADMIN → 204', async () => {
      const sa1 = await newSuperAdmin();
      const sa2 = await newSuperAdmin();
      await request(server)
        .delete(`/users/${sa2.user.id}`)
        .set('Authorization', `Bearer ${sa1.accessToken}`)
        .expect(204);
    });

    it('ADMIN deletes an EMPLOYEE in their location → 204', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      const employee = await prisma.user.create({
        data: {
          email: `${randomUUID()}@e.local`,
          passwordHash: await auth.hashPassword(PASSWORD),
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: location.id }] },
        },
      });
      userIds.push(employee.id);
      await request(server)
        .delete(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);
    });

    it('ADMIN cannot delete an EMPLOYEE outside their location → 404', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const otherLocation = await prisma.location.create({
        data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
      });
      const admin = await newAdmin(tenant.id, [location.id]);
      const employee = await prisma.user.create({
        data: {
          email: `${randomUUID()}@e.local`,
          passwordHash: await auth.hashPassword(PASSWORD),
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: otherLocation.id }] },
        },
      });
      userIds.push(employee.id);
      await request(server)
        .delete(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);
    });
  });

  describe('GET /users', () => {
    it('SUPER_ADMIN lists users in the X-Tenant-Id tenant', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const memberRes = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@e.local`,
          password: 'Pass1234!',
          role: UserRole.EMPLOYEE,
          locationIds: [location.id],
        })
        .expect(201);
      userIds.push(memberRes.body.id);
      const res = await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);
      expect(
        res.body.find((u: { id: string }) => u.id === memberRes.body.id),
      ).toBeDefined();
    });

    it('ADMIN lists users in their assigned locations only', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const otherLocation = await prisma.location.create({
        data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
      });
      const admin = await newAdmin(tenant.id, [location.id]);
      const visible = await prisma.user.create({
        data: {
          email: `${randomUUID()}@e.local`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: location.id }] },
        },
      });
      const hidden = await prisma.user.create({
        data: {
          email: `${randomUUID()}@e.local`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: otherLocation.id }] },
        },
      });
      userIds.push(visible.id, hidden.id);
      const res = await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      const ids = res.body.map((u: { id: string }) => u.id);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(hidden.id);
      // Should also include the admin themselves.
      expect(ids).toContain(admin.user.id);
    });
  });

  describe('GET /users/super-admins', () => {
    it('SUPER_ADMIN gets the SUPER_ADMIN list', async () => {
      const sa = await newSuperAdmin();
      const res = await request(server)
        .get('/users/super-admins')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .expect(200);
      const ids = res.body.map((u: { id: string }) => u.id);
      expect(ids).toContain(sa.user.id);
      expect(res.body.every((u: { tenantId: string | null }) => u.tenantId === null)).toBe(true);
    });

    it('ADMIN gets 403', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      await request(server)
        .get('/users/super-admins')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(403);
    });
  });
});
