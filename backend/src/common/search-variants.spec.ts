import { describe, expect, it } from 'vitest';
import { searchVariants } from './search-variants';

// TKT-0078 / PRD-0011 §7. SQLite's LIKE folds case for ASCII only and its lower() does too, so
// there is no SQL-side way to match `иван` against `Иван` on this provider. The query is
// expanded instead, in application code, where JS knows about Cyrillic.
describe('searchVariants', () => {
  it('expands a lowercase Cyrillic query to the casings a name is likely stored in', () => {
    expect(searchVariants('георги').sort()).toEqual(['ГЕОРГИ', 'Георги', 'георги']);
  });

  it('expands an all-caps query the same way', () => {
    expect(searchVariants('ГЕОРГИ').sort()).toEqual(['ГЕОРГИ', 'Георги', 'георги']);
  });

  it('collapses to one variant when casing cannot vary', () => {
    expect(searchVariants('0888')).toEqual(['0888']);
  });

  it('trims surrounding whitespace', () => {
    expect(searchVariants('  иван  ')).toContain('Иван');
    expect(searchVariants('  иван  ').every((v) => v === v.trim())).toBe(true);
  });

  it('returns nothing for a blank query, so no clause is built', () => {
    expect(searchVariants('   ')).toEqual([]);
  });

  it('capitalizes only the first character, leaving the rest lowercase', () => {
    expect(searchVariants('иВАНов')).toContain('Иванов');
  });
});
