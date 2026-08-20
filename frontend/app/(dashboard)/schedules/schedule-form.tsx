'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import {
  ClassSchedules,
  Classes,
  Locations,
  type ClassRow,
  type ClassSchedule,
  type DayOfWeek,
  type Location,
  listAll,
} from '@/lib/api-resources';
import { NativeSelect } from '@/components/ui/native-select';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const satisfies readonly DayOfWeek[];

// classId is required on create only — the edit endpoint doesn't accept it
// (a schedule can't move to another class), so edit skips the min(1).
const baseSchema = z.object({
  classId: z.string(),
  locationId: z.string().min(1),
  dayOfWeek: z.enum(DAYS),
  startTime: z.string().regex(HHMM, 'timeFormat'),
  endTime: z.string().regex(HHMM, 'timeFormat'),
  isActive: z.boolean(),
});

const endAfterStart = {
  path: ['endTime'] as ['endTime'],
  message: 'endsBeforeStarts',
};
const createSchema = baseSchema
  .extend({ classId: z.string().min(1) })
  .refine((v) => v.endTime > v.startTime, endAfterStart);
const editSchema = baseSchema.refine((v) => v.endTime > v.startTime, endAfterStart);

type FormValues = z.infer<typeof baseSchema>;

// id comes from the edit page's route params; create mode has none.
export function ScheduleForm({ mode, id = '' }: { mode: 'create' | 'edit'; id?: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [schedule, setSchedule] = useState<ClassSchedule | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(mode === 'create' ? createSchema : editSchema),
    defaultValues: {
      classId: '',
      locationId: '',
      dayOfWeek: 'MON',
      startTime: '',
      endTime: '',
      isActive: true,
    },
  });

  useEffect(() => {
    if (mode === 'create') {
      Promise.all([listAll(Classes.list), listAll(Locations.list)])
        .then(([c, l]) => {
          setClasses(c);
          setLocations(l);
        })
        .catch(() => undefined);
      return;
    }
    Promise.all([ClassSchedules.get(id), listAll(Locations.list)])
      .then(([detail, locs]) => {
        setSchedule(detail);
        setLocations(locs);
        reset({
          classId: detail.classId,
          locationId: detail.locationId,
          dayOfWeek: detail.dayOfWeek,
          startTime: detail.startTime,
          endTime: detail.endTime,
          isActive: detail.isActive,
        });
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [mode, id, reset]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      if (mode === 'create') {
        await ClassSchedules.create({
          classId: values.classId,
          locationId: values.locationId,
          dayOfWeek: values.dayOfWeek,
          startTime: values.startTime,
          endTime: values.endTime,
        });
      } else {
        await ClassSchedules.update(id, {
          locationId: values.locationId,
          dayOfWeek: values.dayOfWeek,
          startTime: values.startTime,
          endTime: values.endTime,
          isActive: values.isActive,
        });
      }
      router.replace('/schedules');
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  const ready = mode === 'create' || schedule !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t(mode === 'create' ? 'schedules.new' : 'schedules.edit')}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('schedules.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              {mode === 'create' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="classId">{t('schedules.fields.class')}</Label>
                  <NativeSelect
                    id="classId"
                    aria-invalid={Boolean(errors.classId)}
                    {...register('classId')}
                  >
                    <option value="">—</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="locationId">{t('schedules.fields.location')}</Label>
                <NativeSelect
                  id="locationId"
                  aria-invalid={Boolean(errors.locationId)}
                  {...register('locationId')}
                >
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dayOfWeek">{t('schedules.fields.dayOfWeek')}</Label>
                <NativeSelect
                  id="dayOfWeek"
                  {...register('dayOfWeek')}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {t(`schedules.days.${d}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="startTime">{t('schedules.fields.startTime')}</Label>
                  <Input
                    id="startTime"
                    type="time"
                    aria-invalid={Boolean(errors.startTime)}
                    {...register('startTime')}
                  />
                  {errors.startTime?.message === 'timeFormat' ? (
                    <p className="text-xs text-destructive">{t('schedules.errors.timeFormat')}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endTime">{t('schedules.fields.endTime')}</Label>
                  <Input
                    id="endTime"
                    type="time"
                    aria-invalid={Boolean(errors.endTime)}
                    {...register('endTime')}
                  />
                  {errors.endTime?.message === 'endsBeforeStarts' ? (
                    <p className="text-xs text-destructive">{t('schedules.errors.endsBeforeStarts')}</p>
                  ) : errors.endTime?.message === 'timeFormat' ? (
                    <p className="text-xs text-destructive">{t('schedules.errors.timeFormat')}</p>
                  ) : null}
                </div>
              </div>

              {mode === 'edit' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('isActive')} className="size-4" />
                  {t('common.active')}
                </label>
              ) : null}

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
