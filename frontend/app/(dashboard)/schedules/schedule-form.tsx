'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, SubmitError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
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
// TKT-0090: zod messages carry i18n keys; FieldError translates them.
const baseSchema = z.object({
  classId: z.string(),
  locationId: z.string().min(1, 'common.errors.required'),
  dayOfWeek: z.enum(DAYS),
  startTime: z.string().regex(HHMM, 'schedules.errors.timeFormat'),
  endTime: z.string().regex(HHMM, 'schedules.errors.timeFormat'),
  isActive: z.boolean(),
});

const endAfterStart = {
  path: ['endTime'] as ['endTime'],
  message: 'schedules.errors.endsBeforeStarts',
};
const createSchema = baseSchema
  .extend({ classId: z.string().min(1, 'common.errors.required') })
  .refine((v) => v.endTime > v.startTime, endAfterStart);
const editSchema = baseSchema.refine((v) => v.endTime > v.startTime, endAfterStart);

type FormValues = z.infer<typeof baseSchema>;

const createDefaults = (classId: string): FormValues => ({
  classId,
  locationId: '',
  dayOfWeek: 'MON',
  startTime: '',
  endTime: '',
  isActive: true,
});

// id comes from the edit page's route params; create mode has none.
// initialClassId is the new page's ?classId= — a contextual-create prefill (TKT-0091).
export function ScheduleForm({
  mode,
  id = '',
  initialClassId,
}: {
  mode: 'create' | 'edit';
  id?: string;
  initialClassId?: string;
}) {
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
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(mode === 'create' ? createSchema : editSchema),
    defaultValues: createDefaults(''),
  });

  // The query-parameter parent, kept only when it is in the tenant-scoped list — a malformed or
  // foreign ?classId= is simply absent, so a bad link degrades to no selection (TKT-0091).
  const prefilledClassId =
    initialClassId && classes.some((c) => c.id === initialClassId) ? initialClassId : '';

  // TKT-0127: same rule as the session form — see the note there for why the row's own hall
  // stays in the list even once it is retired.
  const selectableLocations = locations.filter((l) => l.isActive || l.id === schedule?.locationId);

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

  // Apply the prefill after the options render: setting a native select to a value with no
  // matching <option> is silently ignored, so this cannot live in the fetch handler above.
  useEffect(() => {
    if (mode !== 'create' || !prefilledClassId) return;
    setValue('classId', prefilledClassId);
  }, [mode, prefilledClassId, setValue]);

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
        // TKT-0092: stay on the form, ready for the next record — the query-parameter
        // parent survives the reset.
        reset(createDefaults(prefilledClassId));
      } else {
        await ClassSchedules.update(id, {
          locationId: values.locationId,
          dayOfWeek: values.dayOfWeek,
          startTime: values.startTime,
          endTime: values.endTime,
          isActive: values.isActive,
        });
      }
      showToast({ text: t('common.savedToast'), variant: 'success' });
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
                    aria-invalid={errors.classId ? true : undefined}
                    aria-describedby={errors.classId ? 'classId-error' : undefined}
                    {...register('classId')}
                  >
                    <option value="">—</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldError id="classId-error" messageKey={errors.classId?.message} />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="locationId">{t('schedules.fields.location')}</Label>
                <NativeSelect
                  id="locationId"
                  aria-invalid={errors.locationId ? true : undefined}
                  aria-describedby={errors.locationId ? 'locationId-error' : undefined}
                  {...register('locationId')}
                >
                  <option value="">—</option>
                  {selectableLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError id="locationId-error" messageKey={errors.locationId?.message} />
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
                    aria-invalid={errors.startTime ? true : undefined}
                    aria-describedby={errors.startTime ? 'startTime-error' : undefined}
                    {...register('startTime')}
                  />
                  <FieldError id="startTime-error" messageKey={errors.startTime?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endTime">{t('schedules.fields.endTime')}</Label>
                  <Input
                    id="endTime"
                    type="time"
                    aria-invalid={errors.endTime ? true : undefined}
                    aria-describedby={errors.endTime ? 'endTime-error' : undefined}
                    {...register('endTime')}
                  />
                  <FieldError id="endTime-error" messageKey={errors.endTime?.message} />
                </div>
              </div>

              {mode === 'edit' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('isActive')} className="size-4" />
                  {t('common.active')}
                </label>
              ) : null}

              <SubmitError message={submitError} />

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
