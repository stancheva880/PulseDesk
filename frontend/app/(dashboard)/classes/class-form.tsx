'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, SubmitError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import {
  Classes,
  Locations,
  Trainees,
  Users,
  type ClassDetail,
  type Location,
  listAll,
} from '@/lib/api-resources';
import { NativeSelect } from '@/components/ui/native-select';
import { ChipsCombobox, type ComboboxOption } from '@/components/ui/chips-combobox';
import { parseAmount } from '@/lib/utils';

// TKT-0078: trainers are searched, not downloaded. One page of ten is what the picker shows,
// and the server orders by last name, so "the first ten" is stable and alphabetical.
const TRAINER_PAGE = 10;
const personLabel = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
const searchTrainees = async (query: string): Promise<ComboboxOption[]> => {
  const page = await Trainees.list({
    pageSize: TRAINER_PAGE,
    ...(query ? { search: query } : {}),
  });
  return page.items.map((t) => ({ id: t.id, label: `${t.firstName} ${t.lastName}`.trim() }));
};
const searchTrainers = async (query: string): Promise<ComboboxOption[]> => {
  const page = await Users.list({
    role: 'EMPLOYEE',
    pageSize: TRAINER_PAGE,
    ...(query ? { search: query } : {}),
  });
  return page.items.map((u) => ({ id: u.id, label: personLabel(u) }));
};

// monthlyAmount/sessionPrice/coursePrice are kept as raw strings to dodge a
// zod-input-vs-output type mismatch with @hookform/resolvers; parseAmount does the coercion and
// carries the same rule the fee forms use and the DTOs enforce.
// billingMode is editable in both modes since TKT-0109 (PRD-0015 allows the switch); only
// the active mode's own fields are required and sent.
// TKT-0090: zod messages carry i18n keys; FieldError translates them.
const baseSchema = z.object({
  name: z.string().trim().min(1, 'common.errors.required').max(120, 'common.errors.tooLong'),
  description: z.string().trim().max(2000, 'common.errors.tooLong').optional(),
  billingMode: z.enum(['PER_MONTH', 'PER_SESSION', 'PER_COURSE']),
  monthlyAmount: z.string(),
  sessionPrice: z.string(),
  // TKT-0109: raw strings like the prices; native date inputs yield YYYY-MM-DD.
  coursePrice: z.string(),
  courseStart: z.string(),
  courseEnd: z.string(),
  // TKT-0103: raw string like the prices; empty = unlimited.
  capacity: z.string(),
  // TKT-0112: what a freed spot does on a full session.
  waitlistMode: z.enum(['NONE', 'FIFO_AUTO', 'CLAIM']),
  // TKT-0117: the self-booking pair; the cutoff is a raw string like capacity, empty = until start.
  allowSelfBooking: z.boolean(),
  bookingCutoffMin: z.string(),
  locationIds: z.array(z.string()),
  traineeIds: z.array(z.string()),
  trainerIds: z.array(z.string()),
  isActive: z.boolean(),
});

const classSchema = baseSchema
  .refine((v) => v.billingMode !== 'PER_MONTH' || parseAmount(v.monthlyAmount) !== null, {
    path: ['monthlyAmount'],
    message: 'common.errors.amount',
  })
  .refine((v) => v.billingMode !== 'PER_SESSION' || parseAmount(v.sessionPrice) !== null, {
    path: ['sessionPrice'],
    message: 'common.errors.amount',
  })
  .refine((v) => v.billingMode !== 'PER_COURSE' || parseAmount(v.coursePrice) !== null, {
    path: ['coursePrice'],
    message: 'common.errors.amount',
  })
  .refine((v) => v.billingMode !== 'PER_COURSE' || v.courseStart !== '', {
    path: ['courseStart'],
    message: 'common.errors.required',
  })
  .refine((v) => v.billingMode !== 'PER_COURSE' || v.courseEnd !== '', {
    path: ['courseEnd'],
    message: 'common.errors.required',
  })
  // ISO date strings compare correctly as strings; both-present is checked above.
  .refine(
    (v) =>
      v.billingMode !== 'PER_COURSE' ||
      v.courseStart === '' ||
      v.courseEnd === '' ||
      v.courseStart < v.courseEnd,
    { path: ['courseEnd'], message: 'classes.errors.coursePeriod' },
  )
  .refine(
    (v) => v.capacity.trim() === '' || (/^\d+$/.test(v.capacity.trim()) && Number(v.capacity) >= 1),
    { path: ['capacity'], message: 'classes.errors.capacity' },
  )
  // TKT-0117: whole number ≥ 0; only checked while the toggle is on (the field is hidden otherwise).
  .refine(
    (v) =>
      !v.allowSelfBooking ||
      v.bookingCutoffMin.trim() === '' ||
      /^\d+$/.test(v.bookingCutoffMin.trim()),
    { path: ['bookingCutoffMin'], message: 'classes.errors.cutoff' },
  );

