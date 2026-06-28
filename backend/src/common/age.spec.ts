import { describe, expect, it } from 'vitest';
import { calculateAge } from './age';

describe('calculateAge', () => {
  it('returns 18 the day someone turns 18 (boundary — not under 18)', () => {
    expect(calculateAge(new Date('2008-05-06'), new Date('2026-05-06'))).toBe(18);
  });

  it('returns 17 the day before someone turns 18', () => {
    expect(calculateAge(new Date('2008-05-06'), new Date('2026-05-05'))).toBe(17);
  });

  it('returns 17 when the birthday has not yet occurred this year', () => {
    expect(calculateAge(new Date('2008-12-31'), new Date('2026-05-06'))).toBe(17);
  });

  it('returns 18 when the birthday has already passed this year', () => {
    expect(calculateAge(new Date('2008-01-01'), new Date('2026-05-06'))).toBe(18);
  });

  it('returns 25 for a clearly adult date of birth', () => {
    expect(calculateAge(new Date('2001-01-01'), new Date('2026-05-06'))).toBe(25);
  });

  it('returns 0 for a baby born today', () => {
    expect(calculateAge(new Date('2026-05-06'), new Date('2026-05-06'))).toBe(0);
  });
});
