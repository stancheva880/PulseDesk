import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { assertProductionSecrets, configureApp } from './app-setup';

class FakeConfigService {
  private readonly values: Record<string, string>;
  constructor(values: Record<string, string> = {}) {
    this.values = values;
  }
  get<T>(key: string): T | undefined {
    return this.values[key] as unknown as T | undefined;
  }
}

async function buildApp(configValues: Record<string, string> = {}): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: ConfigService, useValue: new FakeConfigService(configValues) }],
  }).compile();

  const app = module.createNestApplication();
  configureApp(app, app.get(ConfigService));
  await app.init();
  return app;
}

describe('configureApp — security headers (helmet)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to deny clickjacking', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-frame-options']).toMatch(/SAMEORIGIN|DENY/i);
  });

  it('removes the default X-Powered-By header', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets a Referrer-Policy header', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['referrer-policy']).toBeDefined();
  });
});

describe('assertProductionSecrets', () => {
  function call(values: Record<string, string>): void {
    assertProductionSecrets(new FakeConfigService(values) as unknown as ConfigService);
  }

  it('is a no-op when NODE_ENV is not production', () => {
    expect(() => call({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'dev-secret' })).not.toThrow();
  });

  it('throws in production when JWT_ACCESS_SECRET is unset', () => {
    expect(() => call({ NODE_ENV: 'production' })).toThrow(/placeholder/);
  });

  it('throws in production when JWT_ACCESS_SECRET starts with REPLACE_', () => {
    expect(() =>
      call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'REPLACE_WITH_OPENSSL_RAND_BASE64_32' }),
    ).toThrow(/placeholder/);
  });

  it('throws in production when JWT_ACCESS_SECRET starts with dev-', () => {
    expect(() =>
      call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'dev-access-secret' }),
    ).toThrow(/placeholder/);
  });

  it('accepts a non-placeholder secret in production', () => {
    expect(() =>
      call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'p8a7s9d8a7sd987asd9' }),
    ).not.toThrow();
  });
});

describe('configureApp — CORS allowlist', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp({ CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://app.pulsedesk.test' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reflects an allowed origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not echo a disallowed origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('falls back to FRONTEND_URL when CORS_ALLOWED_ORIGINS is unset', async () => {
    const fallbackApp = await buildApp({ FRONTEND_URL: 'http://localhost:3000' });
    const res = await request(fallbackApp.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    await fallbackApp.close();
  });
});