type FormValues = z.infer<typeof baseSchema>;

const createDefaults = (): FormValues => ({
  name: '',
  description: '',
  billingMode: 'PER_MONTH',
  monthlyAmount: '',
  sessionPrice: '',
  coursePrice: '',
  courseStart: '',
  courseEnd: '',
  capacity: '',
  waitlistMode: 'NONE',
  allowSelfBooking: false,
  bookingCutoffMin: '',
  locationIds: [],
  traineeIds: [],
  trainerIds: [],
  isActive: true,
});

// The schema has already rejected anything parseAmount cannot read; this only turns its null into
// the `undefined` the request DTO expects.
const price = (raw: string) => parseAmount(raw) ?? undefined;

// id comes from the edit page's route params; create mode has none.
export function ClassForm({ mode, id = '' }: { mode: 'create' | 'edit'; id?: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [cls, setCls] = useState<ClassDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [trainerSeed, setTrainerSeed] = useState<ComboboxOption[]>([]);
  const [traineeSeed, setTraineeSeed] = useState<ComboboxOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(classSchema),
    defaultValues: createDefaults(),
  });

  useEffect(() => {
    if (mode === 'create') {
      listAll(Locations.list).then(setLocations).catch(() => setLocations([]));
      return;
    }
    Promise.all([Classes.get(id), listAll(Locations.list)])
      .then(([detail, locs]) => {
        setCls(detail);
        setLocations(locs);
        setTrainerSeed(detail.trainers.map((tr) => ({ id: tr.id, label: personLabel(tr) })));
        // Chips come from the class, never from a search: a roster member outside this actor's
        // location scope can never appear in the candidate list, and must still render and save.
        setTraineeSeed(
          detail.trainees.map((tr) => ({
            id: tr.id,
            label: `${tr.firstName} ${tr.lastName}`.trim(),
          })),
        );
        reset({
          name: detail.name,
          description: detail.description ?? '',
          billingMode: detail.billingMode,
          monthlyAmount: detail.monthlyAmount ?? '',
          sessionPrice: detail.sessionPrice ?? '',
          coursePrice: detail.coursePrice ?? '',
          // The API sends ISO datetimes; native date inputs take YYYY-MM-DD.
          courseStart: detail.courseStart?.slice(0, 10) ?? '',
          courseEnd: detail.courseEnd?.slice(0, 10) ?? '',
          capacity: detail.capacity == null ? '' : String(detail.capacity),
          waitlistMode: detail.waitlistMode ?? 'NONE',
          allowSelfBooking: detail.allowSelfBooking ?? false,
          bookingCutoffMin:
            detail.bookingCutoffMin == null ? '' : String(detail.bookingCutoffMin),
          locationIds: detail.locations.map((l) => l.id),
          traineeIds: detail.trainees.map((tr) => tr.id),
          trainerIds: detail.trainers.map((tr) => tr.id),
          isActive: detail.isActive,
        });
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [mode, id, reset]);

  // TKT-0109: watched in both modes — the mode is editable on edit too.
  const billingMode = watch('billingMode');

  // TKT-0111: warn-allow — the counter and warning are the whole capacity story now,
  // the server no longer rejects an over-full roster.
  const enrolled = watch('traineeIds').length;
  const capacityRaw = watch('capacity').trim();
  const capacityNum = /^\d+$/.test(capacityRaw) ? Number(capacityRaw) : null;

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      // Only the active mode's own fields travel; on a switch the server clears the rest.
      const modeFields = {
        billingMode: values.billingMode,
        monthlyAmount:
          values.billingMode === 'PER_MONTH' ? price(values.monthlyAmount) : undefined,
        sessionPrice:
          values.billingMode === 'PER_SESSION' ? price(values.sessionPrice) : undefined,
        coursePrice:
          values.billingMode === 'PER_COURSE' ? price(values.coursePrice) : undefined,
        courseStart: values.billingMode === 'PER_COURSE' ? values.courseStart : undefined,
        courseEnd: values.billingMode === 'PER_COURSE' ? values.courseEnd : undefined,
      };
      // TKT-0117: the cutoff travels only while the flag is on; edit clears with null,
      // and a flag turned off sends no cutoff — the server clears it.
      const cutoff = values.bookingCutoffMin.trim();
      if (mode === 'create') {
        await Classes.create({
          name: values.name,
          description: values.description || undefined,
          ...modeFields,
          capacity: values.capacity.trim() === '' ? undefined : Number(values.capacity),
          waitlistMode: values.waitlistMode,
          allowSelfBooking: values.allowSelfBooking,
          bookingCutoffMin:
            values.allowSelfBooking && cutoff !== '' ? Number(cutoff) : undefined,
          locationIds: values.locationIds.length ? values.locationIds : undefined,
          traineeIds: values.traineeIds.length ? values.traineeIds : undefined,
          trainerIds: values.trainerIds.length ? values.trainerIds : undefined,
        });
      } else {
        if (!cls) return;
        await Classes.update(id, {
          name: values.name,
          description: values.description || undefined,
          ...modeFields,
          // Empty clears the limit — the update DTO takes null for "unlimited".
          capacity: values.capacity.trim() === '' ? null : Number(values.capacity),
          waitlistMode: values.waitlistMode,
          allowSelfBooking: values.allowSelfBooking,
          bookingCutoffMin: values.allowSelfBooking
            ? cutoff === ''
              ? null
              : Number(cutoff)
            : undefined,
          locationIds: values.locationIds,
          traineeIds: values.traineeIds,
          trainerIds: values.trainerIds,
          isActive: values.isActive,
        });
      }
      // TKT-0092: stay on the form; create resets ready for the next record.
      if (mode === 'create') reset(createDefaults());
      showToast({ text: t('common.savedToast'), variant: 'success' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSubmitError(t('classes.errors.duplicate'));
      } else {
        setSubmitError(apiErrorMessage(e));
      }
    }
  };

  const ready = mode === 'create' || cls !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t(mode === 'create' ? 'classes.new' : 'classes.edit')}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('classes.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('classes.fields.name')}</Label>
                <Input
                  id="name"
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                  {...register('name')}
                />
                <FieldError id="name-error" messageKey={errors.name?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">{t('classes.fields.description')}</Label>
                <Textarea
                  id="description"
                  rows={3}
                  aria-invalid={errors.description ? true : undefined}
                  aria-describedby={errors.description ? 'description-error' : undefined}
                  {...register('description')}
                />
                <FieldError id="description-error" messageKey={errors.description?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="billingMode">{t('classes.fields.billingMode')}</Label>
                <NativeSelect
                  id="billingMode"
                  {...register('billingMode')}
                >
                  <option value="PER_MONTH">{t('classes.billing.PER_MONTH')}</option>
                  <option value="PER_SESSION">{t('classes.billing.PER_SESSION')}</option>
                  <option value="PER_COURSE">{t('classes.billing.PER_COURSE')}</option>
                </NativeSelect>
              </div>

              {billingMode === 'PER_MONTH' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="monthlyAmount">{t('classes.fields.monthlyAmount')}</Label>
                  <Input
                    id="monthlyAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    aria-invalid={errors.monthlyAmount ? true : undefined}
                    aria-describedby={errors.monthlyAmount ? 'monthlyAmount-error' : undefined}
                    {...register('monthlyAmount')}
                  />
                  <FieldError id="monthlyAmount-error" messageKey={errors.monthlyAmount?.message} />
                </div>
              ) : billingMode === 'PER_SESSION' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sessionPrice">{t('classes.fields.sessionPrice')}</Label>
                  <Input
                    id="sessionPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    aria-invalid={errors.sessionPrice ? true : undefined}
                    aria-describedby={errors.sessionPrice ? 'sessionPrice-error' : undefined}
                    {...register('sessionPrice')}
                  />
                  <FieldError id="sessionPrice-error" messageKey={errors.sessionPrice?.message} />
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="coursePrice">{t('classes.fields.coursePrice')}</Label>
                    <Input
                      id="coursePrice"
                      type="number"
                      step="0.01"
                      min="0"
                      aria-invalid={errors.coursePrice ? true : undefined}
                      aria-describedby={errors.coursePrice ? 'coursePrice-error' : undefined}
                      {...register('coursePrice')}
                    />
                    <FieldError id="coursePrice-error" messageKey={errors.coursePrice?.message} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="courseStart">{t('classes.fields.courseStart')}</Label>
                      <Input
                        id="courseStart"
                        type="date"
                        aria-invalid={errors.courseStart ? true : undefined}
                        aria-describedby={errors.courseStart ? 'courseStart-error' : undefined}
                        {...register('courseStart')}
                      />
                      <FieldError id="courseStart-error" messageKey={errors.courseStart?.message} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="courseEnd">{t('classes.fields.courseEnd')}</Label>
                      <Input
                        id="courseEnd"
                        type="date"
                        aria-invalid={errors.courseEnd ? true : undefined}
                        aria-describedby={errors.courseEnd ? 'courseEnd-error' : undefined}
                        {...register('courseEnd')}
                      />
                      <FieldError id="courseEnd-error" messageKey={errors.courseEnd?.message} />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="capacity">{t('classes.fields.capacity')}</Label>
                <Input
                  id="capacity"
                  type="number"
                  min="1"
                  step="1"
                  aria-invalid={errors.capacity ? true : undefined}
                  aria-describedby={errors.capacity ? 'capacity-error' : undefined}
                  {...register('capacity')}
                />
                <FieldError id="capacity-error" messageKey={errors.capacity?.message} />
                {capacityNum !== null ? (
                  <p className="text-sm text-muted-foreground">
                    {t('classes.capacityStatus', { enrolled, capacity: capacityNum })}
                  </p>
                ) : null}
                {capacityNum !== null && enrolled > capacityNum ? (
                  <p role="status" className="text-sm text-amber-600 dark:text-amber-500">
                    {t('classes.capacityWarning')}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="waitlistMode">{t('classes.fields.waitlistMode')}</Label>
                <NativeSelect id="waitlistMode" {...register('waitlistMode')}>
                  <option value="NONE">{t('classes.waitlist.NONE')}</option>
                  <option value="FIFO_AUTO">{t('classes.waitlist.FIFO_AUTO')}</option>
                  <option value="CLAIM">{t('classes.waitlist.CLAIM')}</option>
                </NativeSelect>
                {/* TKT-0113 interview decision: the mode's contract is stated where it is chosen. */}
                {watch('waitlistMode') === 'FIFO_AUTO' ? (
                  <p className="text-xs text-muted-foreground">{t('classes.waitlistAutoHint')}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    id="allowSelfBooking"
                    type="checkbox"
                    className="size-4"
                    {...register('allowSelfBooking')}
                  />
                  {t('classes.fields.selfBooking')}
                </label>
                {watch('allowSelfBooking') ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="bookingCutoffMin">
                      {t('classes.fields.bookingCutoffMin')}
                    </Label>
                    <Input
                      id="bookingCutoffMin"
                      type="number"
                      min="0"
                      step="1"
                      aria-invalid={errors.bookingCutoffMin ? true : undefined}
                      aria-describedby={
                        errors.bookingCutoffMin ? 'bookingCutoffMin-error' : undefined
                      }
                      {...register('bookingCutoffMin')}
                    />
                    <FieldError
                      id="bookingCutoffMin-error"
                      messageKey={errors.bookingCutoffMin?.message}
                    />
                    <p className="text-xs text-muted-foreground">{t('classes.cutoffHint')}</p>
                  </div>
                ) : null}
              </div>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t('classes.fields.locations')}</legend>
                {locations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('classes.noLocations')}</p>
                ) : (
                  <ul className="space-y-1">
                    {locations.map((loc) => (
                      <li key={loc.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            value={loc.id}
                            className="size-4"
                            {...register('locationIds')}
                          />
                          {loc.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t('classes.fields.trainees')}</legend>
                <Controller
                  name="traineeIds"
                  control={control}
                  render={({ field }) => (
                    <ChipsCombobox
                      id="traineeIds"
                      value={field.value}
                      onChange={field.onChange}
                      search={searchTrainees}
                      selected={traineeSeed}
                      placeholder={t('common.search.person')}
                      noMatchesLabel={t('common.search.noMatches')}
                      emptyLabel={t('classes.noTrainees')}
                    />
                  )}
                />
              </fieldset>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t('classes.fields.trainers')}</legend>
                <p className="text-xs text-muted-foreground">{t('classes.fields.trainersHint')}</p>
                <Controller
                  name="trainerIds"
                  control={control}
                  render={({ field }) => (
                    <ChipsCombobox
                      id="trainerIds"
                      value={field.value}
                      onChange={field.onChange}
                      search={searchTrainers}
                      selected={trainerSeed}
                      placeholder={t('common.search.person')}
                      noMatchesLabel={t('common.search.noMatches')}
                      emptyLabel={t('classes.noTrainers')}
                    />
                  )}
                />
              </fieldset>

              {mode === 'edit' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('isActive')} className="size-4" />
                  {t('classes.fields.active')}
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
