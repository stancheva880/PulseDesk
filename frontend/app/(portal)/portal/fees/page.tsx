'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Fees, type CustomerFeeEntry } from '@/lib/api-resources';
import { cn, formatMoney } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api';

interface GroupedFees {
  traineeId: string;
  traineeName: string;
  fees: CustomerFeeEntry[];
}

export default function PortalFeesPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CustomerFeeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Fees.myFees()
      .then(setEntries)
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, []);

  // Group by trainee so a parent with multiple kids gets a clean per-trainee section.
  const grouped = useMemo<GroupedFees[]>(() => {
    if (!entries) return [];
    const map = new Map<string, GroupedFees>();
    for (const fee of entries) {
      const name = `${fee.trainee.firstName} ${fee.trainee.lastName}`;
      const bucket = map.get(fee.traineeId) ?? {
        traineeId: fee.traineeId,
        traineeName: name,
        fees: [],
      };
      bucket.fees.push(fee);
      map.set(fee.traineeId, bucket);
    }
    return Array.from(map.values());
  }, [entries]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('portal.feesTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('portal.feesSubtitle')}</p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('portal.feesEmpty')}</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.traineeId} className="space-y-3">
              <h2 className="text-lg font-semibold">{group.traineeName}</h2>
              <ul className="space-y-3">
                {group.fees.map((fee) => (
                  <FeeCard key={fee.id} fee={fee} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FeeCard({ fee }: { fee: CustomerFeeEntry }) {
  const { t } = useTranslation();
  const amount = Number(fee.amount);
  const paid = fee.payments.reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = Math.max(0, amount - paid);

  const periodStart = new Date(fee.periodStart).toISOString().slice(0, 10);
  const periodEnd = new Date(fee.periodEnd).toISOString().slice(0, 10);

  return (
    <li>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {fee.class?.name ?? '—'} · {periodStart} → {periodEnd}
            </CardTitle>
            <span
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                fee.status === 'PAID' && 'bg-green-100 text-green-900',
                fee.status === 'PARTIAL' && 'bg-amber-100 text-amber-900',
                fee.status === 'UNPAID' && 'bg-muted text-muted-foreground',
              )}
            >
              {t(`fees.status.${fee.status}`)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t('fees.fields.amount')}</dt>
              <dd className="font-medium">
                {formatMoney(amount, t('fees.currency'))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('portal.paid')}</dt>
              <dd className="font-medium">
                {formatMoney(paid, t('fees.currency'))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('portal.outstanding')}</dt>
              <dd
                className={cn(
                  'font-medium',
                  outstanding > 0 ? 'text-amber-700' : 'text-muted-foreground',
                )}
              >
                {formatMoney(outstanding, t('fees.currency'))}
              </dd>
            </div>
          </dl>

          {fee.payments.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('portal.noPayments')}</p>
          ) : (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t('payments.ledger')} ({fee.payments.length})
              </summary>
              <ul className="mt-2 divide-y rounded-md border text-sm">
                {fee.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between p-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.paidAt).toISOString().slice(0, 10)}
                      {p.method ? ` · ${p.method}` : ''}
                    </span>
                    <span className="font-medium">
                      {formatMoney(p.amount, t('fees.currency'))}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
