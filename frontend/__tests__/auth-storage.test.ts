import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredTokens,
  decodeAccessToken,
  getAccessToken,
  readStoredMemberships,
  setAccessToken,
  writeStoredMemberships,
} from '@/lib/auth-storage';
import { readTenantContext, writeTenantContext } from '@/lib/tenant-context';

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

  // TKT-0036 (approved TEST CHANGE REQUEST): tokens no longer live in localStorage.
  // The access token is held in memory and the refresh token is an httpOnly cookie the
  // client cannot read. Previously this asserted a localStorage round-trip of both.
  it('round-trips the access token in memory and clears it', () => {
    setAccessToken('A');
    expect(getAccessToken()).toBe('A');
    clearStoredTokens();
    expect(getAccessToken()).toBeNull();
  });

  // TKT-0056: the club context outlived the session, so a database reset left the next sign-in
  // sending a club id the server had never heard of — the reported `Tenant <id> not found`. Signing
  // out is the one moment we know the stored club is no longer ours to keep.
  it('clears the active club alongside the membership snapshot', () => {
    setAccessToken('A');
    writeStoredMemberships([{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]);
    writeTenantContext('t1');

    clearStoredTokens();

    expect(readTenantContext()).toBeNull();
    expect(readStoredMemberships()).toEqual([]);
  });

  // The new security property, and stronger than the assertion it replaces: nothing
  // token-shaped may reach localStorage at all.
  it('never writes a token to localStorage', () => {
    setAccessToken('A');
    const keys = Object.keys(window.localStorage);
    expect(keys).not.toContain('pulsedesk.access');
    expect(keys).not.toContain('pulsedesk.refresh');
    expect(window.localStorage.getItem('pulsedesk.refresh')).toBeNull();
  });

  // The "partial state" test that stood here was deleted under the same TCR: it covered
  // one of two localStorage keys going missing, and there is now a single in-memory
  // value, so the state it guarded is unreachable by construction.

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

  // Tests for isAccessTokenExpired deleted in TKT-0011 (PRD-0003): the function was
  // removed — expiry is handled reactively by the 401→refresh path in lib/api.ts.
});
