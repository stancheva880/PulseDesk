'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api';
import { calculateAge } from '@/lib/age';
import { Trainees, type CustomerTraineeEntry } from '@/lib/api-resources';

// "Am I actually linked?" — the question this tab exists to answer. A trainee shows up here
// the moment a guardian link is saved, whether or not it has ever been enrolled in a class,
// billed, or scheduled — the other three tabs only have something to show once that happens.
export default function PortalChildrenPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">{t('portal.children.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('portal.children.subtitle')}</p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('portal.children.empty')}</p>
      ) : (
        <ul className="space-y-4">
          {entries.map((tr) => (
            <li key={tr.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {tr.firstName} {tr.lastName}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('portal.children.age', { age: calculateAge(new Date(tr.dateOfBirth)) })}
                  </p>
                </CardHeader>
                <CardContent>
                  {tr.classes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('portal.children.noClasses')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tr.classes.map((c) => (
                        <Badge key={c.id} variant="secondary">
                          {c.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
