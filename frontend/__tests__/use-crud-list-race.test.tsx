import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/components/i18n-provider';
import { useCrudList } from '@/lib/use-crud-list';

// TKT-0123: reload() applied whatever answer came back, with no check that it was still the
// answer to the current question. A slower earlier request therefore overwrote a newer one, so
// paging or typing quickly could leave the table showing the wrong page — and no error to explain
// it. Deferred promises make the out-of-order arrival deterministic instead of a flake.

interface Row {
  id: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const page = (items: Row[], p: number) => ({
  items,
  page: p,
  pageSize: 25,
  total: 50,
  totalPages: 2,
});

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

describe('useCrudList — out-of-order responses', () => {
  it('keeps the newest page when an older request answers last', async () => {
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    const calls: number[] = [];
    const resource = {
      list: ({ page: p }: { page: number }) => {
        calls.push(p);
        return p === 1 ? first.promise : second.promise;
      },
      remove: () => Promise.resolve(),
    };

    const { result } = renderHook(() => useCrudList<Row>(resource), { wrapper });
    await waitFor(() => expect(calls).toEqual([1]));

    // Move to page 2 before page 1 has answered.
    act(() => result.current.setPage(2));
    await waitFor(() => expect(calls).toEqual([1, 2]));

    // Page 2 lands first, then the stale page 1.
    await act(async () => {
      second.resolve(page([{ id: 'p2' }], 2));
    });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'p2' }]));

    await act(async () => {
      first.resolve(page([{ id: 'p1' }], 1));
    });

    // The stale answer must not win.
    expect(result.current.rows).toEqual([{ id: 'p2' }]);
    expect(result.current.pageInfo?.page).toBe(2);
  });

  it('still surfaces an error from the newest request', async () => {
    const resource = {
      list: () => Promise.reject(new Error('boom')),
      remove: () => Promise.resolve(),
    };
    const { result } = renderHook(() => useCrudList<Row>(resource), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
