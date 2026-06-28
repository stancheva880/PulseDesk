'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAuth } from '@/components/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { isManager } from '@/lib/permissions';
import {
  Classes,
  Fees,
  Trainees,
  type ClassRow,
  type FeeRow,
  type FeeStatus,
  type GenerateFeesResult,
  type Trainee,
} from '@/lib/api-resources';
import { cn } from '@/lib/utils';

const STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const satisfies readonly FeeStatus[];

interface FeeRowVM {
  fee: FeeRow;
  traineeName: string;
  className: string;
  amount: number;
  paid: number;
  outstanding: number;
}

export default function FeesListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  const [fees, setFees] = useState<FeeRow[] | null>(null);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FeeRow | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  // Filters live in URL-style state but we keep it local for now.
  const [statusFilter, setStatusFilter] = useState<FeeStatus | ''>('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'periodStart', desc: true },
  ]);

  const reload = () => {
    Promise.all([
      Fees.list({
        status: statusFilter || undefined,
        periodStartFrom: periodFrom || undefined,
        periodStartTo: periodTo || undefined,
      }),
      Trainees.list(),
      Classes.list(),
    ])
      .then(([f, tr, c]) => {
        setFees(f);
        setTrainees(tr);
        setClasses(c);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  };

  useEffect(reload, [statusFilter, periodFrom, periodTo]);

  const traineeNameById = useMemo(
    () => new Map(trainees.map((tr) => [tr.id, `${tr.firstName} ${tr.lastName}`])),
    [trainees],
  );
  const classNameById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes],
  );

  const data: FeeRowVM[] = useMemo(
    () =>
      (fees ?? []).map((fee) => {
        const amount = Number(fee.amount);
        const paid = Number(fee.paid);
        return {
          fee,
          traineeName: traineeNameById.get(fee.traineeId) ?? '—',
          className: classNameById.get(fee.classId) ?? '—',
          amount,
          paid,
          outstanding: Math.max(0, amount - paid),
        };
      }),
    [fees, traineeNameById, classNameById],
  );

  const onDelete = async () => {
    if (!pendingDelete) return;
    setDelBusy(true);
    try {
      await Fees.remove(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      setPendingDelete(null);
    } finally {
      setDelBusy(false);
    }
  };

  const feeStatusVariant = (status: FeeStatus): 'success' | 'warning' | 'secondary' => {
    if (status === 'PAID') return 'success';
    if (status === 'PARTIAL') return 'warning';
    return 'secondary';
  };

  const columns = useMemo<ColumnDef<FeeRowVM>[]>(
    () => [
      {
        id: 'periodStart',
        accessorFn: (row) => row.fee.periodStart,
        header: t('fees.fields.period'),
        cell: ({ row }) => formatPeriod(row.original.fee),
      },
      {
        id: 'trainee',
        accessorKey: 'traineeName',
        header: t('fees.fields.trainee'),
        filterFn: 'includesString',
      },
      {
        id: 'class',
        accessorKey: 'className',
        header: t('fees.fields.class'),
        filterFn: 'includesString',
      },
      {
        id: 'amount',
        accessorKey: 'amount',
        header: t('fees.fields.amount'),
        cell: ({ row }) => `${row.original.amount.toFixed(2)} ${t('fees.currency')}`,
      },
      {
        id: 'outstanding',
        accessorKey: 'outstanding',
        header: t('fees.fields.outstanding'),
        cell: ({ row }) => {
          const o = row.original.outstanding;
          return (
            <span className={cn(o > 0 ? 'font-medium text-warning-foreground dark:text-warning' : 'text-muted-foreground')}>
              {o.toFixed(2)} {t('fees.currency')}
            </span>
          );
        },
      },
      {
        id: 'status',
        accessorFn: (row) => row.fee.status,
        header: t('fees.fields.status'),
        cell: ({ row }) => {
          const status = row.original.fee.status;
          return <Badge variant={feeStatusVariant(status)}>{t(`fees.status.${status}`)}</Badge>;
        },
      },
      ...(admin
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/fees/${row.original.fee.id}`}>{t('common.edit')}</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setPendingDelete(row.original.fee)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              ),
            } satisfies ColumnDef<FeeRowVM>,
          ]
        : []),
    ],
    [t, classNameById, traineeNameById, admin],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('fees.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('fees.subtitle')}</p>
        </div>
        {admin ? (
          <Button asChild>
            <Link href="/fees/new">
              <Plus className="h-4 w-4" />
              {t('fees.new')}
            </Link>
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {admin ? (
        <div className="grid gap-4 md:grid-cols-2">
          <GenerateMonthlyCard onGenerated={reload} classes={classes} />
          <GenerateSessionCard onGenerated={reload} classes={classes} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('fees.filters.status')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="status">{t('fees.filters.status')}</Label>
              <select
                id="status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FeeStatus | '')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('fees.filters.all')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`fees.status.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="periodFrom">{t('fees.filters.periodFrom')}</Label>
              <Input
                id="periodFrom"
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="periodTo">{t('fees.filters.periodTo')}</Label>
              <Input
                id="periodTo"
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="search">{t('fees.search')}</Label>
              <Input
                id="search"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={t('fees.search')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className={cn(
                      'p-3 text-left font-medium',
                      h.column.getCanSort() && 'cursor-pointer select-none',
                    )}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === 'asc'
                      ? ' ▲'
                      : h.column.getIsSorted() === 'desc'
                        ? ' ▼'
                        : null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {fees === null ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t">
                  {Array.from({ length: columns.length }).map((__, j) => (
                    <td key={j} className="p-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-10 text-center text-sm text-muted-foreground">
                  {t('fees.empty')}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t transition-colors hover:bg-muted/30">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="p-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('fees.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDelete}
        busy={delBusy}
      />
    </div>
  );
}

function formatPeriod(fee: FeeRow): string {
  const start = new Date(fee.periodStart).toISOString().slice(0, 10);
  const end = new Date(fee.periodEnd).toISOString().slice(0, 10);
  return `${start} → ${end}`;
}

function GenerateMonthlyCard({
  onGenerated,
  classes,
}: {
  onGenerated: () => void;
  classes: ClassRow[];
}) {
  const { t } = useTranslation();
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateFeesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const monthlyClasses = classes.filter((c) => c.billingMode === 'PER_MONTH');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (periodStart && periodEnd && periodEnd < periodStart) {
      setError(t('fees.errors.endsBeforeStarts'));
      return;
    }
    setBusy(true);
    try {
      const r = await Fees.generateMonthly({
        periodStart,
        periodEnd,
        classId: classId || undefined,
      });
      setResult(r);
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fees.generateMonthly.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('fees.generateMonthly.description')}</p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="m-from">{t('fees.fields.periodStart')}</Label>
            <Input
              id="m-from"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-to">{t('fees.fields.periodEnd')}</Label>
            <Input
              id="m-to"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="m-class">{t('fees.fields.class')}</Label>
            <select
              id="m-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('fees.filters.all')}</option>
              {monthlyClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit" disabled={busy || !periodStart || !periodEnd}>
              {busy ? t('common.saving') : t('fees.generateMonthly.submit')}
            </Button>
          </div>
        </form>
        {result ? (
          <p className="mt-3 text-sm text-green-700">
            {t('fees.generated', { created: result.created, skipped: result.skipped })}
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function GenerateSessionCard({
  onGenerated,
  classes,
}: {
  onGenerated: () => void;
  classes: ClassRow[];
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateFeesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionClasses = classes.filter((c) => c.billingMode === 'PER_SESSION');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (from && to && to < from) {
      setError(t('fees.errors.endsBeforeStarts'));
      return;
    }
    setBusy(true);
    try {
      const r = await Fees.generateSession({
        from,
        to,
        classId: classId || undefined,
      });
      setResult(r);
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fees.generateSession.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('fees.generateSession.description')}</p>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="s-from">{t('fees.fields.periodStart')}</Label>
            <Input
              id="s-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-to">{t('fees.fields.periodEnd')}</Label>
            <Input
              id="s-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-class">{t('fees.fields.class')}</Label>
            <select
              id="s-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('fees.filters.all')}</option>
              {sessionClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit" disabled={busy || !from || !to}>
              {busy ? t('common.saving') : t('fees.generateSession.submit')}
            </Button>
          </div>
        </form>
        {result ? (
          <p className="mt-3 text-sm text-green-700">
            {t('fees.generated', { created: result.created, skipped: result.skipped })}
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
