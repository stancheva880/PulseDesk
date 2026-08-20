import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HealthController } from './health/health.controller';
import { assertProductionSecrets, configureApp } from './app-setup';
import { FakeConfigService } from './test-utils/fake-config';

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

describe('configureApp — the API reference at /api/docs', () => {
  // Swagger serves its UI straight on the express adapter, so no guard, pipe or filter runs in
  // front of it. NODE_ENV is therefore the only thing keeping it off a production deployment.
  it('serves the interactive docs outside production', async () => {
    const app = await buildApp({ NODE_ENV: 'development' });
    try {
      const res = await request(app.getHttpServer()).get('/api/docs');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    } finally {
      await app.close();
    }
  });

  it('serves nothing at that path in production', async () => {
    const app = await buildApp({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'x'.repeat(44),
    });
    try {
      await request(app.getHttpServer()).get('/api/docs').expect(404);
      await request(app.getHttpServer()).get('/api/docs-json').expect(404);
    } finally {
      await app.close();
    }
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

  // TKT-0029 (approved TEST CHANGE REQUEST, 2026-08-16): fixture lengthened from
  // 19 to 44 chars because production now enforces a 32-char minimum. The asserted
  // intent — a real-looking, non-placeholder secret boots — is unchanged.
  it('accepts a non-placeholder secret in production', () => {
    expect(() =>
      call({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'p8a7s9d8a7sd987asd9Qk3vB6nX1zL4tR7wY0mC2jH5f',
      }),
    ).not.toThrow();
  });

  it('throws in production when JWT_ACCESS_SECRET is shorter than 32 characters', () => {
    // 31 chars, matches no placeholder prefix — only the length rule can reject it.
    expect(() =>
      call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x7Kp2mQ9vR4tY8wZ1nB5cF6hJ3lD0sA' }),
    ).toThrow(/32 characters/);
  });

  it('accepts a secret of exactly 32 characters in production', () => {
    const exactly32 = 'x7Kp2mQ9vR4tY8wZ1nB5cF6hJ3lD0sA2';
    expect(exactly32).toHaveLength(32);
    expect(() => call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: exactly32 })).not.toThrow();
  });

  it('still allows a short non-placeholder secret outside production', () => {
    expect(() => call({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'abc' })).not.toThrow();
  });

  // TKT-0033 — SmtpMailService only throws on the first send (smtp-mail.service.ts:22),
  // so a production deploy with no host boots healthy and fails at the first password
  // reset. Every case below supplies a valid secret, so only the mail rule can throw.
  describe('mail transport', () => {
    const GOOD_SECRET = 'p8a7s9d8a7sd987asd9Qk3vB6nX1zL4tR7wY0mC2jH5f';

    it('throws in production when MAIL_TRANSPORT=smtp and SMTP_HOST is unset', () => {
      expect(() =>
        call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: GOOD_SECRET, MAIL_TRANSPORT: 'smtp' }),
      ).toThrow(/SMTP_HOST/);
    });

    // Approved TEST CHANGE REQUEST, 2026-08-19: MAIL_FROM added to the fixture because a
    // production SMTP config now needs a deliverable from-address as well as a host. The
    // asserted intent — a complete production SMTP config boots — is unchanged.
    it('accepts MAIL_TRANSPORT=smtp in production when SMTP_HOST is set', () => {
      expect(() =>
        call({
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: GOOD_SECRET,
          MAIL_TRANSPORT: 'smtp',
          SMTP_HOST: 'smtp.example.com',
          MAIL_FROM: 'PulseDesk <noreply@pulsedesk.com>',
        }),
      ).not.toThrow();
    });

    // smtp-mail.service.ts:33 falls back to noreply@pulsedesk.local, and .local is
    // RFC 6762 special-use — the send reports success and the mail never arrives. Since
    // EPIC-0009 the invite mail is the only path to an account, so an undeliverable
    // from-address locks everybody out while the deploy looks healthy.
    it('throws in production when MAIL_TRANSPORT=smtp and MAIL_FROM is unset', () => {
      expect(() =>
        call({
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: GOOD_SECRET,
          MAIL_TRANSPORT: 'smtp',
          SMTP_HOST: 'smtp.example.com',
        }),
      ).toThrow(/MAIL_FROM/);
    });

    it.each([
      'noreply@pulsedesk.local',
      'PulseDesk <noreply@pulsedesk.local>',
      'noreply@pulsedesk.localhost',
      'noreply@pulsedesk.invalid',
      'noreply@pulsedesk.test',
      'noreply@pulsedesk.example',
      'REPLACE_WITH_MAIL_FROM',
    ])('throws in production when MAIL_FROM is %s', (mailFrom) => {
      expect(() =>
        call({
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: GOOD_SECRET,
          MAIL_TRANSPORT: 'smtp',
          SMTP_HOST: 'smtp.example.com',
          MAIL_FROM: mailFrom,
        }),
      ).toThrow(/MAIL_FROM/);
    });

    it('accepts a deliverable MAIL_FROM, bare or with a display name', () => {
      for (const mailFrom of ['noreply@pulsedesk.com', 'PulseDesk <noreply@pulsedesk.bg>']) {
        expect(() =>
          call({
            NODE_ENV: 'production',
            JWT_ACCESS_SECRET: GOOD_SECRET,
            MAIL_TRANSPORT: 'smtp',
            SMTP_HOST: 'smtp.example.com',
            MAIL_FROM: mailFrom,
          }),
        ).not.toThrow();
      }
    });

    it('does not require SMTP_HOST for the console transport', () => {
      expect(() =>
        call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: GOOD_SECRET, MAIL_TRANSPORT: 'console' }),
      ).not.toThrow();
      // ...nor when MAIL_TRANSPORT is unset entirely.
      expect(() =>
        call({ NODE_ENV: 'production', JWT_ACCESS_SECRET: GOOD_SECRET }),
      ).not.toThrow();
    });

    it('does not enforce the mail rule outside production', () => {
      expect(() =>
        call({ NODE_ENV: 'development', MAIL_TRANSPORT: 'smtp' }),
      ).not.toThrow();
    });
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

