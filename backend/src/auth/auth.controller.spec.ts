import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const TEST_PASSWORD = 'TestPass123!';

describe('AuthController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const mailMock = {
    send: vi.fn(),
    sendInvite: vi.fn(),
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
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await auth.hashPassword(TEST_PASSWORD),
        role: UserRole.ADMIN,
        tenantId: tenant.id,
      },
    });
    userIds.push(user.id);
    return { email };
  }

  describe('POST /auth/login', () => {
    it('returns access + refresh tokens on valid credentials', async () => {
      const { email } = await seedUser();
      const res = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.accessExpiresIn).toBeGreaterThan(0);
      expect(res.body.refreshExpiresIn).toBeGreaterThan(res.body.accessExpiresIn);
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
    it('rotates the refresh token and returns a new pair', async () => {
      const { email } = await seedUser();
      const login = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const res = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.refreshToken).not.toBe(login.body.refreshToken);
    });

    it('returns 401 for an unknown refresh token', async () => {
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: 'not-real' })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token (returns 204) and subsequent refresh fails', async () => {
      const { email } = await seedUser();
      const login = await request(server)
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      await request(server)
        .post('/auth/logout')
        .send({ refreshToken: login.body.refreshToken })
        .expect(204);
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
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
