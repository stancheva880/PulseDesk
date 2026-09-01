'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomerFeeCard } from '@/components/customer-fee-card';
import { Fees, type CustomerFeeEntry } from '@/lib/api-resources';
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
                  <CustomerFeeCard key={fee.id} fee={fee} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
