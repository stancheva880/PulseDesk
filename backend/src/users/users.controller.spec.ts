import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { MailService } from '@/mail/mail.service';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { PrismaService } from '@/prisma/prisma.service';
import { createTestUser } from '@/test-utils/create-user';
import { UsersModule } from './users.module';

const PASSWORD = 'TestPass123!';

describe('UsersController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;
  const mailMock = {
    send: vi.fn(),
    sendPasswordReset: vi.fn(),
    sendInvite: vi.fn(),
    sendClubAccess: vi.fn(),
  };

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
    })
      .overrideProvider(MailService)
      .useValue(mailMock)
      .compile();
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

  beforeEach(() => {
    mailMock.send.mockReset();
    mailMock.sendPasswordReset.mockReset();
    mailMock.sendInvite.mockReset();
    mailMock.sendInvite.mockResolvedValue(undefined);
    mailMock.sendClubAccess.mockReset();
    mailMock.sendClubAccess.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await app.close();
  });

  async function newSuperAdmin() {
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@super.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.SUPER_ADMIN,
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
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@a.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.ADMIN,
      tenantId,
      locations: { connect: locationIds.map((id) => ({ id })) },
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

    // TKT-0054: ADMIN and EMPLOYEE reads are filtered by their assigned locations, so an
    // account without one would see nothing. The API refuses to create that state.
    it('SUPER_ADMIN creating an EMPLOYEE without locationIds → 400', async () => {
      const sa = await newSuperAdmin();
      const { tenant } = await newTenantWithLocation();
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@e.local`,
          role: UserRole.EMPLOYEE,
        })
        .expect(400);
    });

    it('SUPER_ADMIN creating an ADMIN with an empty locationIds → 400', async () => {
      const sa = await newSuperAdmin();
      const { tenant } = await newTenantWithLocation();
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@a.local`,
          role: UserRole.ADMIN,
          locationIds: [],
        })
        .expect(400);
    });

    it('SUPER_ADMIN creates a CUSTOMER without locationIds → 201', async () => {
      const sa = await newSuperAdmin();
      const { tenant } = await newTenantWithLocation();
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@c.local`,
          role: UserRole.CUSTOMER,
        })
        .expect(201);
      expect(res.body.role).toBe(UserRole.CUSTOMER);
      userIds.push(res.body.id);
    });

    it('SUPER_ADMIN creating a tenant user without X-Tenant-Id → 400', async () => {
      const sa = await newSuperAdmin();
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .send({
          email: `${randomUUID()}@a.local`,
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
          role: UserRole.EMPLOYEE,
          locationIds: [location.id],
        })
        .expect(409);
    });

    // TKT-0003: silent attach — an email with an account in ANOTHER tenant gets a
    // membership in the caller's tenant instead of a duplicate-email 409.
    it('attaches an existing account from another tenant → 201 attachedExisting, password unchanged', async () => {
      const a = await newTenantWithLocation();
      const b = await newTenantWithLocation();
      const originalHash = await auth.hashPassword(PASSWORD);
      const existing = await createTestUser(prisma, {
        email: `${randomUUID()}@attach.local`,
        passwordHash: originalHash,
        role: UserRole.EMPLOYEE,
        tenantId: a.tenant.id,
      });
      userIds.push(existing.id);
      const admin = await newAdmin(b.tenant.id, [b.location.id]);

      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .send({
          email: existing.email,
          role: UserRole.EMPLOYEE,
          locationIds: [b.location.id],
        })
        .expect(201);

      expect(res.body.attachedExisting).toBe(true);
      expect(res.body.id).toBe(existing.id);
      expect(res.body.role).toBe(UserRole.EMPLOYEE);
      expect(res.body.tenantId).toBe(b.tenant.id);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: existing.id },
        select: { passwordHash: true, memberships: { select: { tenantId: true } } },
      });
      expect(after.passwordHash).toBe(originalHash);
      expect(after.memberships.map((m) => m.tenantId).sort()).toEqual(
        [a.tenant.id, b.tenant.id].sort(),
      );
    });

    it('re-adding an email already in the tenant → 409 "Already a member"', async () => {
      const b = await newTenantWithLocation();
      const existing = await createTestUser(prisma, {
        email: `${randomUUID()}@member.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: b.tenant.id,
      });
      userIds.push(existing.id);
      const admin = await newAdmin(b.tenant.id, [b.location.id]);

      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .send({
          email: existing.email,
          role: UserRole.CUSTOMER,
          locationIds: [b.location.id],
        })
        .expect(409);
      expect(res.body.message).toBe('Already a member');
      // TKT-0063: the 409 fires before any mail decision is reached.
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();
    });

    it("attach response contains no data from the account's other tenants", async () => {
      const a = await newTenantWithLocation();
      const b = await newTenantWithLocation();
      const existing = await createTestUser(prisma, {
        email: `${randomUUID()}@leak.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: a.tenant.id,
        locations: { connect: [{ id: a.location.id }] },
      });
      userIds.push(existing.id);
      const admin = await newAdmin(b.tenant.id, [b.location.id]);

      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .send({
          email: existing.email,
          role: UserRole.CUSTOMER,
          locationIds: [b.location.id],
        })
        .expect(201);

      // Only the caller's tenant appears; tenant A's id and location never do.
      expect(res.body.locations).toEqual([expect.objectContaining({ id: b.location.id })]);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(a.tenant.id);
      expect(raw).not.toContain(a.location.id);
      expect(raw).not.toContain(a.location.name);
    });

    it('ADMIN attaching with role ADMIN → 403', async () => {
      const a = await newTenantWithLocation();
      const b = await newTenantWithLocation();
      const existing = await createTestUser(prisma, {
        email: `${randomUUID()}@rolegate.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: a.tenant.id,
      });
      userIds.push(existing.id);
      const admin = await newAdmin(b.tenant.id, [b.location.id]);

      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .send({
          email: existing.email,
          role: UserRole.ADMIN,
          locationIds: [b.location.id],
        })
        .expect(403);
    });
  });

  describe('PATCH /users/:id', () => {
    // TKT-0054: clearing the assignment would leave the trainer able to sign in and see nothing.
    it('clearing the locations of an EMPLOYEE → 400', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const employee = await createTestUser(prisma, {
        email: `${randomUUID()}@e.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: location.id }] },
      });
      userIds.push(employee.id);

      await request(server)
        .patch(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ locationIds: [] })
        .expect(400);
    });

    it('clearing the locations of a CUSTOMER → 200', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const customer = await createTestUser(prisma, {
        email: `${randomUUID()}@c.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.CUSTOMER,
        tenantId: tenant.id,
        locations: { connect: [{ id: location.id }] },
      });
      userIds.push(customer.id);

      const res = await request(server)
        .patch(`/users/${customer.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ locationIds: [] })
        .expect(200);
      expect(res.body.locations).toEqual([]);
    });

    // An admin setting a password is what you do when an account is compromised, so it has to
    // end the sessions that are already running. completePasswordReset (self-service) revokes
    // the user's refresh tokens; this path did not, so the intruder kept refreshing for
    // JWT_REFRESH_TTL — 7 days — while the password had already changed.
    describe('live sessions', () => {
      async function employeeWithTwoSessions() {
        const sa = await newSuperAdmin();
        const { tenant, location } = await newTenantWithLocation();
        const employee = await createTestUser(prisma, {
          email: `${randomUUID()}@e.local`,
          passwordHash: await auth.hashPassword(PASSWORD),
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: location.id }] },
        });
        userIds.push(employee.id);
        // Two, because revocation has to cover every session and not just the newest.
        await auth.login(employee);
        await auth.login(employee);
        expect(await liveTokens(employee.id)).toBe(2);
        return { sa, tenant, employee };
      }

      function liveTokens(userId: string): Promise<number> {
        return prisma.refreshToken.count({ where: { userId, revokedAt: null } });
      }

      it('setting a password revokes every live refresh token of the target', async () => {
        const { sa, tenant, employee } = await employeeWithTwoSessions();

        await request(server)
          .patch(`/users/${employee.id}`)
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .send({ password: 'NewTestPass123!' })
          .expect(200);

        expect(await liveTokens(employee.id)).toBe(0);
      });

      it('deactivating an account revokes every live refresh token of the target', async () => {
        const { sa, tenant, employee } = await employeeWithTwoSessions();

        await request(server)
          .patch(`/users/${employee.id}`)
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .send({ isActive: false })
          .expect(200);

        expect(await liveTokens(employee.id)).toBe(0);
      });

      it('leaves the sessions alone when neither the password nor isActive changes', async () => {
        const { sa, tenant, employee } = await employeeWithTwoSessions();

        await request(server)
          .patch(`/users/${employee.id}`)
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .send({ firstName: 'Renamed' })
          .expect(200);

        expect(await liveTokens(employee.id)).toBe(2);
      });

      it('reactivating an account does not revoke anything', async () => {
        const { sa, tenant, employee } = await employeeWithTwoSessions();

        await request(server)
          .patch(`/users/${employee.id}`)
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .send({ isActive: true })
          .expect(200);

        expect(await liveTokens(employee.id)).toBe(2);
      });
    });
  });

  // TKT-0083: optional, free-text, no format validation — the same contract Trainee and
  // ContactPerson already use. The only rules are the 50-char bound and null-clears-it.
  describe('phone', () => {
    it('creates a user carrying a phone number → 201', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@p.local`,
          role: UserRole.ADMIN,
          locationIds: [location.id],
          phone: '+359 88 123 4567',
        })
        .expect(201);
      expect(res.body.phone).toBe('+359 88 123 4567');
      userIds.push(res.body.id);
    });

    it('creates a user without a phone, and reads it back as null', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const created = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@p.local`,
          role: UserRole.ADMIN,
          locationIds: [location.id],
        })
        .expect(201);
      userIds.push(created.body.id);
      expect(created.body.phone).toBeNull();

      const read = await request(server)
        .get(`/users/${created.body.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);
      expect(read.body.phone).toBeNull();
    });

    it('rejects a phone longer than 50 characters → 400', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@p.local`,
          role: UserRole.ADMIN,
          locationIds: [location.id],
          phone: '1'.repeat(51),
        })
        .expect(400);
    });

    it('sets, then clears, a phone number over PATCH', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const employee = await createTestUser(prisma, {
        email: `${randomUUID()}@p.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: location.id }] },
      });
      userIds.push(employee.id);

      const set = await request(server)
        .patch(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ phone: '0888 000 000' })
        .expect(200);
      expect(set.body.phone).toBe('0888 000 000');

      const cleared = await request(server)
        .patch(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ phone: null })
        .expect(200);
      expect(cleared.body.phone).toBeNull();
    });

    it('leaves an existing phone untouched when the key is omitted', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const employee = await createTestUser(prisma, {
        email: `${randomUUID()}@p.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: location.id }] },
      });
      userIds.push(employee.id);

      await request(server)
        .patch(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ phone: '0888 111 222' })
        .expect(200);

      const res = await request(server)
        .patch(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ firstName: 'Иван' })
        .expect(200);
      expect(res.body.phone).toBe('0888 111 222');
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
      const employee = await createTestUser(prisma, {
        email: `${randomUUID()}@e.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: location.id }] },
      });
      userIds.push(employee.id);
      await request(server)
        .delete(`/users/${employee.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);
    });

    // TKT-0004: ADMIN deletion is per-membership removal, not account deletion.
    it("ADMIN removes a member: only their tenant's membership is deleted, account survives", async () => {
      const a = await newTenantWithLocation();
      const b = await newTenantWithLocation();
      const originalHash = await auth.hashPassword(PASSWORD);
      const member = await createTestUser(prisma, {
        email: `${randomUUID()}@both.local`,
        passwordHash: originalHash,
        role: UserRole.EMPLOYEE,
        tenantId: a.tenant.id,
        locations: { connect: [{ id: a.location.id }, { id: b.location.id }] },
      });
      userIds.push(member.id);
      await prisma.membership.create({
        data: { userId: member.id, tenantId: b.tenant.id, role: UserRole.EMPLOYEE },
      });
      const admin = await newAdmin(b.tenant.id, [b.location.id]);

      await request(server)
        .delete(`/users/${member.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .expect(204);

      const after = await prisma.user.findUnique({
        where: { id: member.id },
        select: {
          passwordHash: true,
          memberships: { select: { tenantId: true } },
          locations: { select: { id: true } },
        },
      });
      expect(after).not.toBeNull();
      expect(after!.passwordHash).toBe(originalHash);
      expect(after!.memberships.map((m) => m.tenantId)).toEqual([a.tenant.id]);
      // Tenant B's location link is severed; tenant A's stays.
      expect(after!.locations.map((l) => l.id)).toEqual([a.location.id]);
    });

    it("removed member's next request with that tenant active → 403", async () => {
      const a = await newTenantWithLocation();
      const b = await newTenantWithLocation();
      const member = await createTestUser(prisma, {
        email: `${randomUUID()}@active.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.ADMIN,
        tenantId: a.tenant.id,
        locations: { connect: [{ id: b.location.id }] },
      });
      userIds.push(member.id);
      await prisma.membership.create({
        data: { userId: member.id, tenantId: b.tenant.id, role: UserRole.ADMIN },
      });
      const memberTokens = await auth.login(member);
      const admin = await newAdmin(b.tenant.id, [b.location.id]);

      // Sanity: member can act in tenant B before removal.
      await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${memberTokens.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .expect(200);

      await request(server)
        .delete(`/users/${member.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .expect(204);

      await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${memberTokens.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .expect(403);
      // The other club is unaffected.
      await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${memberTokens.accessToken}`)
        .set('X-Tenant-Id', a.tenant.id)
        .expect(200);
    });

    it('removing the last membership: account remains, login → 403 "No active memberships"', async () => {
      const b = await newTenantWithLocation();
      const email = `${randomUUID()}@last.local`;
      const member = await createTestUser(prisma, {
        email,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: b.tenant.id,
        locations: { connect: [{ id: b.location.id }] },
      });
      userIds.push(member.id);
      const admin = await newAdmin(b.tenant.id, [b.location.id]);

      await request(server)
        .delete(`/users/${member.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', b.tenant.id)
        .expect(204);

      const account = await prisma.user.findUnique({ where: { id: member.id } });
      expect(account).not.toBeNull();

      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(403);
      expect(res.body.message).toBe('No active memberships');
    });

    it('ADMIN cannot delete an EMPLOYEE outside their location → 404', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const otherLocation = await prisma.location.create({
        data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
      });
      const admin = await newAdmin(tenant.id, [location.id]);
      const employee = await createTestUser(prisma, {
        email: `${randomUUID()}@e.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: otherLocation.id }] },
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
        res.body.items.find((u: { id: string }) => u.id === memberRes.body.id),
      ).toBeDefined();
    });

    it('ADMIN lists users in their assigned locations only', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const otherLocation = await prisma.location.create({
        data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
      });
      const admin = await newAdmin(tenant.id, [location.id]);
      const visible = await createTestUser(prisma, {
        email: `${randomUUID()}@e.local`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: location.id }] },
      });
      const hidden = await createTestUser(prisma, {
        email: `${randomUUID()}@e.local`,
        passwordHash: 'x',
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
        locations: { connect: [{ id: otherLocation.id }] },
      });
      userIds.push(visible.id, hidden.id);
      const res = await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);
      const ids = res.body.items.map((u: { id: string }) => u.id);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(hidden.id);
      // Should also include the admin themselves.
      expect(ids).toContain(admin.user.id);
    });

    // TKT-0070: three forms needed users of one role and had no way to ask, so each downloaded
    // every user in the tenant and filtered in the browser. Role lives on Membership, never on
    // User, which is what makes the tenant pairing below load-bearing.
    describe('?role', () => {
      it('returns only the members holding that role in the acting tenant', async () => {
        const sa = await newSuperAdmin();
        const { tenant, location } = await newTenantWithLocation();
        const employee = await createTestUser(prisma, {
          email: `${randomUUID()}@e.local`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: location.id }] },
        });
        const customer = await createTestUser(prisma, {
          email: `${randomUUID()}@c.local`,
          passwordHash: 'x',
          role: UserRole.CUSTOMER,
          tenantId: tenant.id,
        });
        userIds.push(employee.id, customer.id);

        const res = await request(server)
          .get('/users?role=EMPLOYEE')
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .expect(200);

        const ids = res.body.items.map((u: { id: string }) => u.id);
        expect(ids).toContain(employee.id);
        expect(ids).not.toContain(customer.id);
        // The count follows the filter, so a caller can page it or read the total.
        expect(res.body.total).toBe(1);
      });

      // The reason the filter belongs inside the membership condition and not beside it: a role
      // held in another club says nothing about this one.
      it('matches the role in the acting tenant, not a role held in a different tenant', async () => {
        const sa = await newSuperAdmin();
        const here = await newTenantWithLocation();
        const elsewhere = await newTenantWithLocation();
        const person = await createTestUser(prisma, {
          email: `${randomUUID()}@both.local`,
          passwordHash: 'x',
          role: UserRole.CUSTOMER,
          tenantId: here.tenant.id,
        });
        userIds.push(person.id);
        await prisma.membership.create({
          data: { userId: person.id, tenantId: elsewhere.tenant.id, role: UserRole.EMPLOYEE },
        });

        const asEmployee = await request(server)
          .get('/users?role=EMPLOYEE')
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', here.tenant.id)
          .expect(200);
        expect(asEmployee.body.items.map((u: { id: string }) => u.id)).not.toContain(person.id);

        const asCustomer = await request(server)
          .get('/users?role=CUSTOMER')
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', here.tenant.id)
          .expect(200);
        expect(asCustomer.body.items.map((u: { id: string }) => u.id)).toContain(person.id);
      });

      it('narrows within the ADMIN location scope rather than escaping it', async () => {
        const { tenant, location } = await newTenantWithLocation();
        const otherLocation = await prisma.location.create({
          data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
        });
        const admin = await newAdmin(tenant.id, [location.id]);
        const visible = await createTestUser(prisma, {
          email: `${randomUUID()}@e.local`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: location.id }] },
        });
        const hidden = await createTestUser(prisma, {
          email: `${randomUUID()}@e.local`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          locations: { connect: [{ id: otherLocation.id }] },
        });
        userIds.push(visible.id, hidden.id);

        const res = await request(server)
          .get('/users?role=EMPLOYEE')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .expect(200);

        const ids = res.body.items.map((u: { id: string }) => u.id);
        expect(ids).toContain(visible.id);
        expect(ids).not.toContain(hidden.id);
        // The list always includes the acting admin, through an OR beside the membership
        // condition. That must not become a hole: they are an ADMIN, so a request for EMPLOYEE
        // does not return them.
        expect(ids).not.toContain(admin.user.id);
      });

      it('rejects a role that is not a UserRole with 400', async () => {
        const sa = await newSuperAdmin();
        const { tenant } = await newTenantWithLocation();
        await request(server)
          .get('/users?role=TRAINER')
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .expect(400);
      });
    });

    // TKT-0078: the trainer picker downloaded every employee in the club because there was no
    // way to search. SQLite folds case for ASCII only, so a Cyrillic query is matched against
    // four variants of itself rather than through `mode: 'insensitive'` (unsupported here).
    describe('?search', () => {
      async function tenantWithGeorgi() {
        const { tenant, location } = await newTenantWithLocation();
        const georgi = await createTestUser(prisma, {
          email: `georgi-${randomUUID()}@example.com`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          firstName: 'Георги',
          lastName: 'Иванов',
          locations: { connect: [{ id: location.id }] },
        });
        const other = await createTestUser(prisma, {
          email: `maria-${randomUUID()}@example.com`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          firstName: 'Мария',
          lastName: 'Петрова',
          locations: { connect: [{ id: location.id }] },
        });
        userIds.push(georgi.id, other.id);
        return { tenant, location, georgi, other };
      }

      async function search(token: string, tenantId: string, query: string) {
        const res = await request(server)
          .get(`/users?role=EMPLOYEE&search=${encodeURIComponent(query)}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-Id', tenantId)
          .expect(200);
        return res.body.items.map((u: { id: string }) => u.id) as string[];
      }

      it('matches a first name, a last name and an email substring', async () => {
        const sa = await newSuperAdmin();
        const { tenant, georgi, other } = await tenantWithGeorgi();

        expect(await search(sa.accessToken, tenant.id, 'Георг')).toEqual([georgi.id]);
        expect(await search(sa.accessToken, tenant.id, 'Иванов')).toEqual([georgi.id]);
        expect(await search(sa.accessToken, tenant.id, 'georgi-')).toEqual([georgi.id]);
        expect(await search(sa.accessToken, tenant.id, 'Петрова')).toEqual([other.id]);
      });

      // The whole point of the four variants. SQLite's LIKE is case-sensitive beyond ASCII, so
      // without them a Bulgarian user typing their own language finds nothing.
      it('finds a capitalized Cyrillic name whatever case the query is typed in', async () => {
        const sa = await newSuperAdmin();
        const { tenant, georgi } = await tenantWithGeorgi();

        expect(await search(sa.accessToken, tenant.id, 'георги')).toEqual([georgi.id]);
        expect(await search(sa.accessToken, tenant.id, 'ГЕОРГИ')).toEqual([georgi.id]);
        expect(await search(sa.accessToken, tenant.id, 'Георги')).toEqual([georgi.id]);
      });

      it('returns nothing for a query that matches nobody', async () => {
        const sa = await newSuperAdmin();
        const { tenant } = await tenantWithGeorgi();
        expect(await search(sa.accessToken, tenant.id, 'Христоскov')).toEqual([]);
      });

      it('leaves the result set alone when the parameter is omitted', async () => {
        const sa = await newSuperAdmin();
        const { tenant, georgi, other } = await tenantWithGeorgi();
        const res = await request(server)
          .get('/users?role=EMPLOYEE')
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .expect(200);
        const ids = res.body.items.map((u: { id: string }) => u.id);
        expect(ids).toContain(georgi.id);
        expect(ids).toContain(other.id);
      });

      it('rejects a search longer than 100 characters with 400', async () => {
        const sa = await newSuperAdmin();
        const { tenant } = await newTenantWithLocation();
        await request(server)
          .get(`/users?search=${'a'.repeat(101)}`)
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', tenant.id)
          .expect(400);
      });

      // The one that matters. The ADMIN scope is expressed as `where.OR`; a search clause added
      // as a sibling OR would replace it and hand an ADMIN the whole club.
      it('narrows within the ADMIN location scope rather than escaping it', async () => {
        const { tenant, location } = await newTenantWithLocation();
        const otherLocation = await prisma.location.create({
          data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
        });
        const admin = await newAdmin(tenant.id, [location.id]);
        const hidden = await createTestUser(prisma, {
          email: `${randomUUID()}@e.local`,
          passwordHash: 'x',
          role: UserRole.EMPLOYEE,
          tenantId: tenant.id,
          firstName: 'Георги',
          lastName: 'Скрит',
          locations: { connect: [{ id: otherLocation.id }] },
        });
        userIds.push(hidden.id);

        expect(await search(admin.accessToken, tenant.id, 'Георги')).toEqual([]);
        expect(await search(admin.accessToken, tenant.id, 'Скрит')).toEqual([]);
      });
    });

    it('ADMIN without an X-Tenant-Id header gets 403 (strict header rule)', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(403);
    });

    it('uses the per-tenant role of the ACTIVE tenant (ADMIN in A, EMPLOYEE in B)', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const admin = await newAdmin(tenant.id, [location.id]);
      const other = await prisma.tenant.create({
        data: { slug: `t-${randomUUID()}`, name: 'Other Club' },
      });
      tenantIds.push(other.id);
      await prisma.membership.create({
        data: { userId: admin.user.id, tenantId: other.id, role: UserRole.EMPLOYEE },
      });

      // Active tenant B → EMPLOYEE there → ADMIN-only route rejects.
      await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', other.id)
        .expect(403);

      // Active tenant A → ADMIN there → allowed.
      await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);

      // A tenant they are no member of → 403.
      const foreign = await prisma.tenant.create({
        data: { slug: `t-${randomUUID()}`, name: 'Foreign Club' },
      });
      tenantIds.push(foreign.id);
      await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', foreign.id)
        .expect(403);
    });
  });

  describe('GET /users/super-admins', () => {
    // Route removed in TKT-0010 (dead API surface, PRD-0003); the path now falls
    // through to GET /users/:id and 404s because no user has id "super-admins".
    it('is gone (404 even for SUPER_ADMIN)', async () => {
      const sa = await newSuperAdmin();
      await request(server)
        .get('/users/super-admins')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .expect(404);
    });
  });

  // TKT-0058 — the invite replaces the admin-typed password.
  describe('POST /users — invite flow', () => {
    it('rejects a create payload carrying a password → 400', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@a.local`,
          // The field the DTO no longer declares; forbidNonWhitelisted turns it into a 400.
          password: 'Pass1234!',
          role: UserRole.EMPLOYEE,
          locationIds: [location.id],
        })
        .expect(400);
    });

    it('creates a pending account with a null passwordHash, membership and locations', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const email = `${randomUUID()}@pending.local`;
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ email, role: UserRole.EMPLOYEE, locationIds: [location.id] })
        .expect(201);
      userIds.push(res.body.id);

      const row = await prisma.user.findUnique({
        where: { id: res.body.id },
        include: { memberships: true, locations: { select: { id: true } } },
      });
      expect(row?.passwordHash).toBeNull();
      expect(row?.isActive).toBe(true);
      expect(row?.memberships).toHaveLength(1);
      expect(row?.memberships[0]?.tenantId).toBe(tenant.id);
      expect(row?.locations).toEqual([{ id: location.id }]);
      // The hash is never serialised, whatever its value.
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('issues exactly one invite token with a 48h expiry, stored only as a sha256 hash', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({
          email: `${randomUUID()}@pending.local`,
          role: UserRole.EMPLOYEE,
          locationIds: [location.id],
        })
        .expect(201);
      userIds.push(res.body.id);

      const tokens = await prisma.passwordResetToken.findMany({
        where: { userId: res.body.id },
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.usedAt).toBeNull();
      // 48h ahead, allowing a minute of slack for test execution.
      const hours = (tokens[0]!.expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);
      expect(hours).toBeLessThan(48.1);
      // The raw token is nowhere in the response.
      expect(JSON.stringify(res.body)).not.toContain(tokens[0]!.tokenHash);
    });

    it('mails the invite once with an /accept-invite/<token> URL matching the stored hash', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const email = `${randomUUID()}@pending.local`;
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ email, role: UserRole.EMPLOYEE, locationIds: [location.id] })
        .expect(201);
      userIds.push(res.body.id);

      expect(mailMock.sendInvite).toHaveBeenCalledOnce();
      const arg = mailMock.sendInvite.mock.calls[0]?.[0] as {
        to: string;
        inviteUrl: string;
        expiresAt: Date;
      };
      expect(arg.to).toBe(email);
      expect(arg.inviteUrl).toContain('/accept-invite/');
      const raw = arg.inviteUrl.split('/accept-invite/')[1] ?? '';
      expect(raw.length).toBeGreaterThan(20);
      const stored = await prisma.passwordResetToken.findMany({ where: { userId: res.body.id } });
      expect(stored[0]?.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
      expect(res.body.notificationSent).toBe(true);
      // A password reset was not sent — this is an invite.
      expect(mailMock.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('reports notificationSent false when the transport throws, and keeps the account', async () => {
      mailMock.sendInvite.mockRejectedValue(new Error('SMTP down'));
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const email = `${randomUUID()}@pending.local`;
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ email, role: UserRole.EMPLOYEE, locationIds: [location.id] })
        .expect(201);
      userIds.push(res.body.id);

      expect(res.body.notificationSent).toBe(false);
      // The account and its token survive a failed send — resend (TKT-0060) is the recovery.
      const row = await prisma.user.findUnique({ where: { id: res.body.id } });
      expect(row).not.toBeNull();
      expect(row?.passwordHash).toBeNull();
      const tokens = await prisma.passwordResetToken.findMany({ where: { userId: res.body.id } });
      expect(tokens).toHaveLength(1);
    });

    it('a pending account cannot sign in', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const email = `${randomUUID()}@pending.local`;
      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ email, role: UserRole.EMPLOYEE, locationIds: [location.id] })
        .expect(201);
      userIds.push(res.body.id);
      expect(await auth.validateUser(email, 'anything-at-all')).toBeNull();
    });
  });

  // TKT-0060 — a pending account is a distinguishable state, and its invite can be re-sent.
  describe('account status + POST /users/:id/invite', () => {
    // A tenant member built directly, so the hash and isActive can be set per case.
    async function member(
      tenantId: string,
      locationId: string,
      opts: { passwordHash: string | null; isActive?: boolean; role?: UserRole },
    ) {
      const user = await createTestUser(prisma, {
        email: `${randomUUID()}@m.local`,
        passwordHash: opts.passwordHash,
        role: opts.role ?? UserRole.EMPLOYEE,
        tenantId,
        isActive: opts.isActive ?? true,
        locations: { connect: [{ id: locationId }] },
      });
      userIds.push(user.id);
      return user;
    }

    it('derives PENDING, ACTIVE and INACTIVE on GET /users, and never serialises the hash', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const hash = await auth.hashPassword(PASSWORD);
      const pending = await member(tenant.id, location.id, { passwordHash: null });
      const active = await member(tenant.id, location.id, { passwordHash: hash });
      const inactive = await member(tenant.id, location.id, {
        passwordHash: hash,
        isActive: false,
      });
      // isActive is checked first, so an invited-then-deactivated account reads INACTIVE.
      const pendingInactive = await member(tenant.id, location.id, {
        passwordHash: null,
        isActive: false,
      });

      const res = await request(server)
        .get('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);

      const byId = new Map<string, { status: string }>(
        res.body.items.map((u: { id: string; status: string }) => [u.id, u]),
      );
      expect(byId.get(pending.id)?.status).toBe('PENDING');
      expect(byId.get(active.id)?.status).toBe('ACTIVE');
      expect(byId.get(inactive.id)?.status).toBe('INACTIVE');
      expect(byId.get(pendingInactive.id)?.status).toBe('INACTIVE');
      // The column is read to derive the status; it must not reach the wire.
      expect(JSON.stringify(res.body)).not.toContain(hash);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('EMPLOYEE cannot resend an invite → 403', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const target = await member(tenant.id, location.id, { passwordHash: null });
      const employee = await member(tenant.id, location.id, {
        passwordHash: await auth.hashPassword(PASSWORD),
      });
      const tokens = await auth.login(employee);
      await request(server)
        .post(`/users/${target.id}/invite`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(403);
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
    });

    it('ADMIN gets 404 for a pending user outside their locations', async () => {
      const { tenant, location } = await newTenantWithLocation();
      const otherLocation = await prisma.location.create({
        data: { tenantId: tenant.id, name: `Other-${randomUUID()}` },
      });
      const admin = await newAdmin(tenant.id, [location.id]);
      const target = await member(tenant.id, otherLocation.id, { passwordHash: null });

      await request(server)
        .post(`/users/${target.id}/invite`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(404);
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
    });

    it('marks every prior unused token used, creates exactly one fresh one, and mails once', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const email = `${randomUUID()}@pending.local`;
      const created = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ email, role: UserRole.EMPLOYEE, locationIds: [location.id] })
        .expect(201);
      userIds.push(created.body.id);
      mailMock.sendInvite.mockClear();

      const res = await request(server)
        .post(`/users/${created.body.id}/invite`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);

      expect(res.body).toEqual({ inviteEmailSent: true });
      expect(mailMock.sendInvite).toHaveBeenCalledOnce();
      const tokens = await prisma.passwordResetToken.findMany({
        where: { userId: created.body.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(tokens).toHaveLength(2);
      expect(tokens.filter((t) => t.usedAt === null)).toHaveLength(1);
      expect(tokens[0]?.usedAt).not.toBeNull();
      expect(tokens[1]?.usedAt).toBeNull();
    });

    it('the previous link returns 400 after a resend', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const email = `${randomUUID()}@pending.local`;
      const created = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ email, role: UserRole.EMPLOYEE, locationIds: [location.id] })
        .expect(201);
      userIds.push(created.body.id);
      const firstUrl = (mailMock.sendInvite.mock.calls[0]?.[0] as { inviteUrl: string }).inviteUrl;
      const firstRaw = firstUrl.split('/accept-invite/')[1] ?? '';

      await request(server)
        .post(`/users/${created.body.id}/invite`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);

      // The link from the first mail is dead; only the newest one works.
      await request(server)
        .post('/auth/reset-password')
        .send({ token: firstRaw, newPassword: 'BrandNew123!' })
        .expect(400);
      const stillPending = await prisma.user.findUnique({ where: { id: created.body.id } });
      expect(stillPending?.passwordHash).toBeNull();

      const secondUrl = (mailMock.sendInvite.mock.calls[1]?.[0] as { inviteUrl: string }).inviteUrl;
      const secondRaw = secondUrl.split('/accept-invite/')[1] ?? '';
      await request(server)
        .post('/auth/reset-password')
        .send({ token: secondRaw, newPassword: 'BrandNew123!' })
        .expect(204);
    });

    it('409 for a user who has already accepted, and no token is created', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const accepted = await member(tenant.id, location.id, {
        passwordHash: await auth.hashPassword(PASSWORD),
      });

      await request(server)
        .post(`/users/${accepted.id}/invite`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(409);

      expect(mailMock.sendInvite).not.toHaveBeenCalled();
      expect(await prisma.passwordResetToken.count({ where: { userId: accepted.id } })).toBe(0);
    });

    it('409 for a deactivated pending account, and no token is created', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const deactivated = await member(tenant.id, location.id, {
        passwordHash: null,
        isActive: false,
      });

      await request(server)
        .post(`/users/${deactivated.id}/invite`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(409);

      expect(mailMock.sendInvite).not.toHaveBeenCalled();
      expect(await prisma.passwordResetToken.count({ where: { userId: deactivated.id } })).toBe(0);
    });

    it('reports inviteEmailSent false when the transport throws', async () => {
      const sa = await newSuperAdmin();
      const { tenant, location } = await newTenantWithLocation();
      const pending = await member(tenant.id, location.id, { passwordHash: null });
      mailMock.sendInvite.mockRejectedValue(new Error('SMTP down'));

      const res = await request(server)
        .post(`/users/${pending.id}/invite`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', tenant.id)
        .expect(200);

      expect(res.body).toEqual({ inviteEmailSent: false });
      // The token is still live — the admin can try again.
      const tokens = await prisma.passwordResetToken.findMany({ where: { userId: pending.id } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.usedAt).toBeNull();
    });
  });

  // TKT-0061 — gaining access to another club is announced, without a password link.
  describe('POST /users — attach announces club access', () => {
    // Two clubs with distinguishable names: the account already lives in `home`, the actor is
    // acting in `target`. Asserting the mail names `target` is what proves the club name is
    // resolved from the request's tenant rather than taken from anything the caller supplies.
    async function twoClubs() {
      const home = await prisma.tenant.create({
        data: { slug: `home-${randomUUID()}`, name: `Home Club ${randomUUID()}` },
      });
      const target = await prisma.tenant.create({
        data: { slug: `target-${randomUUID()}`, name: `Target Club ${randomUUID()}` },
      });
      tenantIds.push(home.id, target.id);
      const targetLocation = await prisma.location.create({
        data: { tenantId: target.id, name: `Main-${randomUUID()}` },
      });
      return { home, target, targetLocation };
    }

    async function existingAccountIn(tenantId: string, role: UserRole = UserRole.EMPLOYEE) {
      const user = await createTestUser(prisma, {
        email: `${randomUUID()}@attach.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role,
        tenantId: role === UserRole.SUPER_ADMIN ? null : tenantId,
      });
      userIds.push(user.id);
      return user;
    }

    // TKT-0063 left this open: a deactivated account was attached and mailed regardless.
    // validateUser refuses it at login, so the membership was unusable and the mail told the
    // person about access they do not have. Reactivate first, then attach.
    it('attaching a deactivated account → 409, with no membership and no mail', async () => {
      const sa = await newSuperAdmin();
      const { home, target, targetLocation } = await twoClubs();
      const existing = await existingAccountIn(home.id);
      await prisma.user.update({ where: { id: existing.id }, data: { isActive: false } });

      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', target.id)
        .send({
          email: existing.email,
          role: UserRole.EMPLOYEE,
          locationIds: [targetLocation.id],
        })
        .expect(409);

      expect(
        await prisma.membership.count({ where: { userId: existing.id, tenantId: target.id } }),
      ).toBe(0);
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
    });

    it('announces club access on attach, with no token and no invite', async () => {
      const sa = await newSuperAdmin();
      const { home, target, targetLocation } = await twoClubs();
      const existing = await existingAccountIn(home.id);

      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', target.id)
        .send({
          email: existing.email,
          role: UserRole.EMPLOYEE,
          locationIds: [targetLocation.id],
        })
        .expect(201);

      expect(res.body.attachedExisting).toBe(true);
      expect(res.body.notificationSent).toBe(true);

      expect(mailMock.sendClubAccess).toHaveBeenCalledOnce();
      const arg = mailMock.sendClubAccess.mock.calls[0]?.[0] as {
        to: string;
        clubName: string;
        role: UserRole;
      };
      expect(arg.to).toBe(existing.email);
      // The club the actor is acting in — never the one the account already belonged to.
      expect(arg.clubName).toBe(target.name);
      expect(arg.clubName).not.toBe(home.name);
      expect(arg.role).toBe(UserRole.EMPLOYEE);

      // An account with a password must not be handed a password-setting capability.
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
      expect(await prisma.passwordResetToken.count({ where: { userId: existing.id } })).toBe(0);
      // ...and its existing hash is untouched.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
      expect(after.passwordHash).toBe(existing.passwordHash);
    });

    it('reports notificationSent false when the club-access mail throws', async () => {
      mailMock.sendClubAccess.mockRejectedValue(new Error('SMTP down'));
      const sa = await newSuperAdmin();
      const { home, target, targetLocation } = await twoClubs();
      const existing = await existingAccountIn(home.id);

      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', target.id)
        .send({
          email: existing.email,
          role: UserRole.EMPLOYEE,
          locationIds: [targetLocation.id],
        })
        .expect(201);

      expect(res.body.attachedExisting).toBe(true);
      expect(res.body.notificationSent).toBe(false);
      // The membership is committed regardless — mail sits outside the transaction.
      const memberships = await prisma.membership.findMany({ where: { userId: existing.id } });
      expect(memberships.map((m) => m.tenantId)).toContain(target.id);
    });

    // TKT-0063: the premise TKT-0061 relied on — "an attached account already has a password" —
    // stopped being true at TKT-0058. An account can exist and still have none.
    it('invites a pending account instead of announcing access', async () => {
      const sa = await newSuperAdmin();
      const { home, target, targetLocation } = await twoClubs();
      // Pending: created by an invite that was never opened.
      const pending = await createTestUser(prisma, {
        email: `${randomUUID()}@attach.local`,
        passwordHash: null,
        role: UserRole.EMPLOYEE,
        tenantId: home.id,
      });
      userIds.push(pending.id);

      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', target.id)
        .send({
          email: pending.email,
          role: UserRole.EMPLOYEE,
          locationIds: [targetLocation.id],
        })
        .expect(201);

      expect(res.body.attachedExisting).toBe(true);
      expect(res.body.notificationSent).toBe(true);

      // A link they can actually use — not "sign in with your usual password".
      expect(mailMock.sendInvite).toHaveBeenCalledOnce();
      const arg = mailMock.sendInvite.mock.calls[0]?.[0] as { to: string; inviteUrl: string };
      expect(arg.to).toBe(pending.email);
      expect(arg.inviteUrl).toContain('/accept-invite/');
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();

      // Exactly one live link, and the membership was still created.
      const tokens = await prisma.passwordResetToken.findMany({ where: { userId: pending.id } });
      expect(tokens.filter((t) => t.usedAt === null)).toHaveLength(1);
      const memberships = await prisma.membership.findMany({ where: { userId: pending.id } });
      expect(memberships.map((m) => m.tenantId).sort()).toEqual([home.id, target.id].sort());
    });

    it('reports notificationSent false when the invite mail throws on attach', async () => {
      mailMock.sendInvite.mockRejectedValue(new Error('SMTP down'));
      const sa = await newSuperAdmin();
      const { home, target, targetLocation } = await twoClubs();
      const pending = await createTestUser(prisma, {
        email: `${randomUUID()}@attach.local`,
        passwordHash: null,
        role: UserRole.EMPLOYEE,
        tenantId: home.id,
      });
      userIds.push(pending.id);

      const res = await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', target.id)
        .send({
          email: pending.email,
          role: UserRole.EMPLOYEE,
          locationIds: [targetLocation.id],
        })
        .expect(201);

      expect(res.body.attachedExisting).toBe(true);
      expect(res.body.notificationSent).toBe(false);
      // The membership is committed regardless — mail sits outside the write.
      const memberships = await prisma.membership.findMany({ where: { userId: pending.id } });
      expect(memberships.map((m) => m.tenantId)).toContain(target.id);
    });

    it('409 when attaching a SUPER_ADMIN account, and nothing is mailed', async () => {
      const sa = await newSuperAdmin();
      const { target, targetLocation } = await twoClubs();
      const globalAdmin = await existingAccountIn(target.id, UserRole.SUPER_ADMIN);

      await request(server)
        .post('/users')
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', target.id)
        .send({
          email: globalAdmin.email,
          role: UserRole.EMPLOYEE,
          locationIds: [targetLocation.id],
        })
        .expect(409);

      // The 409 fires before any send is reachable; assert that ordering rather than trusting it.
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
      expect(mailMock.sendPasswordReset).not.toHaveBeenCalled();
      expect(mailMock.send).not.toHaveBeenCalled();
    });
  });
});
