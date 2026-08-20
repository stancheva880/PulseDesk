'use client';

import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TablePagination, type PageInfo } from '@/components/table-pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Skeleton classes for the loading row (defaults to a text-width bar). */
  skeleton?: string;
  cellClassName?: string;
  /** Presence makes the header sortable (used by the fees page). */
  sortValue?: (row: T) => string | number;
}

export interface DataTableConfirm {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  busy: boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  /** null = loading (skeleton rows). */
  rows: T[] | null;
  rowKey: (row: T) => string;
  emptyText: ReactNode;
  /** Trailing actions cell; the page decides gating (role- or row-level). */
  actions?: (row: T) => ReactNode;
  sort?: { key: string; desc: boolean } | null;
  onSortToggle?: (key: string) => void;
  pageInfo?: PageInfo | null;
  onPageChange?: (page: number) => void;
  confirm?: DataTableConfirm;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyText,
  actions,
  sort,
  onSortToggle,
  pageInfo,
  onPageChange,
  confirm,
}: DataTableProps<T>) {
  const colCount = columns.length + (actions ? 1 : 0);

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'p-3 text-left font-medium text-muted-foreground',
                    col.sortValue && 'cursor-pointer select-none',
                  )}
                  onClick={col.sortValue && onSortToggle ? () => onSortToggle(col.key) : undefined}
                >
                  {col.header}
                  {sort?.key === col.key ? (sort.desc ? ' ▼' : ' ▲') : null}
                </th>
              ))}
              {actions ? <th className="w-1 p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t">
                  {columns.map((col) => (
                    <td key={col.key} className="p-3">
                      <Skeleton className={col.skeleton ?? 'h-4 w-24'} />
                    </td>
                  ))}
                  {actions ? <td className="p-3" /> : null}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-10 text-center text-sm text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className="border-t transition-colors hover:bg-muted/30">
                  {columns.map((col) => (
                    <td key={col.key} className={cn('p-3', col.cellClassName)}>
                      {col.cell(row)}
                    </td>
                  ))}
                  {actions ? (
                    <td className="whitespace-nowrap p-3 text-right">{actions(row)}</td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageInfo !== undefined && onPageChange ? (
        <TablePagination info={pageInfo} onPageChange={onPageChange} />
      ) : null}

      {confirm ? <ConfirmDialog {...confirm} /> : null}
    </>
  );
}
