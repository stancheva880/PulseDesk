import { describe, expect, it } from 'vitest';
import { prismaOptions } from './prisma-options';

describe('prismaOptions', () => {
  it('returns no adapter when TURSO_DATABASE_URL is absent, so DATABASE_URL is used', () => {
    expect(prismaOptions({})).toEqual({});
  });

  // Vercel and docker-compose both hand over variables that are present but empty. An empty URL
  // must read as "not configured", or the adapter is built around nothing and fails on first query.
  it('treats an empty or blank TURSO_DATABASE_URL as absent', () => {
    expect(prismaOptions({ TURSO_DATABASE_URL: '' })).toEqual({});
    expect(prismaOptions({ TURSO_DATABASE_URL: '   ' })).toEqual({});
  });

  it('builds a libSQL adapter when both Turso variables are set', () => {
    const options = prismaOptions({
      TURSO_DATABASE_URL: 'libsql://pulsedesk.turso.io',
      TURSO_AUTH_TOKEN: 'token',
    });
    expect(options.adapter).toBeDefined();
  });

  // Same fail-fast posture as app-setup.ts's JWT secret guard: a half-configured database is worth
  // a refused boot, not a confusing 500 on the first request that touches it.
  it('fails fast when the URL is set without a token', () => {
    expect(() => prismaOptions({ TURSO_DATABASE_URL: 'libsql://pulsedesk.turso.io' })).toThrow(
      /TURSO_AUTH_TOKEN/,
    );
  });
});
