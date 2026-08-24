import { describe, expect, it } from 'vitest';
import { parseSentryDsn, sentryIngestOrigin } from '@/lib/sentry';

describe('parseSentryDsn', () => {
  it('returns the DSN for a valid https DSN', () => {
    const dsn = 'https://abc123@o12345.ingest.de.sentry.io/67890';
    expect(parseSentryDsn(dsn)).toBe(dsn);
  });

  it('trims surrounding whitespace', () => {
    expect(parseSentryDsn('  https://key@host.example.io/1  ')).toBe(
      'https://key@host.example.io/1',
    );
  });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['not a URL', 'foo'],
    ['no public key', 'https://o12345.ingest.sentry.io/67890'],
    ['no project id path', 'https://abc123@o12345.ingest.sentry.io/'],
    ['wrong protocol', 'ftp://abc123@o12345.ingest.sentry.io/67890'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseSentryDsn(raw)).toBeNull();
  });
});

describe('sentryIngestOrigin', () => {
  it('derives the origin CSP needs from the DSN', () => {
    expect(sentryIngestOrigin('https://abc123@o12345.ingest.de.sentry.io/67890')).toBe(
      'https://o12345.ingest.de.sentry.io',
    );
  });

  it('returns null for a null DSN', () => {
    expect(sentryIngestOrigin(null)).toBeNull();
  });
});
