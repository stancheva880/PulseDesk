'use client';

// Replaces the root layout when rendering crashes, so it must carry its own <html>/<body>
// and cannot rely on globals.css or the i18n provider — static Bulgarian-first text and
// inline styles only (PRD-0013). Always present; the Sentry capture inside is a no-op
// when no DSN configured the SDK (instrumentation-client.ts), so the DSN-less behaviour
// change is exactly this fallback screen and nothing else.
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="bg">
      <body
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#fff',
          color: '#111',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Нещо се обърка</h1>
          <p style={{ marginBottom: '1.5rem', color: '#555' }}>Something went wrong.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem',
              fontSize: '1rem',
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: '0.375rem',
              background: '#f5f5f5',
            }}
          >
            Презареди
          </button>
        </div>
      </body>
    </html>
  );
}
