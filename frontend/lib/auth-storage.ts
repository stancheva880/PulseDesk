// Token storage + lightweight JWT inspection.
//
// TKT-0036: neither token is in localStorage any more. The refresh token is an httpOnly
// cookie the backend sets, so no script can read it; the access token lives in this
// module's memory and dies with the page. A reload recovers the session by calling
// /auth/refresh, which the cookie authorises.
//
// We don't *trust* the decoded payload for authorization — the backend re-verifies
// every request — but reading it client-side avoids a round-trip just to render the
// current user's name / role in the UI shell.

import type { components } from './api-schema';
import { writeTenantContext } from './tenant-context';

const MEMBERSHIPS_KEY = 'pulsedesk.memberships';

// Memory only. Deliberately not sessionStorage: that would be readable by an injected
// script again, which is the whole thing this change removes.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearStoredTokens(): void {
  accessToken = null;
  // TKT-0056: the active club used to outlive the session, so after a database reset the next
  // sign-in attached a club id the server had never issued and every screen answered
  // `Tenant <id> not found`. Cleared through writeTenantContext so the storage key stays owned by
  // tenant-context.ts and same-tab subscribers are notified. Every caller of this function goes
  // anonymous immediately after; keep it that way, or effectiveUser starts reporting a role from
  // the raw JWT claim instead of the active membership.
  writeTenantContext(null);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(MEMBERSHIPS_KEY);
  } catch {
    /* ignore */
  }
}

// Declared once in schema.prisma and reaching us through the generated memberships contract.
export type UserRole = components['schemas']['LoginMembershipList'][number]['role'];

export interface DecodedAccessToken {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  exp: number;
}

export function decodeAccessToken(token: string): DecodedAccessToken | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as DecodedAccessToken;
  } catch {
    return null;
  }
}

// One entry per tenant the account belongs to (login response). Persisted so the
// header switcher and effective-role derivation survive reloads.
// ponytail: snapshot from the last login — goes stale if memberships change
// server-side; safe (backend 403s revoked ones), add a refetch when the UX hurts.
export type LoginMembership = components['schemas']['LoginMembershipList'][number];

export function readStoredMemberships(): LoginMembership[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage?.getItem(MEMBERSHIPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LoginMembership[]) : [];
  } catch {
    return [];
  }
}

export function writeStoredMemberships(memberships: LoginMembership[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(MEMBERSHIPS_KEY, JSON.stringify(memberships));
  } catch {
    /* ignore */
  }
}

// Post-login/switch landing route per role.
export const landingRoute = (role: UserRole): string =>
  role === 'CUSTOMER' ? '/portal/schedule' : '/dashboard';

// Write actions (create/update/delete/generate) across the dashboard are ADMIN-only on the backend
// (SUPER_ADMIN bypasses every @Roles check). EMPLOYEE/CUSTOMER are read-or-scoped. Use this to hide
// controls a non-manager can't use — the backend remains the real enforcement.
export const isManager = (role?: UserRole | null): boolean =>
  role === 'ADMIN' || role === 'SUPER_ADMIN';
