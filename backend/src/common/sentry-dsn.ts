/**
 * A Sentry DSN is `http(s)://<publicKey>@<host>/<projectId>`. Validated here rather than
 * trusting `Sentry.init`, which swallows a malformed DSN silently — production must refuse
 * to boot instead (assertProductionSecrets), and instrument.ts must know not to init.
 */
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
