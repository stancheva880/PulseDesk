'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAuth } from '@/components/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import { isManager } from '@/lib/auth-storage';
import {
  Classes,
  Fees,
  Trainees,
  type ClassRow,
  type FeeRow,
  type FeeStatus,
  type FeeStatusFilter,
  type GenerateFeesResult,
  type Trainee,
  type UnbilledEntry,
  listAll,
} from '@/lib/api-resources';
import { cn, formatMoney } from '@/lib/utils';
import { useCrudList } from '@/lib/use-crud-list';
import { NativeSelect } from '@/components/ui/native-select';

const STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const satisfies readonly FeeStatus[];

interface FeeRowVM {
  fee: FeeRow;
  traineeName: string;
  className: string;
  amount: number;
  paid: number;
  outstanding: number;
}

// Numeric columns start desc on first click (matches the previous react-table behavior).
const DESC_FIRST = new Set(['amount', 'outstanding']);

export default function FeesListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);

  // Filters live in URL-style state but we keep it local for now.
  const [statusFilter, setStatusFilter] = useState<FeeStatusFilter | ''>('');
  const [classFilter, setClassFilter] = useState('');
  // One <input type="month"> in place of two date inputs. A fee period is a month, and the
  // question this page has to answer is "who owes for this month" — arbitrary ranges were
  // never what anyone typed. Native element, so no picker dependency.
  const [month, setMonth] = useState('');
  const [globalFilter, setGlobalFilter] = useState('');
  // Bumped after a bulk generate, so the unbilled panel below re-reads with the list.
  const [generation, setGeneration] = useState(0);
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: 'periodStart',
    desc: true,
  });

  const {
    rows: fees,
    setPage,
    pageInfo,
    error,
    setError,
    reload,
    pendingDelete,
    setPendingDelete,
    busy,
    onDelete,
  } = useCrudList(Fees, {
    params: {
      status: statusFilter || undefined,
      classId: classFilter || undefined,
      periodStartFrom: monthBounds(month)?.from,
      periodStartTo: monthBounds(month)?.to,
    },
    deps: [statusFilter, classFilter, month],
  });

  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  useEffect(() => {
    Promise.all([listAll(Trainees.list), listAll(Classes.list)])
      .then(([tr, c]) => {
        setTrainees(tr);
        setClasses(c);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, [setError]);

  // Enrolled trainees with no fee row for the chosen month. No status filter can surface
  // them — there is nothing to filter — so this is the other half of "who has not paid".
  //
  // The result carries the filter it was fetched for. That is what lets the effect clear
  // nothing synchronously (which would cascade a render) and still never show the previous
  // class's names while the next request is in flight — the render just fails to match.
  const unbilledKey = admin && classFilter && monthBounds(month) ? `${classFilter}|${month}` : '';
  const [unbilled, setUnbilled] = useState<{ key: string; rows: UnbilledEntry[] } | null>(null);
  useEffect(() => {
    const bounds = monthBounds(month);
    if (!unbilledKey || !bounds) return;
    let stale = false;
    Fees.unbilled({ classId: classFilter, periodStart: bounds.from, periodEnd: bounds.to })
      .then((rows) => {
        if (!stale) setUnbilled({ key: unbilledKey, rows });
      })
      .catch(() => {
        // A failed preview is not worth an error banner over the list it sits above.
      });
    return () => {
      stale = true;
    };
  }, [unbilledKey, classFilter, month, generation]);

  const refreshAll = () => {
    reload();
    setGeneration((n) => n + 1);
  };

  const traineeNameById = useMemo(
    () => new Map(trainees.map((tr) => [tr.id, `${tr.firstName} ${tr.lastName}`])),
    [trainees],
  );
  const classNameById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes],
  );

  const data: FeeRowVM[] | null = useMemo(
    () =>
      fees === null
        ? null
        : fees.map((fee) => {
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

  const sortValues: Record<string, (row: FeeRowVM) => string | number> = useMemo(
    () => ({
      periodStart: (row) => row.fee.periodStart,
      trainee: (row) => row.traineeName,
      class: (row) => row.className,
      amount: (row) => row.amount,
      outstanding: (row) => row.outstanding,
      status: (row) => row.fee.status,
    }),
    [],
  );

  // Client-side filter + sort over the current server page (parity with the
  // removed react-table setup: includesString across the same accessor values).
  const displayed: FeeRowVM[] | null = useMemo(() => {
    if (data === null) return null;
    const q = globalFilter.toLowerCase();
    const filtered = q
      ? data.filter((row) =>
          Object.values(sortValues).some((get) => String(get(row)).toLowerCase().includes(q)),
        )
      : data;
    const get = sortValues[sort.key];
    if (!get) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.desc ? -cmp : cmp;
    });
    return sorted;
  }, [data, globalFilter, sort, sortValues]);

  const onSortToggle = (key: string) => {
    setSort((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: DESC_FIRST.has(key) },
    );
  };

  const feeStatusVariant = (status: FeeStatus): 'success' | 'warning' | 'secondary' => {
    if (status === 'PAID') return 'success';
    if (status === 'PARTIAL') return 'warning';
    return 'secondary';
  };

  const columns: DataTableColumn<FeeRowVM>[] = [
    {
      key: 'periodStart',
      header: t('fees.fields.period'),
      cell: (row) => formatPeriod(row.fee),
      sortValue: sortValues.periodStart,
    },
    {
      key: 'trainee',
      header: t('fees.fields.trainee'),
      cell: (row) => row.traineeName,
      sortValue: sortValues.trainee,
    },
    {
      key: 'class',
      header: t('fees.fields.class'),
      cell: (row) => row.className,
      sortValue: sortValues.class,
    },
    {
      key: 'amount',
      header: t('fees.fields.amount'),
      cell: (row) => formatMoney(row.amount, t('fees.currency')),
      sortValue: sortValues.amount,
    },
    {
      key: 'outstanding',
      header: t('fees.fields.outstanding'),
      cell: (row) => (
        <span
          className={cn(
            row.outstanding > 0
              ? 'font-medium text-warning-foreground dark:text-warning'
              : 'text-muted-foreground',
          )}
        >
          {formatMoney(row.outstanding, t('fees.currency'))}
        </span>
      ),
      sortValue: sortValues.outstanding,
    },
    {
      key: 'status',
      header: t('fees.fields.status'),
      cell: (row) => (
        <Badge variant={feeStatusVariant(row.fee.status)}>{t(`fees.status.${row.fee.status}`)}</Badge>
      ),
      sortValue: sortValues.status,
    },
  ];

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
          <GenerateMonthlyCard onGenerated={refreshAll} classes={classes} />
          <GenerateSessionCard onGenerated={refreshAll} classes={classes} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('fees.filters.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="status">{t('fees.filters.status')}</Label>
              <NativeSelect
                id="status"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as FeeStatusFilter | ''); setPage(1); }}
              >
                <option value="">{t('fees.filters.all')}</option>
                <option value="OUTSTANDING">{t('fees.filters.outstanding')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`fees.status.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="classFilter">{t('fees.filters.class')}</Label>
              <NativeSelect
                id="classFilter"
                value={classFilter}
                onChange={(e) => { setClassFilter(e.target.value); setPage(1); }}
              >
                <option value="">{t('fees.filters.all')}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="month">{t('fees.filters.month')}</Label>
              <Input
                id="month"
                type="month"
                value={month}
                onChange={(e) => { setMonth(e.target.value); setPage(1); }}
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

      {unbilled && unbilled.key === unbilledKey && unbilled.rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('fees.unbilled.title', { n: unbilled.rows.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">{t('fees.unbilled.hint')}</p>
            <ul className="space-y-1 text-sm">
              {unbilled.rows.map((u) => (
                <li key={`${u.classId}|${u.traineeId}`}>
                  {`${u.traineeFirstName} ${u.traineeLastName} · ${u.className} · ${formatMoney(
                    u.amount,
                    t('fees.currency'),
                  )}`}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={displayed}
        rowKey={(row) => row.fee.id}
        emptyText={t('fees.empty')}
        sort={sort}
        onSortToggle={onSortToggle}
        actions={
          admin
            ? (row) => (
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/fees/${row.fee.id}`}>{t('common.edit')}</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setPendingDelete(row.fee)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              )
            : undefined
        }
        pageInfo={pageInfo}
        onPageChange={setPage}
        confirm={{
          open: pendingDelete !== null,
          onOpenChange: (open) => {
            if (!open) setPendingDelete(null);
          },
          title: t('fees.deleteConfirm'),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}

// "2026-06" -> the inclusive day bounds the API filters on. Returns undefined for the
// empty value the month input starts at, which is what leaves the filter off.
function monthBounds(month: string): { from: string; to: string } | undefined {
  if (!/^\d{4}-\d{2}$/.test(month)) return undefined;
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
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
      setError(apiErrorMessage(err));
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
            <NativeSelect
              id="m-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">{t('fees.filters.all')}</option>
              {monthlyClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
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
      setError(apiErrorMessage(err));
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
            <NativeSelect
              id="s-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">{t('fees.filters.all')}</option>
              {sessionClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
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
