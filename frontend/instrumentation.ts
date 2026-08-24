// Server/edge-side Sentry bootstrap — Next calls register() once per runtime, and routes
// server-side render/request errors through onRequestError. Same DSN gate as the client
// bootstrap: no DSN, no init, and captureRequestError is a no-op without a client (TKT-0098).
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN } from '@/lib/sentry';

export function register(): void {
  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
