'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TimeInput } from '@/components/ui/time-input';
import { ApiError } from '@/lib/api';
import {
  ClassSchedules,
  Locations,
  type ClassSchedule,
  type DayOfWeek,
  type Location,
} from '@/lib/api-resources';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const satisfies readonly DayOfWeek[];

const schema = z
  .object({
    locationId: z.string().min(1),
    dayOfWeek: z.enum(DAYS),
    startTime: z.string().regex(HHMM, 'timeFormat'),
    endTime: z.string().regex(HHMM, 'timeFormat'),
    isActive: z.boolean(),
  })
  .refine((v) => v.endTime > v.startTime, {
    path: ['endTime'],
    message: 'endsBeforeStarts',
  });

type FormValues = z.infer<typeof schema>;

export default function EditSchedulePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [schedule, setSchedule] = useState<ClassSchedule | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      locationId: '',
      dayOfWeek: 'MON',
      startTime: '',
      endTime: '',
      isActive: true,
    },
  });

  useEffect(() => {
    Promise.all([ClassSchedules.get(id), Locations.list()])
      .then(([detail, locs]) => {
        setSchedule(detail);
        setLocations(locs);
        reset({
          locationId: detail.locationId,
          dayOfWeek: detail.dayOfWeek,
          startTime: detail.startTime,
          endTime: detail.endTime,
          isActive: detail.isActive,
        });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'load failed'));
  }, [id, reset]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await ClassSchedules.update(id, values);
      router.replace('/schedules');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('schedules.edit')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('schedules.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !schedule ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="locationId">{t('schedules.fields.location')}</Label>
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

              <div className="space-y-1.5">
                <Label htmlFor="dayOfWeek">{t('schedules.fields.dayOfWeek')}</Label>
                <select
                  id="dayOfWeek"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...register('dayOfWeek')}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {t(`schedules.days.${d}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="startTime">{t('schedules.fields.startTime')}</Label>
                  <TimeInput
                    id="startTime"
                    aria-invalid={Boolean(errors.startTime)}
                    {...register('startTime')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endTime">{t('schedules.fields.endTime')}</Label>
                  <TimeInput
                    id="endTime"
                    aria-invalid={Boolean(errors.endTime)}
                    {...register('endTime')}
                  />
                  {errors.endTime?.message === 'endsBeforeStarts' ? (
                    <p className="text-xs text-destructive">{t('schedules.errors.endsBeforeStarts')}</p>
                  ) : null}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isActive')} className="size-4" />
                {t('common.active')}
              </label>

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
