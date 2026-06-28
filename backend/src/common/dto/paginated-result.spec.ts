import { describe, it, expect } from 'vitest';
import { buildPaginatedResult, normalizePagination } from './paginated-result';

describe('normalizePagination', () => {
  it('defaults to page 1 with pageSize 25 when no input is provided', () => {
    expect(normalizePagination(undefined)).toEqual({ page: 1, pageSize: 25, skip: 0, take: 25 });
  });

  it('clamps pageSize to a max of 100', () => {
    expect(normalizePagination({ pageSize: 5000 })).toMatchObject({ pageSize: 100, take: 100 });
  });

  it('floors page to 1 when given a value below 1', () => {
    expect(normalizePagination({ page: 0 })).toMatchObject({ page: 1, skip: 0 });
  });

  it('computes skip as (page - 1) * pageSize', () => {
    expect(normalizePagination({ page: 3, pageSize: 10 })).toMatchObject({ skip: 20, take: 10 });
  });
});

describe('buildPaginatedResult', () => {
  it('wraps items with totals and totalPages', () => {
    const result = buildPaginatedResult(
      [1, 2, 3],
      57,
      normalizePagination({ page: 2, pageSize: 25 }),
    );
    expect(result).toEqual({
      items: [1, 2, 3],
      page: 2,
      pageSize: 25,
      total: 57,
      totalPages: 3,
    });
  });

  it('returns totalPages=0 when total is 0', () => {
    const result = buildPaginatedResult([], 0, normalizePagination({ page: 1, pageSize: 25 }));
    expect(result.totalPages).toBe(0);
  });
});
