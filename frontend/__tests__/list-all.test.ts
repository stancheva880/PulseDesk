import { describe, expect, it } from 'vitest';
import { listAll } from '@/lib/api-resources';

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// A stand-in for any paginated list endpoint, recording the params it was called with.
function fakeList(rows: string[], pageSize: number) {
  const calls: Array<{ page?: number; pageSize?: number }> = [];
  const list = (params: { page?: number; pageSize?: number }): Promise<Page<string>> => {
    calls.push(params);
    const page = params.page ?? 1;
    const start = (page - 1) * pageSize;
    return Promise.resolve({
      items: rows.slice(start, start + pageSize),
      page,
      pageSize,
      total: rows.length,
      totalPages: Math.ceil(rows.length / pageSize),
    });
  };
  return { list, calls };
}

describe('listAll', () => {
  // Callers use it to fill dropdowns and name lookups, where a silently truncated
  // result is indistinguishable from a complete one.
  it('requests every page and concatenates them', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => `tr${i + 1}`);
    const { list, calls } = fakeList(rows, 100);

    const all = await listAll(list);

    expect(all).toHaveLength(250);
    expect(all[0]).toBe('tr1');
    expect(all[249]).toBe('tr250');
    expect(calls.map((c) => c.page ?? 1)).toEqual([1, 2, 3]);
  });

  it('makes a single request when there is one page or none', async () => {
    const one = fakeList(['tr1', 'tr2'], 100);
    expect(await listAll(one.list)).toHaveLength(2);
    expect(one.calls).toHaveLength(1);

    const empty = fakeList([], 100);
    expect(await listAll(empty.list)).toHaveLength(0);
    expect(empty.calls).toHaveLength(1);
  });
});
