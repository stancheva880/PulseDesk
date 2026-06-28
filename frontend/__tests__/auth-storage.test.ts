import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredTokens,
  decodeAccessToken,
  isAccessTokenExpired,
  readStoredTokens,
  writeStoredTokens,
} from '@/lib/auth-storage';

// Build a fake JWT with a controlled payload — the signature is irrelevant for the
// client decoder, which only ever looks at the payload section.
function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

describe('auth-storage', () => {
  beforeEach(() => {
    clearStoredTokens();
  });

  it('round-trips tokens through localStorage', () => {
    writeStoredTokens({ accessToken: 'A', refreshToken: 'R' });
    expect(readStoredTokens()).toEqual({ accessToken: 'A', refreshToken: 'R' });
    clearStoredTokens();
    expect(readStoredTokens()).toBeNull();
  });

  it('returns null when only one token is stored (partial state)', () => {
    writeStoredTokens({ accessToken: 'A', refreshToken: 'R' });
    window.localStorage.removeItem('pulsedesk.refresh');
    expect(readStoredTokens()).toBeNull();
  });

  it('decodes a JWT payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = buildJwt({
      sub: 'u1',
      email: 'a@b.com',
      role: 'ADMIN',
      tenantId: 't1',
      exp,
    });
    expect(decodeAccessToken(token)).toEqual({
      sub: 'u1',
      email: 'a@b.com',
      role: 'ADMIN',
      tenantId: 't1',
      exp,
    });
  });

  it('returns null for malformed tokens', () => {
    expect(decodeAccessToken('not.a.jwt')).toBeNull();
    expect(decodeAccessToken('only-one-part')).toBeNull();
  });

  it('treats past-exp tokens as expired', () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(isAccessTokenExpired(buildJwt({ exp: past }))).toBe(true);
  });

  it('treats future-exp tokens as not expired', () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    expect(isAccessTokenExpired(buildJwt({ exp: future }))).toBe(false);
  });
});
