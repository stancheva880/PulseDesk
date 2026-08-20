import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT, parseAmount } from '@/lib/utils';

// One rule set for every money input in the fee screens. Before this the three of them disagreed:
// the create form demanded > 0, the fee-edit form accepted >= 0 (so an empty box saved a 0 fee),
// and nothing anywhere rejected 1.234 or a mistyped extra zero.
describe('parseAmount', () => {
  it('accepts a plain positive amount', () => {
    expect(parseAmount('100')).toBe(100);
    expect(parseAmount('0.01')).toBe(0.01);
    expect(parseAmount('12.50')).toBe(12.5);
  });

  it('trims surrounding whitespace', () => {
    expect(parseAmount('  42 ')).toBe(42);
  });

  it('rejects an empty or blank box rather than reading it as zero', () => {
    // Number('') is 0, which is how the fee-edit form used to save a zero amount.
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
  });

  it('rejects anything that is not a finite number', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12abc')).toBeNull();
    expect(parseAmount('Infinity')).toBeNull();
    expect(parseAmount('NaN')).toBeNull();
  });

  it('rejects zero and negatives', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('0.00')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
  });

  // 0.07 * 100 is 7.000000000000001, so an arithmetic decimal-place check rejects this.
  it('accepts two-decimal values that float arithmetic mangles', () => {
    expect(parseAmount('0.07')).toBe(0.07);
    expect(parseAmount('1.005')).toBeNull();
  });

  it('accepts a bare fraction and rejects a bare dot or exponent', () => {
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('.')).toBeNull();
    expect(parseAmount('1e3')).toBeNull();
    expect(parseAmount('+5')).toBeNull();
  });

  it('rejects more than two decimal places', () => {
    // Fee.amount is a Decimal and the DTOs cap it at two places, so a third would be
    // silently rounded somewhere below.
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('0.005')).toBeNull();
  });

  it('accepts the ceiling and rejects above it', () => {
    expect(parseAmount(String(MAX_AMOUNT))).toBe(MAX_AMOUNT);
    expect(parseAmount(String(MAX_AMOUNT + 1))).toBeNull();
  });
});
