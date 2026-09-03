'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api';
import { Locations, type CustomerLocationPaymentEntry } from '@/lib/api-resources';

type MethodKey = 'bank' | 'revolut' | 'paypal' | 'cash';

// Which methods a location actually offers — a method with nothing set gets no tab.
function availableMethods(loc: CustomerLocationPaymentEntry): MethodKey[] {
  const methods: MethodKey[] = [];
  if (loc.bankIban || loc.bankAccountHolder) methods.push('bank');
  if (loc.revolutHandle) methods.push('revolut');
  if (loc.paypalEmail) methods.push('paypal');
  if (loc.cashNote) methods.push('cash');
  return methods;
}

export default function PortalPaymentDetailsPage() {
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
  // (same pattern as the portal Fees tab's per-trainee selector).
  const effectiveLocationId = entries?.some((l) => l.id === selectedLocationId)
    ? selectedLocationId
    : (entries?.[0]?.id ?? null);
  const location = entries?.find((l) => l.id === effectiveLocationId) ?? null;
  const methods = location ? availableMethods(location) : [];
  const effectiveMethod = methods.includes(selectedMethod as MethodKey)
    ? selectedMethod
    : (methods[0] ?? null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('portal.paymentDetails.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('portal.paymentDetails.subtitle')}</p>
      </div>

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
                {effectiveMethod === 'paypal' ? (
                  <p className="font-medium">{location.paypalEmail}</p>
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
