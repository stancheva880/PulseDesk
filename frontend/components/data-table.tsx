'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TablePagination, type PageInfo } from '@/components/table-pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  key: string;
  /**
   * Plain text, not a node: below `md` it is also the cell's `data-label`, which the card-mode CSS
   * reads through `content: attr(data-label)` — and `attr()` can only read a string.
   */
  header: string;
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
  /**
   * TKT-0088: the row's primary destination — activating the row (click, or Enter on the
   * keyboard) navigates there. The controls in the actions cell always win over the row.
   * Undefined (the prop, or a per-row return) leaves that row inert, exactly as before.
   */
  rowHref?: (row: T) => string | undefined;
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
  rowHref,
  sort,
  onSortToggle,
  pageInfo,
  onPageChange,
  confirm,
}: DataTableProps<T>) {
  const router = useRouter();
  const colCount = columns.length + (actions ? 1 : 0);

  return (
    <>
      {/* `pd-card-table` is the hook for the below-`md` card layout in globals.css. Scoped to a
          class rather than written as bare element selectors for two reasons: Tailwind tree-shakes
          @layer components against the content globs, and card mode has to be opt-in so it cannot
          reach the sr-only backing table in fees-chart.tsx. */}
      <div className="pd-card-table overflow-hidden rounded-lg border bg-card">
        {/* The roles below are implicit in a normal table and declared anyway: card mode changes
            `display` on these elements, which drops the implicit table semantics in some browsers. */}
        <table role="table" className="w-full text-sm">
          <thead role="rowgroup" className="bg-muted/50">
            <tr role="row">
              {columns.map((col) => (
                <th
                  key={col.key}
                  role="columnheader"
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
              {actions ? <th role="columnheader" className="w-1 p-3" /> : null}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows === null ? (
              // Placeholders, not records: marked so they read as such in the DOM, and left without
              // a `data-label` so card mode gives them no field caption.
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`sk-${i}`} role="row" data-skeleton="true" className="border-t">
                  {columns.map((col) => (
                    <td key={col.key} role="cell" className="p-3">
                      <Skeleton className={col.skeleton ?? 'h-4 w-24'} />
                    </td>
                  ))}
                  {actions ? <td role="cell" className="p-3" /> : null}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr role="row">
                <td
                  role="cell"
                  colSpan={colCount}
                  className="p-10 text-center text-sm text-muted-foreground"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const href = rowHref?.(row);
                return (
                <tr
                  key={rowKey(row)}
                  role="row"
                  // The row is a second, larger way into the record; the actions-cell controls
                  // keep their own behaviour — a click that originates inside any control is
                  // theirs, and the row handler steps aside (TKT-0088).
                  tabIndex={href ? 0 : undefined}
                  onClick={
                    href
                      ? (e) => {
                          if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) {
                            return;
                          }
                          router.push(href);
                        }
                      : undefined
                  }
                  onKeyDown={
                    href
                      ? (e) => {
                          // Only Enter on the row itself — not one bubbling out of a focused control.
                          if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
                          router.push(href);
                        }
                      : undefined
                  }
                  className={cn(
                    'border-t transition-colors hover:bg-muted/30',
                    href &&
                      'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      role="cell"
                      data-label={col.header}
                      className={cn('p-3', col.cellClassName)}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                  {/* No `data-label`: the actions cell is chrome, not a field. */}
                  {actions ? (
                    <td role="cell" className="whitespace-nowrap p-3 text-right">
                      {actions(row)}
                    </td>
                  ) : null}
                </tr>
                );
              })
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
