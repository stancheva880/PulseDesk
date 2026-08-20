'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, bootstrapSession, setOnAuthFailure } from '@/lib/api';
import type { components } from '@/lib/api-schema';
import {
  clearStoredTokens,
  decodeAccessToken,
  getAccessToken,
  landingRoute,
  readStoredMemberships,
  setAccessToken,
  writeStoredMemberships,
  type DecodedAccessToken,
  type LoginMembership,
  type UserRole,
} from '@/lib/auth-storage';
import {
  hardNavigate,
  readTenantContext,
  reloadApp,
  subscribeCrossTabTenantChange,
  subscribeTenantContext,
  writeTenantContext,
} from '@/lib/tenant-context';

export type { LoginMembership };

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (input: LoginInput) => Promise<LoginMembership[]>;
  logout: () => Promise<void>;
  /**
   * TKT-0057: the membership snapshot has been reconciled with the server, or the attempt finished
   * and failed. False only during the bootstrap window, which is the window in which a stored club
   * cannot yet be trusted. `login()` sets it at once — those memberships came from the login
   * response, so there is nothing to reconcile.
   */
  membershipsSettled: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromToken(decoded: DecodedAccessToken): AuthUser {
  return {
    id: decoded.sub,
    email: decoded.email,
    role: decoded.role,
    tenantId: decoded.tenantId,
  };
}

// The JWT claims carry the login-time (oldest) membership. The user acts in the
// ACTIVE tenant, so role/tenantId come from the membership matching the tenant
// context — route guards then enforce the per-tenant role. Falls back to the JWT
// claims when no memberships are stored (SUPER_ADMIN, pre-upgrade sessions).
function effectiveUser(decoded: DecodedAccessToken): AuthUser {
  const base = userFromToken(decoded);
  if (base.role === 'SUPER_ADMIN') return base;
  const active = readStoredMemberships().find((m) => m.tenantId === readTenantContext());
  return active ? { ...base, role: active.role, tenantId: active.tenantId } : base;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [membershipsSettled, setMembershipsSettled] = useState(false);

  // TKT-0006: refresh the membership snapshot so attach/remove show up without
  // re-login. Header-less — the stored context may point at the very tenant the
  // user was just removed from, which would 403 at the guard.
  const syncMemberships = useCallback(async (decoded: DecodedAccessToken) => {
    if (decoded.role === 'SUPER_ADMIN') return;
    let fresh: LoginMembership[];
    try {
      fresh = await apiRequest<LoginMembership[]>('/auth/memberships', {
        omitTenantHeader: true,
      });
    } catch {
      return; // offline / API error — keep the login-time snapshot
    }
    if (!Array.isArray(fresh)) return; // malformed response — keep the snapshot
    writeStoredMemberships(fresh);
    const active = readTenantContext();
    // TKT-0039: `!active` joins the stale-context case here rather than in a branch of its
    // own. Cleared storage loses the context AND the snapshot, so the layout gate has
    // nothing to recover from until this fetch returns — at which point the resolution is
    // identical to being removed from the active club: take the first membership, or leave
    // for /login when there is none.
    if (!active || !fresh.some((m) => m.tenantId === active)) {
      const next = fresh[0];
      if (next) {
        // Removed from the active club mid-use — move to the first remaining one.
        writeTenantContext(next.tenantId);
        hardNavigate(landingRoute(next.role));
      } else {
        // No memberships left — the account can't act anywhere; back to login.
        clearStoredTokens();
        hardNavigate('/login');
      }
      return;
    }
    // Same active tenant — re-derive in case its role changed.
    setUser(effectiveUser(decoded));
  }, []);

  // TKT-0036: the access token died with the previous page, so mount has to ask the
  // httpOnly refresh cookie whether a session exists. This replaces the synchronous
  // localStorage read — 'loading' now covers a real round-trip rather than a tick.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const token = await bootstrapSession();
      if (cancelled) return;
      const decoded = token ? decodeAccessToken(token) : null;
      if (!decoded) {
        // A token we cannot read is worthless, so drop it. When there was no token at all the
        // refresh has already decided: api.ts clears on a 401 (rejected cookie) and deliberately
        // keeps the club context and the membership snapshot when the refresh only failed
        // transiently, so a reload during a network blip does not cost the club selection.
        if (token) clearStoredTokens();
        setStatus('anonymous');
        // There is no snapshot to reconcile, so nothing is waiting on one.
        setMembershipsSettled(true);
        return;
      }
      setUser(effectiveUser(decoded));
      setStatus('authenticated');
      // syncMemberships resolves on every path, including the SUPER_ADMIN early return and its own
      // swallowed fetch errors, so `finally` is what guarantees the gate is never held for good.
      void syncMemberships(decoded).finally(() => {
        if (!cancelled) setMembershipsSettled(true);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [syncMemberships]);

  // Same-tab tenant switch (login picker, header switcher): re-derive role/tenantId
  // from the newly active membership so route guards react without a reload.
  useEffect(() => {
    return subscribeTenantContext(() => {
      setUser((prev) => {
        if (!prev) return prev;
        const token = getAccessToken();
        const decoded = token && decodeAccessToken(token);
        return decoded ? effectiveUser(decoded) : prev;
      });
    });
  }, []);

  // Cross-tab tenant switch: reload so this tab rebuilds against the new tenant and
  // can't keep writing to the previous one. Gated on authenticated — a login-page
  // tab must not lose typed input.
  useEffect(() => {
    if (status !== 'authenticated') return;
    return subscribeCrossTabTenantChange(reloadApp);
  }, [status]);

  // Wire up the api client → AuthProvider auth-failure channel.
  useEffect(() => {
    setOnAuthFailure(() => {
      clearStoredTokens();
      setUser(null);
      setStatus('anonymous');
    });
    return () => setOnAuthFailure(null);
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    // The refresh token comes back as a Set-Cookie, not in this body.
    const { memberships = [], accessToken } = await apiRequest<
      components['schemas']['LoginResponse']
    >('/auth/login', {
      method: 'POST',
      body: input,
      unauthenticated: true,
    });
    const decoded = decodeAccessToken(accessToken);
    if (!decoded) throw new Error('Login response did not contain a valid access token');
    setAccessToken(accessToken);
    writeStoredMemberships(memberships);
    // Straight from the login response, so already reconciled — nothing to wait for.
    setMembershipsSettled(true);
    setUser(effectiveUser(decoded));
    setStatus('authenticated');
    return memberships;
  }, []);

  const logout = useCallback(async () => {
    try {
      // No body — the cookie identifies the session, and the response clears it.
      await apiRequest<void>('/auth/logout', { method: 'POST', unauthenticated: true });
    } catch {
      // Logout is best-effort — we always clear local state.
    }
    clearStoredTokens();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, membershipsSettled }),
    [user, status, login, logout, membershipsSettled],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>');
  return ctx;
}
