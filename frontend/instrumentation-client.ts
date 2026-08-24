// Browser-side Sentry bootstrap — Next loads this on the client automatically.
// Gated on NEXT_PUBLIC_SENTRY_DSN: without a DSN (or with a malformed one, which parses
// to null) Sentry.init never runs and the browser makes zero Sentry requests (TKT-0098).
// The initialized SDK's global handlers capture uncaught exceptions and unhandled
// promise rejections; render crashes are captured by app/global-error.tsx.
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN } from '@/lib/sentry';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Errors only — tracing, Replay and tunnelRoute are PRD-0013 non-goals.
    tracesSampleRate: 0,
  });
}
