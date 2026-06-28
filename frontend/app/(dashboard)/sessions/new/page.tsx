'use client';

import { useRouter } from 'next/navigation';
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
  Classes,
  Locations,
  Sessions,
  type ClassRow,
  type Location,
} from '@/lib/api-resources';

// `datetime-local` produces "YYYY-MM-DDTHH:MM" without a timezone — we treat it as
// local time and convert to a full ISO string at submit time. Backend stores UTC.
const schema = z
  .object({
    classId: z.string().min(1),
    locationId: z.string().min(1),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), {
    path: ['endsAt'],
    message: 'endsBeforeStarts',
  });

type FormValues = z.infer<typeof schema>;

function localToIso(local: string): string {
  return new Date(local).toISOString();
}

export default function NewSessionPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([Classes.list(), Locations.list()])
      .then(([c, l]) => {
        setClasses(c);
        setLocations(l);
      })
      .catch(() => {
        setClasses([]);
        setLocations([]);
      });
  }, []);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      classId: '',
      locationId: '',
      startsAt: '',
      endsAt: '',
      notes: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Sessions.create({
        classId: values.classId,
        locationId: values.locationId,
        startsAt: localToIso(values.startsAt),
        endsAt: localToIso(values.endsAt),
        notes: values.notes || undefined,
      });
      router.replace('/sessions');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('sessions.new')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('sessions.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="classId">{t('sessions.fields.class')}</Label>
              <select
                id="classId"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                aria-invalid={Boolean(errors.classId)}
                {...register('classId')}
              >
                <option value="">—</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="locationId">{t('sessions.fields.location')}</Label>
              <select
                id="locationId"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                aria-invalid={Boolean(errors.locationId)}
                {...register('locationId')}
              >
                <option value="">—</option>
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
                      aria-invalid={Boolean(errors.startsAt)}
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
                  <p className="text-xs text-destructive">{t('sessions.errors.endsBeforeStarts')}</p>
                ) : null}
              </div>
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
        </CardContent>
      </Card>
    </div>
  );
}
