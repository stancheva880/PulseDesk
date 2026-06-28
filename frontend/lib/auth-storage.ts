// localStorage-backed token storage + lightweight JWT inspection.
// We don't *trust* the decoded payload for authorization — the backend re-verifies
// every request — but reading it client-side avoids a round-trip just to render the
// current user's name / role in the UI shell.

const ACCESS_KEY = 'pulsedesk.access';
const REFRESH_KEY = 'pulsedesk.refresh';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export function readStoredTokens(): StoredTokens | null {
  if (typeof window === 'undefined') return null;
  try {
    const accessToken = window.localStorage?.getItem(ACCESS_KEY);
    const refreshToken = window.localStorage?.getItem(REFRESH_KEY);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

export function writeStoredTokens(tokens: StoredTokens): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(ACCESS_KEY, tokens.accessToken);
    window.localStorage?.setItem(REFRESH_KEY, tokens.refreshToken);
  } catch {
    /* private mode etc. — ignore */
  }
}

export function clearStoredTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(ACCESS_KEY);
    window.localStorage?.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'CUSTOMER';

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

export function isAccessTokenExpired(token: string, now = Date.now()): boolean {
  const decoded = decodeAccessToken(token);
  if (!decoded) return true;
  // exp is in seconds.
  return decoded.exp * 1000 <= now;
}
