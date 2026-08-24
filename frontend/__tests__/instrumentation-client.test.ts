import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// instrumentation-client.ts is a side-effect module gated on NEXT_PUBLIC_SENTRY_DSN:
// each case resets the module registry and re-imports with a different env value.
vi.mock('@sentry/nextjs', () => ({ init: vi.fn() }));

let savedDsn: string | undefined;

async function importClientInstrumentation(): Promise<{ init: ReturnType<typeof vi.fn> }> {
  vi.resetModules();
  const sentry = await import('@sentry/nextjs');
  (sentry.init as ReturnType<typeof vi.fn>).mockClear();
  await import('../instrumentation-client');
  return { init: sentry.init as ReturnType<typeof vi.fn> };
}

describe('instrumentation-client', () => {
  beforeEach(() => {
    savedDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  afterEach(() => {
    if (savedDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = savedDsn;
  });

  it('initializes Sentry with the DSN and tracing off when the DSN is set', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc123@o12345.ingest.de.sentry.io/67890';
    const { init } = await importClientInstrumentation();
    expect(init).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        dsn: 'https://abc123@o12345.ingest.de.sentry.io/67890',
        tracesSampleRate: 0,
      }),
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['malformed', 'foo'],
  ])('never calls Sentry.init when NEXT_PUBLIC_SENTRY_DSN is %s', async (_label, value) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = value;
    const { init } = await importClientInstrumentation();
    expect(init).not.toHaveBeenCalled();
  });
});
