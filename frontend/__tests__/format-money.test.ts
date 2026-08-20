import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/lib/utils';

describe('formatMoney', () => {
  it('renders two decimals followed by the currency', () => {
    expect(formatMoney(12, 'лв.')).toBe('12.00 лв.');
    expect(formatMoney(12.5, 'лв.')).toBe('12.50 лв.');
  });

  it('rounds to two decimals like toFixed(2)', () => {
    expect(formatMoney(12.345, 'BGN')).toBe('12.35 BGN');
    expect(formatMoney(0, 'BGN')).toBe('0.00 BGN');
  });

  it('accepts numeric strings from the API', () => {
    expect(formatMoney('7.5', 'BGN')).toBe('7.50 BGN');
  });
});
