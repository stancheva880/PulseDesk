'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiErrorMessage } from '@/lib/api';
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

// monthlyAmount/sessionPrice are kept as raw strings to dodge a
// zod-input-vs-output type mismatch with @hookform/resolvers; parseAmount does the coercion and
// carries the same rule the fee forms use and the DTOs enforce.
// billingMode is create-only input (immutable per backend invariant) — the edit
// mode shows it read-only, and only the mode's own price field is required.
const baseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  billingMode: z.enum(['PER_MONTH', 'PER_SESSION']),
  monthlyAmount: z.string(),
  sessionPrice: z.string(),
  locationIds: z.array(z.string()),
  traineeIds: z.array(z.string()),
  trainerIds: z.array(z.string()),
  isActive: z.boolean(),
});

const classSchema = baseSchema
  .refine((v) => v.billingMode !== 'PER_MONTH' || parseAmount(v.monthlyAmount) !== null, {
    path: ['monthlyAmount'],
    message: 'amount',
  })
  .refine((v) => v.billingMode !== 'PER_SESSION' || parseAmount(v.sessionPrice) !== null, {
    path: ['sessionPrice'],
    message: 'amount',
  });

type FormValues = z.infer<typeof baseSchema>;

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
    defaultValues: {
      name: '',
      description: '',
      billingMode: 'PER_MONTH',
      monthlyAmount: '',
      sessionPrice: '',
      locationIds: [],
      traineeIds: [],
      trainerIds: [],
      isActive: true,
    },
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
          locationIds: detail.locations.map((l) => l.id),
          traineeIds: detail.trainees.map((tr) => tr.id),
          trainerIds: detail.trainers.map((tr) => tr.id),
          isActive: detail.isActive,
        });
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [mode, id, reset]);

  const watchedBillingMode = watch('billingMode');
  const billingMode = mode === 'create' ? watchedBillingMode : cls?.billingMode;

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      if (mode === 'create') {
        await Classes.create({
          name: values.name,
          description: values.description || undefined,
          billingMode: values.billingMode,
          monthlyAmount:
            values.billingMode === 'PER_MONTH' ? price(values.monthlyAmount) : undefined,
          sessionPrice:
            values.billingMode === 'PER_SESSION' ? price(values.sessionPrice) : undefined,
          locationIds: values.locationIds.length ? values.locationIds : undefined,
          traineeIds: values.traineeIds.length ? values.traineeIds : undefined,
          trainerIds: values.trainerIds.length ? values.trainerIds : undefined,
        });
      } else {
        if (!cls) return;
        await Classes.update(id, {
          name: values.name,
          description: values.description || undefined,
          monthlyAmount:
            cls.billingMode === 'PER_MONTH' ? price(values.monthlyAmount) : undefined,
          sessionPrice:
            cls.billingMode === 'PER_SESSION' ? price(values.sessionPrice) : undefined,
          locationIds: values.locationIds,
          traineeIds: values.traineeIds,
          trainerIds: values.trainerIds,
          isActive: values.isActive,
        });
      }
      router.replace('/classes');
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
                <Input id="name" aria-invalid={Boolean(errors.name)} {...register('name')} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">{t('classes.fields.description')}</Label>
                <Textarea id="description" rows={3} {...register('description')} />
              </div>

              {mode === 'create' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="billingMode">{t('classes.fields.billingMode')}</Label>
                  <NativeSelect
                    id="billingMode"
                    {...register('billingMode')}
                  >
                    <option value="PER_MONTH">{t('classes.billing.PER_MONTH')}</option>
                    <option value="PER_SESSION">{t('classes.billing.PER_SESSION')}</option>
                  </NativeSelect>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>{t('classes.fields.billingMode')}</Label>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {t(`classes.billing.${cls!.billingMode}`)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('classes.billingImmutable')}
                    </span>
                  </p>
                </div>
              )}

              {billingMode === 'PER_MONTH' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="monthlyAmount">{t('classes.fields.monthlyAmount')}</Label>
                  <Input
                    id="monthlyAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    aria-invalid={Boolean(errors.monthlyAmount)}
                    {...register('monthlyAmount')}
                  />
                  {errors.monthlyAmount ? (
                    <p className="text-xs text-destructive">{t('common.errors.amount')}</p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="sessionPrice">{t('classes.fields.sessionPrice')}</Label>
                  <Input
                    id="sessionPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    aria-invalid={Boolean(errors.sessionPrice)}
                    {...register('sessionPrice')}
                  />
                  {errors.sessionPrice ? (
                    <p className="text-xs text-destructive">{t('common.errors.amount')}</p>
                  ) : null}
                </div>
              )}

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
