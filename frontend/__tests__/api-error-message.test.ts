import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorMessage } from '@/lib/api';
import { initI18n } from '@/lib/i18n';

// Runs against the real bundle, not a stub: the point of the helper is that a code the
// backend sends resolves to a key that actually exists in locales/bg/common.json.
const t = initI18n().t;

function coded(code: string, params?: Record<string, unknown>): ApiError {
  return new ApiError(400, 'English fallback from the server', {
    statusCode: 400,
    message: 'English fallback from the server',
    code,
    params,
  });
}

describe('apiErrorMessage', () => {
  it('translates a known code and interpolates its params', () => {
    const message = apiErrorMessage(
      coded('FEE_PAYMENT_EXCEEDS_BALANCE', { amount: 10, balance: '5' }),
    );
    expect(message).not.toContain('English fallback');
    expect(message).toContain('10');
    expect(message).toContain('5');
  });

  // TKT-0124: reached only as `errors.${body.code}`, so i18n-keys.test.ts cannot see it — that
  // suite skips template-built keys by design. This is the only guard that the key exists.
  it('translates LOCATION_IN_USE and interpolates both counts', () => {
    const message = apiErrorMessage(coded('LOCATION_IN_USE', { sessions: 214, schedules: 6 }));
    expect(message).not.toContain('English fallback');
    expect(message).toContain('214');
    expect(message).toContain('6');
  });

  // TKT-0125: same reason as LOCATION_IN_USE above — template-built key, invisible to
  // i18n-keys.test.ts.
  it('translates LOCATION_INACTIVE', () => {
    const message = apiErrorMessage(coded('LOCATION_INACTIVE'));
    expect(message).not.toContain('English fallback');
  });

  it('falls back to the server message for a code the bundle does not know', () => {
    expect(apiErrorMessage(coded('SOME_CODE_ADDED_LATER'))).toBe(
      'English fallback from the server',
    );
  });

  it('uses the server message when the error carries no code', () => {
    const e = new ApiError(409, 'Already a member', { statusCode: 409, message: 'Already a member' });
    expect(apiErrorMessage(e)).toBe('Already a member');
  });

  it('uses the generic translated message for anything that is not an ApiError', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'))).toBe(t('common.errors.generic'));
    expect(apiErrorMessage(undefined)).toBe(t('common.errors.generic'));
  });
});
