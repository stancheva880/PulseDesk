import { describe, it, expect } from 'vitest';
import { looksLikePlaceholder, shouldSeedDemoData } from './credential-guards';

// Shared by the production boot guard (app-setup.ts) and the seed (prisma/seed.ts).
// The seed runs under ts-node without tsconfig-paths, so this module must stay
// dependency-free and be imported by relative path.
describe('looksLikePlaceholder', () => {
  it('treats an unset value as a placeholder', () => {
    expect(looksLikePlaceholder(undefined)).toBe(true);
    expect(looksLikePlaceholder('')).toBe(true);
  });

  it('rejects the exact placeholder shipped in .env.example', () => {
    // backend/.env.example:29 — SUPERADMIN_PASSWORD=REPLACE_BEFORE_DEPLOY
    expect(looksLikePlaceholder('REPLACE_BEFORE_DEPLOY')).toBe(true);
    // and the JWT one it was already catching
    expect(looksLikePlaceholder('REPLACE_WITH_OPENSSL_RAND_BASE64_32')).toBe(true);
  });

  it('rejects the dev- and change-me prefixes, case-insensitively', () => {
    expect(looksLikePlaceholder('dev-access-secret')).toBe(true);
    expect(looksLikePlaceholder('DEV-ACCESS-SECRET')).toBe(true);
    expect(looksLikePlaceholder('change-me-please')).toBe(true);
    expect(looksLikePlaceholder('Change-Me')).toBe(true);
  });

  it('accepts a real-looking value', () => {
    expect(looksLikePlaceholder('p8a7s9d8a7sd987asd9Qk3vB6nX1zL4tR7wY0mC2jH5f')).toBe(false);
    expect(looksLikePlaceholder('Tr0ub4dor&3-horse-battery')).toBe(false);
  });

  it('only matches the prefixes at the start, not anywhere in the value', () => {
    // A strong value that merely contains "dev-" must not be rejected.
    expect(looksLikePlaceholder('x7Kp2mQ9dev-vR4tY8wZ1nB5cF6hJ3lD0sA2')).toBe(false);
  });
});

// TKT-0033 — the demo tenant/admin/teacher carry passwords hardcoded in seed.ts.
// RUN_SEED defaults to false and is set only in docker-compose.override.yml, so today
// they are fenced by configuration rather than by code. This predicate is the code fence.
// It lives here rather than in seed.ts because seed.ts calls main() at module load, so a
// spec importing it would run the real seed against the dev database.
describe('shouldSeedDemoData', () => {
  it('refuses to seed demo accounts in production', () => {
    expect(shouldSeedDemoData('production')).toBe(false);
  });

  it('is case-insensitive, so PRODUCTION is still production', () => {
    expect(shouldSeedDemoData('PRODUCTION')).toBe(false);
    expect(shouldSeedDemoData('Production')).toBe(false);
  });

  it('seeds demo accounts everywhere else, including an unset NODE_ENV', () => {
    expect(shouldSeedDemoData('development')).toBe(true);
    expect(shouldSeedDemoData('test')).toBe(true);
    expect(shouldSeedDemoData(undefined)).toBe(true);
    expect(shouldSeedDemoData('')).toBe(true);
  });
});
