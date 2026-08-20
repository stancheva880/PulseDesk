'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import {
  Dashboard,
  type CashflowSummaryEntry,
  type FeesSummaryEntry,
} from '@/lib/api-resources';
import { cn, formatMoney } from '@/lib/utils';

type Lens = 'billing' | 'cashflow';

type SummaryEntry = FeesSummaryEntry | CashflowSummaryEntry;

function isCashflow(e: SummaryEntry): e is CashflowSummaryEntry {
  return 'billed' in e;
}

// Mirrors resolveAndValidateRange in the backend's DashboardService so a bad range reads
// as a translated message instead of that endpoint's English 400. The backend stays
// authoritative — this only spares the round trip.
const MAX_MONTHS = 120;

// YYYY-MM-DD is the only shape a native date input yields, so slicing is enough.
const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

function rangeProblem(from: string, to: string, today: string): 'order' | 'tooLong' | null {
  if (from && to && monthIndex(to) < monthIndex(from)) return 'order';
  // An omitted "to" runs to the current month — or to "from" itself when that is later.
  const effectiveTo = to || (from > today ? from : today);
  if (from && monthIndex(effectiveTo) - monthIndex(from) + 1 > MAX_MONTHS) return 'tooLong';
  return null;
}

// A date filter that can be emptied again. No browser offers a dependable clear control for
// type="date" — Chrome shows only the calendar indicator — and '' is exactly what the effect
// above treats as "bound omitted". Owns its own `relative` wrapper, unlike PasswordInput,
// which delegates that to the caller: here the Label sits in the same block and the ✕ would
// centre against the pair.
function ClearableDateInput({
  id,
  value,
  onChange,
  clearLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  clearLabel: string;
}) {
  return (
    <div className="relative">
      {/* pr-14 keeps a typed date clear of both controls; the ✕ sits at right-7 so the
          browser's own calendar indicator keeps the edge it reserves. */}
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-14"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="absolute right-7 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function FeesChart() {
  const { t } = useTranslation();
  const [lens, setLens] = useState<Lens>('billing');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<SummaryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A native date input emits a complete value mid-edit, so a half-typed year
    // (0002-01-01) asks the API for thousands of months. Ignore implausible dates —
    // the value is always YYYY-MM-DD, so a string compare is enough.
    const plausible = (v: string) => v === '' || (v >= '1900-01-01' && v <= '2999-12-31');
    if (!plausible(from) || !plausible(to)) return;

    const problem = rangeProblem(from, to, new Date().toISOString().slice(0, 10));
    /* eslint-disable react-hooks/set-state-in-effect -- validation message and stale-error clearing both belong to the filter change */
    if (problem) {
      setError(
        problem === 'order'
          ? t('chart.errors.dateRange')
          : t('chart.errors.rangeTooLarge', { months: MAX_MONTHS }),
      );
      return;
    }
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    const params = { from: from || undefined, to: to || undefined };
    const promise =
      lens === 'billing'
        ? Dashboard.feesSummary(params)
        : Dashboard.cashflowSummary(params);
    // Responses can land out of order after a filter change; only the newest may write.
    let stale = false;
    promise
      .then((rows) => {
        if (!stale) setData(rows);
      })
      .catch((e: unknown) => {
        if (!stale) setError(apiErrorMessage(e));
      });
    return () => {
      stale = true;
    };
    // t is read only for error text; it must not retrigger the fetch. A message already on
    // screen keeps its language until the next filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, from, to]);

  const chartData = useMemo(() => data ?? [], [data]);

  const first = chartData[0]?.period;
  const last = chartData[chartData.length - 1]?.period;
  const caption = !first || !last
    ? null
    : first === last
      ? t('chart.showingMonth', { month: first })
      : t('chart.showingPeriod', { from: first, to: last });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {lens === 'billing' ? t('chart.billingTitle') : t('chart.cashflowTitle')}
          </CardTitle>
          <div className="flex gap-1" role="group" aria-label={t('chart.lensAria')}>
            <Button
              type="button"
              size="sm"
              variant={lens === 'billing' ? 'default' : 'outline'}
              aria-pressed={lens === 'billing'}
              onClick={() => setLens('billing')}
            >
              {t('chart.lens.billing')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={lens === 'cashflow' ? 'default' : 'outline'}
              aria-pressed={lens === 'cashflow'}
              onClick={() => setLens('cashflow')}
            >
              {t('chart.lens.cashflow')}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {lens === 'billing' ? t('chart.billingDescription') : t('chart.cashflowDescription')}
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="chart-from">{t('chart.from')}</Label>
            <ClearableDateInput
              id="chart-from"
              value={from}
              onChange={setFrom}
              clearLabel={t('a11y.clearStartDate')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chart-to">{t('chart.to')}</Label>
            <ClearableDateInput
              id="chart-to"
              value={to}
              onChange={setTo}
              clearLabel={t('a11y.clearEndDate')}
            />
          </div>
        </div>

        {/* Read off the response, not re-derived from the inputs: an empty bound resolves
            server-side, so the returned months are the only honest answer to "what am I
            looking at". */}
        {caption ? <p className="mb-4 text-xs text-muted-foreground">{caption}</p> : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {data === null ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('chart.empty')}</p>
        ) : (
          <div className={cn('w-full', 'h-72')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip
                  formatter={(value) => {
                    const n = typeof value === 'number' ? value : Number(value);
                    return formatMoney(n, t('fees.currency'));
                  }}
                />
                <Legend />
                {/* Brand orange for "collected" (the headline metric); a neutral grey
                    for the secondary series (pending / billed). Hard-coded because
                    Recharts colors aren't theme-aware out of the box. */}
                <Bar dataKey="collected" name={t('chart.collected')} fill="#f55200" radius={[4, 4, 0, 0]} />
                {lens === 'billing' ? (
                  <Bar
                    dataKey="pending"
                    name={t('chart.pending')}
                    fill="#94a3b8"
                    radius={[4, 4, 0, 0]}
                  />
                ) : (
                  <Bar
                    dataKey="billed"
                    name={t('chart.billed')}
                    fill="#94a3b8"
                    radius={[4, 4, 0, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Accessible numeric backing for screen readers + tests — Recharts SVG is hard to assert against. */}
        <table className="sr-only">
          <thead>
            <tr>
              <th>{t('chart.period')}</th>
              <th>{t('chart.collected')}</th>
              <th>{lens === 'billing' ? t('chart.pending') : t('chart.billed')}</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((row) => (
              <tr key={row.period} data-testid={`chart-row-${row.period}`}>
                <td>{row.period}</td>
                <td>{row.collected.toFixed(2)}</td>
                <td>{(isCashflow(row) ? row.billed : row.pending).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