// Behind a TLS-terminating proxy every request reports the proxy's address, so the
// throttler buckets the whole internet together — the 3/min forgot-password limit
// becomes a global 3/min. Express only reads X-Forwarded-For once `trust proxy` is
// set, and the value has to be a hop count: `true` would let a client forge the
// header and mint a fresh bucket per request, removing throttling altogether. So a
// set-but-unusable value fails the boot instead of being silently ignored.
describe('configureApp — trust proxy', () => {
  function trustProxySetting(app: INestApplication): unknown {
    return (app as NestExpressApplication).getHttpAdapter().getInstance().get('trust proxy');
  }

  it('leaves the express default alone when TRUST_PROXY_HOPS is unset', async () => {
    const app = await buildApp();
    try {
      expect(trustProxySetting(app)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('treats an empty TRUST_PROXY_HOPS as unset', async () => {
    const app = await buildApp({ TRUST_PROXY_HOPS: '' });
    try {
      expect(trustProxySetting(app)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('trusts exactly the configured number of proxy hops', async () => {
    const app = await buildApp({ TRUST_PROXY_HOPS: '2' });
    try {
      expect(trustProxySetting(app)).toBe(2);
    } finally {
      await app.close();
    }
  });

  it.each(['true', '0', '-1', '1.5', 'loopback', '10.0.0.0/8'])(
    'refuses to boot on TRUST_PROXY_HOPS=%s, which is not a positive integer',
    async (value) => {
      await expect(buildApp({ TRUST_PROXY_HOPS: value })).rejects.toThrow(/TRUST_PROXY_HOPS/);
    },
  );
});
