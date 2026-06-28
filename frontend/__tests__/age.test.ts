import { describe, expect, it } from 'vitest';
import { calculateAge, isMinor } from '@/lib/age';

describe('calculateAge', () => {
  it('returns 18 on the 18th birthday — boundary', () => {
    expect(calculateAge(new Date('2008-05-06'), new Date('2026-05-06'))).toBe(18);
  });

  it('returns 17 the day before the 18th birthday', () => {
    expect(calculateAge(new Date('2008-05-06'), new Date('2026-05-05'))).toBe(17);
  });
});

describe('isMinor', () => {
  it('is true for under-18 DOB', () => {
    expect(isMinor('2015-01-01', new Date('2026-05-06'))).toBe(true);
  });

  it('is false for adult DOB', () => {
    expect(isMinor('2000-01-01', new Date('2026-05-06'))).toBe(false);
  });

  it('is false on the 18th birthday (boundary — not under 18)', () => {
    expect(isMinor('2008-05-06', new Date('2026-05-06'))).toBe(false);
  });

  it('is false for empty input', () => {
    expect(isMinor('')).toBe(false);
  });

  it('is false for invalid input', () => {
    expect(isMinor('not-a-date')).toBe(false);
  });
});
