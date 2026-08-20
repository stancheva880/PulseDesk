import { Test } from '@nestjs/testing';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FakeConfigService } from '@/test-utils/fake-config';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';

class StubAuthService {
  validateUser(): unknown {
    return { id: 'u1' };
  }
  login(): unknown {
    return {
      accessToken: 'a',
      refreshToken: 'r',
    };
  }
  refresh(): unknown {
    return { accessToken: 'a', refreshToken: 'r' };
  }
  logout(): unknown {
    return undefined;
  }
  requestPasswordReset(): unknown {
    return undefined;
  }
  completePasswordReset(): unknown {
    return undefined;
  }
}

async function buildApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }])],
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useClass: StubAuthService },
      // The controller now sets the refresh cookie, which needs JWT_REFRESH_TTL and
      // NODE_ENV. Mechanical addition for a new constructor dependency — no assertion
      // in this file changes.
      { provide: ConfigService, useValue: new FakeConfigService({ JWT_REFRESH_TTL: '7d' }) },
      Reflector,
      { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
  }).compile();

  const app = module.createNestApplication();
  // Matches AppModule's APP_INTERCEPTOR so the throttled routes are enforced here too.
  app.useGlobalInterceptors(
    new ResponseSchemaInterceptor(app.get(Reflector), app.get(ConfigService)),
  );
  await app.init();
  return app;
}

describe('AuthController throttling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks the 6th login from the same IP within 1 minute', async () => {
    const server = app.getHttpServer();
    const responses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(server)
        .post('/auth/login')
        .send({ email: 'a@b.test', password: 'whatever' });
      responses.push(res.status);
    }
    // first 5 succeed (200), 6th and 7th are throttled (429)
    expect(responses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(responses[5]).toBe(429);
    expect(responses[6]).toBe(429);
  });

  it('blocks the 11th logout from the same IP within 1 minute', async () => {
    const server = app.getHttpServer();
    const responses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(server).post('/auth/logout').send({ refreshToken: 'r' });
      responses.push(res.status);
    }
    // first 10 succeed (204), 11th and 12th are throttled (429)
    expect(responses.slice(0, 10).every((s) => s === 204)).toBe(true);
    expect(responses[10]).toBe(429);
    expect(responses[11]).toBe(429);
  });

  it('blocks the 4th forgot-password from the same IP within 1 minute', async () => {
    const server = app.getHttpServer();
    const responses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/auth/forgot-password')
        .send({ email: 'a@b.test' });
      responses.push(res.status);
    }
    expect(responses.slice(0, 3).every((s) => s === 200)).toBe(true);
    expect(responses[3]).toBe(429);
    expect(responses[4]).toBe(429);
  });
});
