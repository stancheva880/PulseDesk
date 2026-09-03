import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import { TenantsModule } from './tenants.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

describe('TenantsController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;
  // TKT-0062: onboarding now mails. Without this override the real ConsoleMailService would
  // print live invite links to stdout on every run, and the sends could not be asserted.
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
        // The controller now injects TenantsService, so the module supplies both.
        TenantsModule,
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

  async function newSuperAdmin(): Promise<string> {
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@super.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.SUPER_ADMIN,
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return tokens.accessToken;
  }

  async function newTenantUser(role: UserRole) {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'Test Tenant' },
    });
    tenantIds.push(tenant.id);
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenant.id,
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return tokens.accessToken;
  }

  it('SUPER_ADMIN can list tenants', async () => {
    // Approved TEST CHANGE REQUEST, 2026-08-22: fixture renamed to sort first — the route
    // orders by name and takes DEFAULT_LIST_TAKE, and the parallel suites' 'Test' tenants
    // on the shared DB could push 'Visible Tenant' past the cap. Assertion unchanged.
    const t = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'AAA Visible Tenant' },
    });
    tenantIds.push(t.id);
    const token = await newSuperAdmin();
    const res = await request(server)
      .get('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find((x: { id: string }) => x.id === t.id)).toBeDefined();
  });

  it('ADMIN gets 403', async () => {
    const token = await newTenantUser(UserRole.ADMIN);
    await request(server)
      .get('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('returns 401 without auth', async () => {
    await request(server).get('/tenants').expect(401);
  });

  describe('GET/PATCH /tenants/payment-details', () => {
    async function newTenantActor(role: UserRole) {
      const tenant = await prisma.tenant.create({
        data: { slug: `t-${randomUUID()}`, name: 'Test Tenant' },
      });
      tenantIds.push(tenant.id);
      const user = await createTestUser(prisma, {
        email: `${randomUUID()}@x.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role,
        tenantId: tenant.id,
      });
      userIds.push(user.id);
      const tokens = await auth.login(user);
      return { tenantId: tenant.id, accessToken: tokens.accessToken };
    }

    it('ADMIN can set and read back the club default', async () => {
      const admin = await newTenantActor(UserRole.ADMIN);
      const patched = await request(server)
        .patch('/tenants/payment-details')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', admin.tenantId)
        .send({ bankIban: 'BG80BNBG96611020345678', bankAccountHolder: 'Club EOOD' })
        .expect(200);
      expect(patched.body).toEqual({
        bankIban: 'BG80BNBG96611020345678',
        bankAccountHolder: 'Club EOOD',
        revolutHandle: null,
        paypalEmail: null,
        cashNote: null,
      });

      const read = await request(server)
        .get('/tenants/payment-details')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', admin.tenantId)
        .expect(200);
      expect(read.body.bankIban).toBe('BG80BNBG96611020345678');
    });

    it('SUPER_ADMIN can set it too, for any active tenant they select', async () => {
      const tenant = await prisma.tenant.create({
        data: { slug: `t-${randomUUID()}`, name: 'Test Tenant' },
      });
      tenantIds.push(tenant.id);
      const token = await newSuperAdmin();
      await request(server)
        .patch('/tenants/payment-details')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Id', tenant.id)
        .send({ revolutHandle: '@club' })
        .expect(200);
      const stored = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
      expect(stored.revolutHandle).toBe('@club');
    });

    it('EMPLOYEE gets 403', async () => {
      const employee = await newTenantActor(UserRole.EMPLOYEE);
      await request(server)
        .patch('/tenants/payment-details')
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .set('X-Tenant-Id', employee.tenantId)
        .send({ cashNote: 'x' })
        .expect(403);
    });

    it('clears a field with an explicit null, leaves an omitted one untouched', async () => {
      const admin = await newTenantActor(UserRole.ADMIN);
      await request(server)
        .patch('/tenants/payment-details')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', admin.tenantId)
        .send({ bankIban: 'BG80BNBG96611020345678', paypalEmail: 'club@x.com' })
        .expect(200);
      const cleared = await request(server)
        .patch('/tenants/payment-details')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', admin.tenantId)
        .send({ bankIban: null })
        .expect(200);
      expect(cleared.body.bankIban).toBeNull();
      expect(cleared.body.paypalEmail).toBe('club@x.com');
    });

    it('rejects a malformed paypalEmail with 400', async () => {
      const admin = await newTenantActor(UserRole.ADMIN);
      await request(server)
        .patch('/tenants/payment-details')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('X-Tenant-Id', admin.tenantId)
        .send({ paypalEmail: 'not-an-email' })
        .expect(400);
    });
  });

  describe('POST /tenants', () => {
    function payload(over: Record<string, unknown> = {}) {
      const unique = randomUUID();
      return {
        name: 'New Sports Club',
        slug: `club-${unique}`,
        locationName: 'Central Hall',
        adminEmail: `${unique}@club.local`,
        adminFirstName: 'Ivan',
        adminLastName: 'Petrov',
        ...over,
      };
    }

    it('creates the club, its first location and its first administrator', async () => {
      const token = await newSuperAdmin();
      const body = payload();

      const res = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);

      tenantIds.push(res.body.id);
      // Approved TEST CHANGE REQUEST, 2026-08-19: notificationSent added because POST /tenants
      // now reports whether the administrator's mail left. Still toEqual, so an unintended
      // field on this response is still a failure.
      expect(res.body).toEqual({
        id: expect.any(String) as string,
        slug: body.slug,
        name: body.name,
        isActive: true,
        notificationSent: true,
      });

      const location = await prisma.location.findFirst({ where: { tenantId: res.body.id } });
      expect(location?.name).toBe('Central Hall');

      const admin = await prisma.user.findUnique({
        where: { email: body.adminEmail },
        select: {
          id: true,
          passwordHash: true,
          memberships: { select: { tenantId: true, role: true } },
          locations: { select: { id: true } },
        },
      });
      expect(admin).not.toBeNull();
      userIds.push(admin!.id);
      expect(admin!.memberships).toEqual([{ tenantId: res.body.id, role: UserRole.ADMIN }]);
      // TKT-0054: an ADMIN with no location reads empty lists, so onboarding assigns one.
      expect(admin!.locations).toEqual([{ id: location!.id }]);
      // TKT-0062: no password is chosen for them — they set their own from the invite.
      expect(admin!.passwordHash).toBeNull();
    });

    // Replaces `lets the administrator sign in with the password they were given` (approved TEST
    // CHANGE REQUEST, 2026-08-19). There is no password to be given any more, and an admin who
    // knows another person's credential is the defect PRD-0010 exists to close.
    it('the new administrator cannot sign in until they accept the invite', async () => {
      const token = await newSuperAdmin();
      const body = payload();
      const res = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
      tenantIds.push(res.body.id);

      const created = await prisma.user.findUniqueOrThrow({
        where: { email: body.adminEmail },
      });
      userIds.push(created.id);

      expect(created.passwordHash).toBeNull();
      expect(await auth.validateUser(body.adminEmail, 'anything-at-all')).toBeNull();
      // ...but the link that makes the account usable was issued.
      const tokens = await prisma.passwordResetToken.findMany({
        where: { userId: created.id },
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.usedAt).toBeNull();
    });

    it('rejects a payload carrying adminPassword → 400', async () => {
      const token = await newSuperAdmin();
      await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        // The field the DTO no longer declares; forbidNonWhitelisted turns it into a 400.
        .send(payload({ adminPassword: 'ClubAdmin!Pass1' }))
        .expect(400);
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
    });

    it('issues one invite for a brand-new administrator', async () => {
      const token = await newSuperAdmin();
      const body = payload();
      const res = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
      tenantIds.push(res.body.id);
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: body.adminEmail } });
      userIds.push(admin.id);

      expect(mailMock.sendInvite).toHaveBeenCalledOnce();
      const arg = mailMock.sendInvite.mock.calls[0]?.[0] as { to: string; inviteUrl: string };
      expect(arg.to).toBe(body.adminEmail);
      expect(arg.inviteUrl).toContain('/accept-invite/');
      // A brand-new account is invited, never told it already has access.
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();
    });

    it('announces club access instead of inviting when the email already has an account', async () => {
      const token = await newSuperAdmin();
      const firstBody = payload();
      const first = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(firstBody)
        .expect(201);
      tenantIds.push(first.body.id);
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: firstBody.adminEmail },
      });
      userIds.push(admin.id);
      // Accept the first invite the way completePasswordReset does: set the hash and spend
      // the token. Without this the account is still pending, which is the case below.
      const acceptedHash = await auth.hashPassword(PASSWORD);
      await prisma.user.update({
        where: { id: admin.id },
        data: { passwordHash: acceptedHash },
      });
      await prisma.passwordResetToken.updateMany({
        where: { userId: admin.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      mailMock.sendInvite.mockClear();

      const secondBody = payload({ adminEmail: firstBody.adminEmail });
      const second = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(secondBody)
        .expect(201);
      tenantIds.push(second.body.id);

      expect(mailMock.sendClubAccess).toHaveBeenCalledOnce();
      const arg = mailMock.sendClubAccess.mock.calls[0]?.[0] as {
        to: string;
        clubName: string;
        role: UserRole;
      };
      expect(arg.to).toBe(firstBody.adminEmail);
      // The persisted name of the club just created, not the one they already ran.
      expect(arg.clubName).toBe(secondBody.name);
      expect(arg.role).toBe(UserRole.ADMIN);

      // No password-setting link for an account that already has one.
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
      expect(
        await prisma.passwordResetToken.count({ where: { userId: admin.id, usedAt: null } }),
      ).toBe(0);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(after.passwordHash).toBe(acceptedHash);
    });

    // Decided with the user on 2026-08-19. An account that exists but has never accepted has no
    // password, so a club-access notice telling it to "sign in as usual" would leave the person
    // stuck with no way in. The hash decides which mail goes out, not merely whether the account
    // exists.
    it('invites an existing account that has not accepted yet, rather than announcing access', async () => {
      const token = await newSuperAdmin();
      const firstBody = payload();
      const first = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(firstBody)
        .expect(201);
      tenantIds.push(first.body.id);
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: firstBody.adminEmail },
      });
      userIds.push(admin.id);
      expect(admin.passwordHash).toBeNull();
      mailMock.sendInvite.mockClear();

      const second = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(payload({ adminEmail: firstBody.adminEmail }))
        .expect(201);
      tenantIds.push(second.body.id);

      expect(mailMock.sendInvite).toHaveBeenCalledOnce();
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();
      // Re-issuing invalidates the first link and leaves exactly one live one.
      const tokens = await prisma.passwordResetToken.findMany({ where: { userId: admin.id } });
      expect(tokens.filter((t) => t.usedAt === null)).toHaveLength(1);
      // Still attached to both clubs regardless of which mail went out.
      const memberships = await prisma.membership.findMany({ where: { userId: admin.id } });
      expect(memberships).toHaveLength(2);
    });

    // Same rule as the attach path on POST /users: a deactivated account cannot sign in, so
    // making it a club's only administrator would leave the new club with nobody who can reach it.
    it('rejects a deactivated administrator with 409, leaving no club behind', async () => {
      const token = await newSuperAdmin();
      const body = payload();
      const deactivated = await createTestUser(prisma, {
        email: body.adminEmail,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.SUPER_ADMIN,
      });
      userIds.push(deactivated.id);
      // SUPER_ADMIN is rejected for its own reason, so demote it to a plain deactivated account.
      await prisma.user.update({
        where: { id: deactivated.id },
        data: { isSuperAdmin: false, isActive: false },
      });

      await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(409);

      expect(await prisma.tenant.count({ where: { slug: body.slug } })).toBe(0);
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
    });

    // TKT-0062 left delivery unreported: the response said success even when the club's only
    // administrator never received the mail that is their only way in. CreatedTenant carries it
    // now, on its own schema so GET /tenants keeps the shape the club selector reads.
    it('reports notificationSent true when the onboarding invite goes out', async () => {
      const token = await newSuperAdmin();
      const body = payload();

      const res = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
      tenantIds.push(res.body.id);
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: body.adminEmail } });
      userIds.push(admin.id);

      expect(res.body.notificationSent).toBe(true);
      expect(mailMock.sendInvite).toHaveBeenCalledOnce();
    });

    it('reports notificationSent false when the invite mail throws, and keeps the club', async () => {
      mailMock.sendInvite.mockRejectedValue(new Error('SMTP down'));
      const token = await newSuperAdmin();
      const body = payload();

      const res = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
      tenantIds.push(res.body.id);
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: body.adminEmail } });
      userIds.push(admin.id);

      // A failed send is not a failed onboarding: the club, its location and the pending
      // administrator all stand, and the Users page can re-send the invite.
      expect(res.body.notificationSent).toBe(false);
      expect(res.body.slug).toBe(body.slug);
      expect(await prisma.tenant.count({ where: { slug: body.slug } })).toBe(1);
    });

    it('reports notificationSent on the club-access arm as well', async () => {
      const token = await newSuperAdmin();
      const accepted = await createTestUser(prisma, {
        email: `${randomUUID()}@accepted.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.SUPER_ADMIN,
      });
      userIds.push(accepted.id);
      // A plain account with a password: the arm that sends a club-access notice, not an invite.
      await prisma.user.update({ where: { id: accepted.id }, data: { isSuperAdmin: false } });

      const res = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(payload({ adminEmail: accepted.email }))
        .expect(201);
      tenantIds.push(res.body.id);

      expect(res.body.notificationSent).toBe(true);
      expect(mailMock.sendClubAccess).toHaveBeenCalledOnce();
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
    });

    it('rejects a duplicate slug with 409', async () => {
      const token = await newSuperAdmin();
      const first = payload();
      const res = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(first)
        .expect(201);
      tenantIds.push(res.body.id);
      const admin = await prisma.user.findUnique({ where: { email: first.adminEmail } });
      userIds.push(admin!.id);

      await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(payload({ slug: first.slug }))
        .expect(409);
    });

    it('leaves no club behind when the administrator cannot be created', async () => {
      const token = await newSuperAdmin();
      // A SUPER_ADMIN account already has global access, so it can never be a club's admin —
      // the same refusal users.service.ts makes on its attach path.
      const superEmail = `${randomUUID()}@super.local`;
      const superUser = await createTestUser(prisma, {
        email: superEmail,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.SUPER_ADMIN,
      });
      userIds.push(superUser.id);
      const body = payload({ adminEmail: superEmail });

      await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(409);

      // The atomicity criterion: the club and its location must not survive the failure.
      expect(await prisma.tenant.count({ where: { slug: body.slug } })).toBe(0);
      expect(await prisma.location.count({ where: { name: body.locationName, tenant: { slug: body.slug } } })).toBe(0);
      // TKT-0062: the 409 fires before anything can be mailed; assert that ordering.
      expect(mailMock.sendInvite).not.toHaveBeenCalled();
      expect(mailMock.sendClubAccess).not.toHaveBeenCalled();
    });

    it('attaches an email that already runs another club instead of duplicating it', async () => {
      const token = await newSuperAdmin();
      const firstBody = payload();
      const first = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(firstBody)
        .expect(201);
      tenantIds.push(first.body.id);

      const second = await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(payload({ adminEmail: firstBody.adminEmail }))
        .expect(201);
      tenantIds.push(second.body.id);

      const admin = await prisma.user.findUnique({
        where: { email: firstBody.adminEmail },
        select: { id: true, memberships: { select: { tenantId: true, role: true } } },
      });
      userIds.push(admin!.id);
      expect(admin!.memberships).toHaveLength(2);
      expect(admin!.memberships.map((m) => m.role)).toEqual([UserRole.ADMIN, UserRole.ADMIN]);
    });

    it('rejects a slug that is not url-safe with 400', async () => {
      const token = await newSuperAdmin();
      await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(payload({ slug: 'Not A Slug' }))
        .expect(400);
    });

    it('rejects a missing location name with 400', async () => {
      const token = await newSuperAdmin();
      const { locationName: _drop, ...rest } = payload();
      await request(server)
        .post('/tenants')
        .set('Authorization', `Bearer ${token}`)
        .send(rest)
        .expect(400);
    });

    it('ADMIN and EMPLOYEE cannot create a club', async () => {
      for (const role of [UserRole.ADMIN, UserRole.EMPLOYEE]) {
        const token = await newTenantUser(role);
        await request(server)
          .post('/tenants')
          .set('Authorization', `Bearer ${token}`)
          .send(payload())
          .expect(403);
      }
    });

    it('returns 401 without auth', async () => {
      await request(server).post('/tenants').send(payload()).expect(401);
    });
  });
});
