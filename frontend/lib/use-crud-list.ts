'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import type { PageInfo } from '@/components/table-pagination';

interface CrudResource<T> {
  list(params: { page: number } & Record<string, unknown>): Promise<{ items: T[] } & PageInfo>;
  remove(id: string): Promise<unknown>;
}

interface CrudListOptions<T> {
  /** Extra params spread into every list() call (e.g. fees filters). */
  params?: Record<string, unknown>;
  /** Extra reload dependencies beyond `page` (serialized — strings/numbers only). */
  deps?: unknown[];
  /**
   * TKT-0092: what the row is called in the delete confirmation toast ("Removed: {{name}}").
   * Lives here so the confirmation exists once, not in seven list pages.
   */
  deletedName?: (row: T) => string;
}

export function useCrudList<T extends { id: string }>(
  resource: CrudResource<T>,
  opts: CrudListOptions<T> = {},
) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<T[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  // TKT-0123: only the newest request may write. Paging or typing quickly used to leave whichever
  // response happened to land last on screen — usually the slower, older one — with nothing to
  // tell the user the table was a page behind. A counter rather than AbortController: the answer
  // is discarded, not cancelled, so `reload()` after a delete keeps working the same way.
  const requestId = useRef(0);

  const reload = () => {
    const id = ++requestId.current;
    resource
      .list({ page, ...opts.params })
      .then((r) => {
        if (id !== requestId.current) return;
        setRows(r.items);
        setPageInfo(r);
      })
      .catch((e: unknown) => {
        if (id !== requestId.current) return;
        setError(apiErrorMessage(e));
      });
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
      if (opts.deletedName) {
        showToast({
          text: t('common.deletedToast', { name: opts.deletedName(pendingDelete) }),
          variant: 'success',
        });
      }
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
