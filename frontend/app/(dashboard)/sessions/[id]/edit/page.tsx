'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTimeInput } from '@/components/ui/date-time-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import {
  Locations,
  Sessions,
  type Location,
  type SessionDetail,
  type SessionStatus,
} from '@/lib/api-resources';

const SESSION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const satisfies readonly SessionStatus[];

const schema = z
  .object({
    locationId: z.string().min(1),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    status: z.enum(SESSION_STATUSES),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), {
    path: ['endsAt'],
    message: 'endsBeforeStarts',
  });

type FormValues = z.infer<typeof schema>;

function isoToLocal(iso: string): string {
  // Render the existing UTC time as a local "datetime-local" value (no seconds, no TZ).
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(local: string): string {
  return new Date(local).toISOString();
}

export default function EditSessionPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      locationId: '',
      startsAt: '',
      endsAt: '',
      status: 'SCHEDULED',
      notes: '',
    },
  });

  useEffect(() => {
    Promise.all([Sessions.get(id), Locations.list()])
      .then(([detail, locs]) => {
        setSession(detail);
        setLocations(locs);
        reset({
          locationId: detail.locationId,
          startsAt: isoToLocal(detail.startsAt),
          endsAt: isoToLocal(detail.endsAt),
          status: detail.status,
          notes: detail.notes ?? '',
        });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'load failed'));
  }, [id, reset]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Sessions.update(id, {
        locationId: values.locationId,
        startsAt: localToIso(values.startsAt),
        endsAt: localToIso(values.endsAt),
        status: values.status,
        notes: values.notes || undefined,
      });
      router.replace('/sessions');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('sessions.edit')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('sessions.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !session ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="space-y-1.5">
                <Label>{t('sessions.fields.class')}</Label>
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{session.class.name}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="locationId">{t('sessions.fields.location')}</Label>
                <select
                  id="locationId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...register('locationId')}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="startsAt">{t('sessions.fields.startsAt')}</Label>
                  <Controller
                    control={control}
                    name="startsAt"
                    render={({ field }) => (
                      <DateTimeInput
                        id="startsAt"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endsAt">{t('sessions.fields.endsAt')}</Label>
                  <Controller
                    control={control}
                    name="endsAt"
                    render={({ field }) => (
                      <DateTimeInput
                        id="endsAt"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-invalid={Boolean(errors.endsAt)}
                      />
                    )}
                  />
                  {errors.endsAt?.message === 'endsBeforeStarts' ? (
                    <p className="text-xs text-destructive">
                      {t('sessions.errors.endsBeforeStarts')}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="status">{t('sessions.fields.status')}</Label>
                <select
                  id="status"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...register('status')}
                >
                  {SESSION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`sessions.status.${s}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">{t('sessions.fields.notes')}</Label>
                <Textarea id="notes" rows={3} {...register('notes')} />
              </div>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? t('common.saving') : t('common.save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
