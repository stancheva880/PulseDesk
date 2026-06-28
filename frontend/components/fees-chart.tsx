'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { ApiError } from '@/lib/api';
import {
  Dashboard,
  type CashflowSummaryEntry,
  type FeesSummaryEntry,
} from '@/lib/api-resources';
import { cn } from '@/lib/utils';

type Lens = 'billing' | 'cashflow';

type SummaryEntry = FeesSummaryEntry | CashflowSummaryEntry;

function isCashflow(e: SummaryEntry): e is CashflowSummaryEntry {
  return 'billed' in e;
}

export function FeesChart() {
  const { t } = useTranslation();
  const [lens, setLens] = useState<Lens>('billing');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<SummaryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const params = { from: from || undefined, to: to || undefined };
    const promise =
      lens === 'billing'
        ? Dashboard.feesSummary(params)
        : Dashboard.cashflowSummary(params);
    promise
      .then((rows) => setData(rows))
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : t('common.errors.generic')),
      );
  }, [lens, from, to, t]);

  const chartData = useMemo(() => data ?? [], [data]);

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
            <Input
              id="chart-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chart-to">{t('chart.to')}</Label>
            <Input
              id="chart-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

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
                    return `${n.toFixed(2)} ${t('fees.currency')}`;
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
