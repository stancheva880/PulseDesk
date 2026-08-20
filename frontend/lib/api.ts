import i18n from 'i18next';

import { clearStoredTokens, getAccessToken, setAccessToken } from './auth-storage';
import { readTenantContext } from './tenant-context';

const API_ROOT = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The one way to turn a caught error into text for the user.
//
// The backend answers in English. Where the message is one a user can act on, the throw site
// also sends a `code` and its `params` (backend/src/common/filters/all-exceptions.filter.ts),
// and that is what gets translated here. `defaultValue` keeps the English message for a code
// this bundle has no key for, so codes can be added a few at a time without blank messages.
//
// Reads the i18next singleton rather than taking a TFunction: the result is stored in state
// by every caller, so it never re-renders on a language switch either way, and a `t` in the
// closure would make each of ~30 effects declare a dependency it does not really have.
export function apiErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return i18n.t('common.errors.generic');
  const body = e.body as { code?: string; params?: Record<string, unknown> } | undefined;
  if (!body?.code) return e.message;
  return i18n.t(`errors.${body.code}`, { ...body.params, defaultValue: e.message });
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  // Skip the Bearer header (used for /auth/login, /auth/refresh).
  unauthenticated?: boolean;
  // Skip the X-Tenant-Id header (used for /auth/memberships — the stored context may
  // point at a tenant the caller was just removed from, which would 403 at the guard).
  omitTenantHeader?: boolean;
  // Internal — set on the retry after a successful refresh, so we don't loop.
  _isRetry?: boolean;
}

// Hooks the AuthProvider can install so an auth-failure during refresh propagates.
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    unauthenticated = false,
    omitTenantHeader = false,
    _isRetry = false,
  } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!unauthenticated) {
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // The active club. The backend honours this header for every role — a member's id is
    // checked against their memberships (403 otherwise) — so it is only safe to attach
    // unconditionally because the layout gate holds tenant-scoped requests back until the
    // stored club is confirmed (TKT-0057).
    const tenantId = readTenantContext();
    if (tenantId && !omitTenantHeader) headers['X-Tenant-Id'] = tenantId;
  }

  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  // 204 No Content (delete/logout)
  if (res.status === 204) return undefined as T;

  // 401 → try refresh once, then retry the original request once. On failure fall
  // through so the original 401 surfaces; performRefresh has already notified if the
  // refresh was rejected, and deliberately has not if it only failed transiently.
  if (res.status === 401 && !unauthenticated && !_isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiRequest<T>(path, { ...options, _isRetry: true });
  }

  const text = await res.text();
  const parsed = parseBody(text);

  if (!res.ok) {
    throw new ApiError(res.status, extractErrorMessage(parsed) ?? res.statusText, parsed);
  }

  return parsed as T;
}

// Concurrent 401s must share one refresh: the backend rotates and revokes the
// presented token, so parallel refreshes would make all but one fail.
let inFlightRefresh: Promise<boolean> | null = null;

// The in-flight promise is per-tab. Web Locks extends the same guarantee across
// tabs of the same origin, which share one refresh token via the httpOnly cookie.
// Unsupported browsers fall back to per-tab de-duplication — no worse than before.
const REFRESH_LOCK = 'pulsedesk.refresh';

async function withRefreshLock(fn: () => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return fn();
  // `await` also unwraps the nested promise the DOM typings produce for an async
  // callback (LockGrantedCallback<T> is declared as returning T, not PromiseLike<T>).
  return await locks.request(REFRESH_LOCK, fn);
}

function tryRefresh(): Promise<boolean> {
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

// Notifies on a rejected cookie exactly once per refresh — the callers awaiting a shared
// in-flight refresh must not each fire onAuthFailure. A transient failure notifies nobody.
function performRefresh(): Promise<boolean> {
  return withRefreshLock(refreshUnderLock);
}

// TKT-0036: the refresh token is an httpOnly cookie, so this sends no body and there is
// nothing to compare after acquiring the lock — the old post-lock re-read compared
// stored refresh tokens, which JS can no longer see. It is also no longer needed: the
// cookie jar is the shared cross-tab state localStorage used to be, and Set-Cookie
// updates it atomically, so a tab that loses the race presents the already-rotated
// cookie next time. That is a clean rotation, not a replay. The lock still stops two
// tabs sending at the same instant.
async function refreshUnderLock(): Promise<boolean> {
  try {
    const next = await apiRequest<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      unauthenticated: true,
    });
    if (!next?.accessToken) throw new Error('refresh returned no access token');
    setAccessToken(next.accessToken);
    return true;
  } catch (error) {
    // Only the server rejecting the cookie ends the session, and it says so with a 401 — every
    // refusal in auth.service.ts (invalid, expired, inactive user, revoked family) is an
    // UnauthorizedException. A network blip, a throttled answer (the shared 100 req/min limit
    // answers the refresh, not the credential), a 5xx, or a malformed body prove nothing about the
    // cookie, so the session stays and the caller's own 401 still surfaces. `inFlightRefresh`
    // clears on settle, so the next 401 retries and recovers on its own.
    if (error instanceof ApiError && error.status === 401) {
      clearStoredTokens();
      onAuthFailure?.();
    }
    return false;
  }
}

// Called on app start: the access token died with the previous page, so the only way to
// know whether a session exists is to ask the cookie to prove it.
//
// Returns an already-held token without a round-trip. That is not just an optimisation:
// reactStrictMode double-invokes effects in development, so an unconditional fetch here
// would rotate the refresh token twice on every page load.
//
// Goes through tryRefresh rather than its own fetch, so the cross-tab lock, the in-flight
// de-duplication and the clear-only-on-401 policy above are written once. Two consequences worth
// naming: two tabs reloading at the same instant no longer send two rotating refreshes, and a
// transient failure (offline, throttled, 5xx) returns null WITHOUT clearing stored state — this
// page load has no access token either way, but the cookie may still be good, so the club context
// and the membership snapshot survive the blip.
export async function bootstrapSession(): Promise<string | null> {
  const existing = getAccessToken();
  if (existing) return existing;
  return (await tryRefresh()) ? getAccessToken() : null;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m) && m.every((s) => typeof s === 'string')) return m.join('; ');
  }
  return undefined;
}
