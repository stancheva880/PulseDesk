import {
  clearStoredTokens,
  readStoredTokens,
  writeStoredTokens,
  type StoredTokens,
} from './auth-storage';
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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  // Skip the Bearer header (used for /auth/login, /auth/refresh).
  unauthenticated?: boolean;
  // Internal — set on the retry after a successful refresh, so we don't loop.
  _isRetry?: boolean;
}

// Hooks the AuthProvider can install so an auth-failure during refresh propagates.
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, unauthenticated = false, _isRetry = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!unauthenticated) {
    const tokens = readStoredTokens();
    if (tokens) headers['Authorization'] = `Bearer ${tokens.accessToken}`;
    // SUPER_ADMIN tenant context. The backend ignores this header for tenant users,
    // so it's safe to attach unconditionally when set.
    const tenantId = readTenantContext();
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
  }

  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  // 204 No Content (delete/logout)
  if (res.status === 204) return undefined as T;

  // 401 → try refresh once, then retry the original request once.
  if (res.status === 401 && !unauthenticated && !_isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiRequest<T>(path, { ...options, _isRetry: true });
    // Refresh failed — surface the original 401 so the UI can redirect to /login.
    onAuthFailure?.();
  }

  const text = await res.text();
  const parsed = parseBody(text);

  if (!res.ok) {
    throw new ApiError(res.status, extractErrorMessage(parsed) ?? res.statusText, parsed);
  }

  return parsed as T;
}

async function tryRefresh(): Promise<boolean> {
  const tokens = readStoredTokens();
  if (!tokens) return false;
  try {
    const next = await apiRequest<StoredTokens>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: tokens.refreshToken },
      unauthenticated: true,
    });
    writeStoredTokens(next);
    return true;
  } catch {
    clearStoredTokens();
    return false;
  }
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
