/**
 * Sentry bootstrap. Must be the first import of both entry points (src/main.ts and
 * api/[[...path]].ts) — the SDK has to load before Nest does (TKT-0097 / RES-0005).
 *
 * The DSN is the whole switch: unset or empty means Sentry never initializes and the
 * app behaves exactly as before. A set-but-malformed DSN only warns here; production
 * refuses to boot on it in assertProductionSecrets (app-setup.ts), which both entry
 * points run.
 */
import * as Sentry from '@sentry/nestjs';
import { parseSentryDsn } from './common/sentry-dsn';

const raw = process.env.SENTRY_DSN;
const dsn = parseSentryDsn(raw);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Errors only — tracing is a PRD-0013 non-goal and the free-tier budget is errors.
    tracesSampleRate: 0,
  });
} else if (raw?.trim()) {
  console.warn('SENTRY_DSN is set but not a valid Sentry DSN; error tracking is disabled.');
}
