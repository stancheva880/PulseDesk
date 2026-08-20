import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { MailModule } from '@/mail/mail.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { createTestUser } from '@/test-utils/create-user';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import type { AccessJwtPayload } from './types/jwt-payload';

const PASSWORD = 'TestPass123!';

// TKT-0027: the token layer's rejection paths, asserted end-to-end over HTTP.
// GET /auth/memberships is the target because it is JWT-protected but carries no
// @Roles and needs no X-Tenant-Id, so a 401 can only come from token verification.
describe('JWT hardening (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let jwt: JwtService;
  let secret: string;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let payload: AccessJwtPayload;
  let validToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        MailModule,
        AuthModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // AppModule registers this as an APP_INTERCEPTOR; this spec builds its own module graph,
    // so it wires the interceptor here too — without it these routes would be unenforced.
    app.useGlobalInterceptors(
      new ResponseSchemaInterceptor(app.get(Reflector), app.get(ConfigService)),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
    secret = moduleRef.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    server = app.getHttpServer();

    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'Test Tenant' },
    });
    tenantIds.push(tenant.id);
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@test.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.ADMIN,
      tenantId: tenant.id,
    });
    userIds.push(user.id);
    validToken = (await auth.login(user)).accessToken;
    payload = {
      sub: user.id,
      email: user.email,
      role: UserRole.ADMIN,
      tenantId: tenant.id,
      type: 'access',
    };
  });

  afterAll(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await app.close();
  });

  function get(token: string) {
    return request(server).get('/auth/memberships').set('Authorization', `Bearer ${token}`);
  }

  // Control: without this, every 401 below could be passing because the harness
  // never authenticates at all rather than because the token was rejected.
  it('accepts a well-formed access token', async () => {
    await get(validToken).expect(200);
  });

  it('rejects a token whose type claim is not access', async () => {
    const wrongType = await jwt.signAsync({ ...payload, type: 'refresh' }, { secret });
    await get(wrongType).expect(401);
  });

  it('rejects a token with no type claim', async () => {
    const { type: _omitted, ...withoutType } = payload;
    const noType = await jwt.signAsync(withoutType, { secret });
    await get(noType).expect(401);
  });

  it('issued tokens carry alg HS256', () => {
    const header = JSON.parse(
      Buffer.from(validToken.split('.')[0]!, 'base64url').toString('utf8'),
    ) as { alg: string };
    expect(header.alg).toBe('HS256');
  });

  it('rejects a token signed with HS384', async () => {
    // Correct secret, wrong algorithm — only the explicit pin rejects this.
    const hs384 = await jwt.signAsync(payload, { secret, algorithm: 'HS384' });
    await get(hs384).expect(401);
  });

  it('rejects an unsigned alg:none token', async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
    await get(none).expect(401);
  });

  it('rejects a token with a tampered signature', async () => {
    const [header, body, signature] = validToken.split('.');
    const flipped = signature!.slice(0, -1) + (signature!.endsWith('A') ? 'B' : 'A');
    await get(`${header}.${body}.${flipped}`).expect(401);
  });

  it('rejects an expired access token', async () => {
    const expired = await jwt.signAsync(payload, { secret, expiresIn: '-1s' });
    await get(expired).expect(401);
  });

  // TKT-0028 — issuer / audience claim contract.
  describe('issuer and audience', () => {
    it('issued tokens carry the issuer and audience claims', () => {
      const claims = JSON.parse(
        Buffer.from(validToken.split('.')[1]!, 'base64url').toString('utf8'),
      ) as { iss?: string; aud?: string };
      expect(claims.iss).toBe('pulsedesk');
      expect(claims.aud).toBe('pulsedesk-api');
    });

    it('rejects tokens with a wrong or missing issuer', async () => {
      const wrong = await jwt.signAsync(payload, {
        secret,
        algorithm: 'HS256',
        issuer: 'not-pulsedesk',
        audience: 'pulsedesk-api',
      });
      await get(wrong).expect(401);

      const missing = await jwt.signAsync(payload, {
        secret,
        algorithm: 'HS256',
        audience: 'pulsedesk-api',
      });
      await get(missing).expect(401);
    });

    it('rejects tokens with a wrong or missing audience', async () => {
      const wrong = await jwt.signAsync(payload, {
        secret,
        algorithm: 'HS256',
        issuer: 'pulsedesk',
        audience: 'some-other-api',
      });
      await get(wrong).expect(401);

      const missing = await jwt.signAsync(payload, {
        secret,
        algorithm: 'HS256',
        issuer: 'pulsedesk',
      });
      await get(missing).expect(401);
    });

    it('rejects a legacy token issued before the claim contract', async () => {
      // Correctly signed, correct type, right algorithm — only the absent
      // iss/aud make it invalid. This is what an in-flight token looks like
      // at deploy; the client recovers through the normal 401-refresh path.
      const legacy = await jwt.signAsync(payload, { secret, algorithm: 'HS256' });
      await get(legacy).expect(401);
    });

    it('refresh tokens remain opaque and claim-free', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
      const pair = await auth.login(user);
      expect(jwt.decode(pair.refreshToken)).toBeNull();
      expect(pair.refreshToken).not.toContain('.');
      // Rotation still works with the new claim contract in place.
      await expect(auth.refresh(pair.refreshToken)).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });
  });
});
