import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseSchemaInterceptor } from '../common/response-schema.interceptor';
import { MailService } from '../mail/mail.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { createTestUser } from '@/test-utils/create-user';

const TEST_PASSWORD = 'TestPass123!';
const REFRESH_COOKIE = 'pulsedesk.rt';

// TKT-0036 — the refresh token travels as a Set-Cookie now, so these pull it back out.
function refreshCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return all.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
}

function cookieValue(setCookie: string): string {
  return setCookie.split(';')[0]!.split('=').slice(1).join('=');
}

// Set-Cookie carries attributes; a Cookie request header must not.
function cookieHeader(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

describe('AuthController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const mailMock = {
    send: vi.fn(),
    sendPasswordReset: vi.fn(),
  };
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({}),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        PrismaService,
        { provide: MailService, useValue: mailMock },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // AppModule registers this as an APP_INTERCEPTOR; this spec builds its own module graph,
    // so it wires the interceptor here too — without it these routes would be unenforced.
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

  async function seedUser() {
    const slug = `t-${randomUUID()}`;
    const tenant = await prisma.tenant.create({ data: { name: 'Demo', slug } });
    tenantIds.push(tenant.id);
    const email = `${randomUUID()}@test.local`;
    const user = await createTestUser(prisma, {
      email,
      passwordHash: await auth.hashPassword(TEST_PASSWORD),
      role: UserRole.ADMIN,
      tenantId: tenant.id,
    });
    userIds.push(user.id);
    return { email, user, tenant };
  }

  describe('POST /auth/login', () => {
    // TKT-0036 (approved TEST CHANGE REQUEST): the refresh token moved from the response
    // body into an httpOnly cookie. The asserted intent — login issues both tokens — is
    // unchanged; only the transport of the second one is.
    it('returns an access token and sets the refresh token as an httpOnly cookie', async () => {
      const { email } = await seedUser();
      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toBeTruthy();
      // The point of the change: no script can read this.
      expect(res.body.refreshToken).toBeUndefined();

      const cookie = refreshCookie(res);
      expect(cookie).toBeTruthy();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/auth/i);
    });

    it('returns the memberships list for a tenant user', async () => {
      const { email, tenant } = await seedUser();
      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.memberships).toEqual([
        { tenantId: tenant.id, tenantName: 'Demo', role: UserRole.ADMIN },
      ]);
    });

    it('returns all memberships for a multi-tenant user', async () => {
      const { email, user, tenant } = await seedUser();
      const other = await prisma.tenant.create({
        data: { name: 'Other Club', slug: `t-${randomUUID()}` },
      });
      tenantIds.push(other.id);
      await prisma.membership.create({
        data: { userId: user.id, tenantId: other.id, role: UserRole.EMPLOYEE },
      });
      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.memberships).toHaveLength(2);
      expect(res.body.memberships).toEqual(
        expect.arrayContaining([
          { tenantId: tenant.id, tenantName: 'Demo', role: UserRole.ADMIN },
          { tenantId: other.id, tenantName: 'Other Club', role: UserRole.EMPLOYEE },
        ]),
      );
    });

    it('returns empty memberships for SUPER_ADMIN', async () => {
      const email = `${randomUUID()}@super.local`;
      const user = await createTestUser(prisma, {
        email,
        passwordHash: await auth.hashPassword(TEST_PASSWORD),
        role: UserRole.SUPER_ADMIN,
      });
      userIds.push(user.id);
      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.memberships).toEqual([]);
    });

    it('returns 403 "No active memberships" for a tenant user with zero memberships', async () => {
      const { email, user } = await seedUser();
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(403);
      expect(res.body.message).toBe('No active memberships');
    });

    it('returns 401 on wrong password', async () => {
      const { email } = await seedUser();
      await request(server)
        .post('/auth/login')
        .send({ email, password: 'wrong' })
        .expect(401);
    });

    it('returns 400 when email is missing', async () => {
      await request(server)
        .post('/auth/login')
        .send({ password: TEST_PASSWORD })
        .expect(400);
    });
  });

  describe('POST /auth/refresh', () => {
    // TKT-0036 (approved TCR): rotation is now driven by the cookie. Same intent —
    // presenting the issued token yields a new one and retires the old.
    it('rotates via the cookie and keeps the new token out of the body', async () => {
      const { email } = await seedUser();
      const login = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const first = refreshCookie(login) as string;

      const res = await request(server)
        .post('/auth/refresh')
        .set('Cookie', cookieHeader(first))
        .expect(200);

      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeUndefined();
      const rotated = refreshCookie(res);
      expect(rotated).toBeTruthy();
      expect(cookieValue(rotated as string)).not.toBe(cookieValue(first));
    });

    it('returns 401 for an unknown refresh token', async () => {
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: 'not-real' })
        .expect(401);
    });

    // Distinguishes the DTO change from a regression: with refreshToken still required,
    // a bodyless post would be rejected by the ValidationPipe as 400 instead.
    it('returns 401, not 400, when neither a cookie nor a body token is sent', async () => {
      await request(server).post('/auth/refresh').send({}).expect(401);
    });

    // The non-browser path. A native client has no cookie jar, so it authenticates with
    // the body and needs the rotation handed back the same way.
    it('still rotates via the body and returns the token, setting no cookie', async () => {
      const { email, user } = await seedUser();
      await request(server).post('/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
      const pair = await auth.login(user);

      const res = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: pair.refreshToken })
        .expect(200);

      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.refreshToken).not.toBe(pair.refreshToken);
      expect(refreshCookie(res)).toBeUndefined();
    });
  });

  describe('POST /auth/logout', () => {
    // TKT-0036 (approved TCR). Before the rewrite this passed vacuously: once the body
    // stopped carrying refreshToken, logout received an empty body, skipped the revoke,
    // and the follow-up 401 came from "no token" rather than "revoked token". Sending
    // the captured cookie explicitly is what makes the 401 mean revocation again.
    it('revokes the cookie token (204) and a refresh with it then fails', async () => {
      const { email } = await seedUser();
      const login = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const cookie = refreshCookie(login) as string;
      expect(cookieValue(cookie)).toBeTruthy(); // guards against the vacuum returning

      const out = await request(server)
        .post('/auth/logout')
        .set('Cookie', cookieHeader(cookie))
        .expect(204);
      // The browser is told to drop it as well as the server revoking it.
      expect(refreshCookie(out)).toBeTruthy();

      await request(server)
        .post('/auth/refresh')
        .set('Cookie', cookieHeader(cookie))
        .expect(401);
    });

    // Same 204 as a real token: distinguishing them would leak whether a token
    // is live. No Authorization header here either — the route stays @Public().
    it('returns 204 for an unknown refresh token (no enumeration signal)', async () => {
      await request(server)
        .post('/auth/logout')
        .send({ refreshToken: 'this-token-was-never-issued' })
        .expect(204);
    });
  });

  describe('POST /auth/forgot-password', () => {
    beforeEach(() => mailMock.sendPasswordReset.mockReset());

    it('returns 200 with the same generic message whether the email exists or not', async () => {
      const { email } = await seedUser();
      const known = await request(server)
        .post('/auth/forgot-password')
        .send({ email })
        .expect(200);
      const unknown = await request(server)
        .post('/auth/forgot-password')
        .send({ email: 'nobody@nowhere.local' })
        .expect(200);
      expect(known.body).toEqual(unknown.body);
      expect(known.body.message).toMatch(/instructions/i);
    });

    it('rejects malformed payloads with 400', async () => {
      await request(server).post('/auth/forgot-password').send({}).expect(400);
      await request(server).post('/auth/forgot-password').send({ email: 'not-an-email' }).expect(400);
    });
  });

  describe('POST /auth/reset-password', () => {
    beforeEach(() => mailMock.sendPasswordReset.mockReset());

    it('204s on a valid token and rejects on a bogus one', async () => {
      const { email } = await seedUser();
      await request(server).post('/auth/forgot-password').send({ email }).expect(200);
      const arg = mailMock.sendPasswordReset.mock.calls.at(-1)?.[0] as { resetUrl: string };
      const rawToken = arg.resetUrl.split('/').pop() as string;

      await request(server)
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'NewlyChosenP@ss1' })
        .expect(204);

      // New password works.
      await request(server)
        .post('/auth/login')
        .send({ email, password: 'NewlyChosenP@ss1' })
        .expect(200);

      // Replaying the same token now fails.
      await request(server)
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'NewlyChosenP@ss1' })
        .expect(400);
    });

    it('rejects malformed payloads with 400', async () => {
      await request(server).post('/auth/reset-password').send({}).expect(400);
      await request(server)
        .post('/auth/reset-password')
        .send({ token: 'short', newPassword: 'x' })
        .expect(400);
    });
  });
});
