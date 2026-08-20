'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { calculateAge } from '@/lib/age';
import { Trainees, type TraineeDetail } from '@/lib/api-resources';
import { isManager } from '@/lib/auth-storage';
import { apiErrorMessage } from '@/lib/api';

// Read-only view. A trainer may read a trainee and their guardian contacts
// (trainees.controller.ts / contacts.controller.ts allow ADMIN and EMPLOYEE) but may not write,
// so this page has no inputs at all — managers get a link to the form instead.

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value?.trim() ? value : '—'}</dd>
    </div>
  );
}

export default function TraineeDetailPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [trainee, setTrainee] = useState<TraineeDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Trainees.get(id)
      .then(setTrainee)
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('trainees.formTitle')}</h1>
        <div className="flex gap-2">
          {admin && trainee ? (
            <Button asChild variant="outline">
              <Link href={`/trainees/${trainee.id}/edit`}>{t('common.edit')}</Link>
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => router.push('/trainees')}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {!trainee ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {trainee.firstName} {trainee.lastName}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('trainees.fields.age')}: {calculateAge(new Date(trainee.dateOfBirth))}
                <Badge className="ml-2" variant={trainee.isActive ? 'success' : 'secondary'}>
                  {trainee.isActive ? t('common.active') : t('common.inactive')}
                </Badge>
              </p>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('trainees.fields.dateOfBirth')}
                  value={new Date(trainee.dateOfBirth).toISOString().slice(0, 10)}
                />
                <Field label={t('trainees.fields.phone')} value={trainee.phone} />
                <Field label={t('trainees.fields.email')} value={trainee.email} />
                <Field
                  label={t('trainees.fields.linkedAccount')}
                  value={trainee.user?.email ?? t('trainees.fields.linkedAccountNone')}
                />
                <Field
                  label={t('trainees.fields.locations')}
                  value={trainee.locations.map((l) => l.name).join(', ')}
                />
                <Field
                  label={t('trainees.fields.classes')}
                  value={trainee.classes.map((c) => c.name).join(', ')}
                />
                <Field
                  label={t('trainees.fields.guardians')}
                  value={trainee.guardians
                    .map((g) => [g.firstName, g.lastName].filter(Boolean).join(' ') || g.email)
                    .join(', ')}
                />
                <Field label={t('trainees.fields.notes')} value={trainee.notes} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('trainees.contacts.legend')}</CardTitle>
            </CardHeader>
            <CardContent>
              {trainee.contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('trainees.contacts.empty')}</p>
              ) : (
                <ul className="space-y-4">
                  {trainee.contacts.map((contact) => (
                    <li key={contact.id} className="rounded-md border p-3">
                      <p className="text-sm font-medium">
                        {contact.firstName} {contact.lastName}
                        {contact.isPrimary ? (
                          <Badge className="ml-2" variant="outline">
                            {t('trainees.contacts.primary')}
                          </Badge>
                        ) : null}
                      </p>
                      <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                        <Field
                          label={t('trainees.contacts.relationship')}
                          value={t(`trainees.contacts.relationships.${contact.relationship}`)}
                        />
                        <Field label={t('trainees.contacts.phone')} value={contact.phone} />
                        <Field label={t('trainees.contacts.email')} value={contact.email} />
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
