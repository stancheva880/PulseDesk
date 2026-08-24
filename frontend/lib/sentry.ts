// A Sentry DSN is `http(s)://<publicKey>@<host>/<projectId>`. Same semantics as
// backend/src/common/sentry-dsn.ts — duplicated because the workspaces share no package.
// A malformed value parses to null and Sentry stays disabled: NEXT_PUBLIC_* is baked at
// build time, so the frontend cannot fail boot on it the way the backend does (TKT-0098).
export function parseSentryDsn(raw: string | undefined): string | null {
  const dsn = raw?.trim();
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    if (!/^https?:$/.test(url.protocol) || !url.username || url.pathname.length < 2) {
      return null;
    }
    return dsn;
  } catch {
    return null;
  }
}

// The one origin the CSP's connect-src must allow (RES-0005 finding 11).
export function sentryIngestOrigin(dsn: string | null): string | null {
  return dsn ? new URL(dsn).origin : null;
}

// The literal `process.env.NEXT_PUBLIC_SENTRY_DSN` expression is what Next inlines into
// client bundles at build time — do not read it via a dynamic key.
export const SENTRY_DSN = parseSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
