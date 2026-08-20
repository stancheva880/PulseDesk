'use client';

import { useEffect, useState } from 'react';
import { apiErrorMessage } from '@/lib/api';
import type { PageInfo } from '@/components/table-pagination';

interface CrudResource<T> {
  list(params: { page: number } & Record<string, unknown>): Promise<{ items: T[] } & PageInfo>;
  remove(id: string): Promise<unknown>;
}

interface CrudListOptions {
  /** Extra params spread into every list() call (e.g. fees filters). */
  params?: Record<string, unknown>;
  /** Extra reload dependencies beyond `page` (serialized — strings/numbers only). */
  deps?: unknown[];
}

export function useCrudList<T extends { id: string }>(
  resource: CrudResource<T>,
  opts: CrudListOptions = {},
) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    resource
      .list({ page, ...opts.params })
      .then((r) => {
        setRows(r.items);
        setPageInfo(r);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  };

  const depsKey = JSON.stringify(opts.deps ?? []);
  // reload reads opts.params from the closure; depsKey is the caller's declared trigger set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [page, depsKey]);

  const onDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await resource.remove(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setError(apiErrorMessage(e));
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return {
    rows,
    page,
    setPage,
    pageInfo,
    error,
    setError,
    reload,
    pendingDelete,
    setPendingDelete,
    busy,
    onDelete,
  };
}
