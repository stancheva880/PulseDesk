import type { CookieOptions } from 'express';

// The refresh token lives here instead of in a response body, so no script on the page
// can read it. An XSS can still act inside an open tab, but it cannot exfiltrate the
// long-lived credential and replay it elsewhere.
export const REFRESH_COOKIE = 'pulsedesk.rt';

// `path` scopes the cookie to the auth routes, so it is not attached to every API call.
// `sameSite: strict` is what keeps CSRF closed on these routes — it also requires that
// the frontend and the API share a registrable domain, or the cookie is never sent.
// `secure` is off outside production so plain-HTTP localhost works.
export function refreshCookieOptions(maxAgeMs: number, isProd: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: maxAgeMs,
  };
}

// Cleared with the same attributes it was set with — browsers match on name+path, so a
// mismatched path leaves the cookie in place.
export function clearRefreshCookieOptions(isProd: boolean): CookieOptions {
  const { maxAge: _maxAge, ...rest } = refreshCookieOptions(0, isProd);
  return rest;
}

// Parsed by hand rather than adding cookie-parser: one cookie, and the dependency would
// earn its keep only if something else needed it.
export function readRefreshCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    return decodeURIComponent(part.slice(eq + 1).trim()) || undefined;
  }
  return undefined;
}
