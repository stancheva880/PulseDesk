export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Defensive cap applied to every list endpoint so a single tenant cannot
 * issue an unbounded query. Until full pagination ships at the API+UI layer,
 * lists silently truncate at this value.
 */
export const DEFAULT_LIST_TAKE = MAX_PAGE_SIZE;

export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

export interface NormalizedPagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function normalizePagination(input: PaginationInput | undefined): NormalizedPagination {
  const page = Math.max(1, Math.floor(input?.page ?? 1));
  const requested = input?.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  pagination: NormalizedPagination,
): PaginatedResult<T> {
  const totalPages = pagination.pageSize === 0 ? 0 : Math.ceil(total / pagination.pageSize);
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages,
  };
}
