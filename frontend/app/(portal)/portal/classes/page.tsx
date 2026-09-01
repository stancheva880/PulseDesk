'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api';
import { Trainees, type CustomerTraineeEntry } from '@/lib/api-resources';

// Same family list as the Children tab, viewed by enrollment instead of identity — grouped by
// trainee (like the cards/fees tabs) so a parent with more than one child always sees both
// names, even when one of them has nothing enrolled yet.
export default function PortalClassesPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CustomerTraineeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Trainees.myTrainees()
      .then(setEntries)
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('portal.classes.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('portal.classes.subtitle')}</p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('portal.children.empty')}</p>
      ) : (
        <div className="space-y-6">
          {entries.map((tr) => (
            <section key={tr.id} className="space-y-3">
              <h2 className="text-lg font-semibold">
                {tr.firstName} {tr.lastName}
              </h2>
              {tr.classes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('portal.classes.noneEnrolled')}</p>
              ) : (
                <ul className="space-y-3">
                  {tr.classes.map((c) => (
                    <li key={c.id}>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">{c.name}</CardTitle>
                          {c.description ? (
                            <p className="text-sm text-muted-foreground">{c.description}</p>
                          ) : null}
                        </CardHeader>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
