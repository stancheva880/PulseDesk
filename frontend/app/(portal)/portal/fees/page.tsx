'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomerFeeCard } from '@/components/customer-fee-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api';
import {
  Fees,
  Locations,
  type CustomerFeeEntry,
  type CustomerLocationPaymentEntry,
} from '@/lib/api-resources';

type FeesTab = 'myFees' | 'payFees';

interface GroupedFees {
  traineeId: string;
  traineeName: string;
  fees: CustomerFeeEntry[];
}

// TKT-0130: "Моите такси" and "Плащане на такси" were two separate top-level portal tabs;
// a customer looking at a fee had no way to see where to pay it without leaving the page.
// Same tab-instead-of-stacking pattern as /profile: one section visible at a time.
function MyFeesSection() {
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
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('portal.feesSubtitle')}</p>

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

type MethodKey = 'bank' | 'revolut' | 'mypos' | 'cash';

// Which methods a location actually offers — a method with nothing set gets no tab.
function availableMethods(loc: CustomerLocationPaymentEntry): MethodKey[] {
  const methods: MethodKey[] = [];
  if (loc.bankIban || loc.bankAccountHolder) methods.push('bank');
  if (loc.revolutHandle) methods.push('revolut');
  if (loc.myposLink) methods.push('mypos');
  if (loc.cashNote) methods.push('cash');
  return methods;
}

function PayFeesSection() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CustomerLocationPaymentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<MethodKey | null>(null);

  useEffect(() => {
    Locations.myPaymentDetails()
      .then(setEntries)
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, []);

  // Derived, not stored: defaults to the first location/method once the list loads, and stays
  // on the clicked one as long as it is still valid — no effect needed to keep them in sync
  // (same pattern as the My fees section's per-trainee grouping).
  const effectiveLocationId = entries?.some((l) => l.id === selectedLocationId)
    ? selectedLocationId
    : (entries?.[0]?.id ?? null);
  const location = entries?.find((l) => l.id === effectiveLocationId) ?? null;
  const methods = location ? availableMethods(location) : [];
  const effectiveMethod = methods.includes(selectedMethod as MethodKey)
    ? selectedMethod
    : (methods[0] ?? null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('portal.paymentDetails.subtitle')}</p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('portal.paymentDetails.empty')}</p>
      ) : (
        <div className="space-y-4">
          {entries.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {entries.map((l) => (
                <Button
                  key={l.id}
                  type="button"
                  variant={l.id === effectiveLocationId ? 'default' : 'outline'}
                  onClick={() => {
                    setSelectedLocationId(l.id);
                    setSelectedMethod(null);
                  }}
                >
                  {l.name}
                </Button>
              ))}
            </div>
          ) : null}

          {location && methods.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{location.name}</CardTitle>
                <div className="flex flex-wrap gap-2 pt-2">
                  {methods.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={m === effectiveMethod ? 'default' : 'outline'}
                      onClick={() => setSelectedMethod(m)}
                    >
                      {t(`portal.paymentDetails.methods.${m}`)}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {effectiveMethod === 'bank' ? (
                  <>
                    {location.bankIban ? (
                      <p>
                        <span className="text-muted-foreground">
                          {t('portal.paymentDetails.fields.iban')}:
                        </span>{' '}
                        <span className="font-medium">{location.bankIban}</span>
                      </p>
                    ) : null}
                    {location.bankAccountHolder ? (
                      <p>
                        <span className="text-muted-foreground">
                          {t('portal.paymentDetails.fields.accountHolder')}:
                        </span>{' '}
                        <span className="font-medium">{location.bankAccountHolder}</span>
                      </p>
                    ) : null}
                  </>
                ) : null}
                {effectiveMethod === 'revolut' ? (
                  <p className="font-medium">{location.revolutHandle}</p>
                ) : null}
                {effectiveMethod === 'mypos' && location.myposLink ? (
                  <a
                    href={location.myposLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline underline-offset-2 break-all"
                  >
                    {location.myposLink}
                  </a>
                ) : null}
                {effectiveMethod === 'cash' ? <p>{location.cashNote}</p> : null}
              </CardContent>
            </Card>
          ) : null}

          {location && methods.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('portal.paymentDetails.noneSet')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function PortalFeesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<FeesTab>('myFees');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('portal.tabs.fees')}</h1>

      <div role="tablist" aria-label={t('portal.feesTabs.label')} className="flex flex-wrap gap-2">
        <Button
          type="button"
          role="tab"
          aria-selected={tab === 'myFees'}
          variant={tab === 'myFees' ? 'default' : 'outline'}
          onClick={() => setTab('myFees')}
        >
          {t('portal.feesTabs.myFees')}
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={tab === 'payFees'}
          variant={tab === 'payFees' ? 'default' : 'outline'}
          onClick={() => setTab('payFees')}
        >
          {t('portal.feesTabs.payFees')}
        </Button>
      </div>

      {tab === 'myFees' ? <MyFeesSection /> : <PayFeesSection />}
    </div>
  );
}
