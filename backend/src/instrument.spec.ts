import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// instrument.ts is a side-effect module: importing it decides, once, whether Sentry
// starts. Each case therefore resets the module registry and re-imports.
vi.mock('@sentry/nestjs', () => ({ init: vi.fn() }));

let savedDsn: string | undefined;
let savedNodeEnv: string | undefined;

async function importInstrument(): Promise<{ init: ReturnType<typeof vi.fn> }> {
  vi.resetModules();
  const sentry = await import('@sentry/nestjs');
  (sentry.init as ReturnType<typeof vi.fn>).mockClear();
  await import('./instrument');
  return { init: sentry.init as ReturnType<typeof vi.fn> };
}

describe('instrument', () => {
  beforeEach(() => {
    savedDsn = process.env.SENTRY_DSN;
    savedNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (savedDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = savedDsn;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    vi.restoreAllMocks();
  });

  it('initializes Sentry with the DSN, the NODE_ENV environment, and tracing off', async () => {
    process.env.SENTRY_DSN = 'https://abc123@o12345.ingest.de.sentry.io/67890';
    process.env.NODE_ENV = 'production';
    const { init } = await importInstrument();
    expect(init).toHaveBeenCalledExactlyOnceWith({
      dsn: 'https://abc123@o12345.ingest.de.sentry.io/67890',
      environment: 'production',
      tracesSampleRate: 0,
    });
  });

  it('defaults the environment to development when NODE_ENV is unset', async () => {
    process.env.SENTRY_DSN = 'https://abc123@o12345.ingest.de.sentry.io/67890';
    delete process.env.NODE_ENV;
    const { init } = await importInstrument();
    expect(init).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ environment: 'development' }),
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('never calls Sentry.init when SENTRY_DSN is %s', async (_label, value) => {
    if (value === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = value;
    const { init } = await importInstrument();
    expect(init).not.toHaveBeenCalled();
  });

  it('warns and stays disabled on a malformed DSN (production fail-fast lives in app-setup)', async () => {
    process.env.SENTRY_DSN = 'foo';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { init } = await importInstrument();
    expect(init).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SENTRY_DSN'));
  });
});
