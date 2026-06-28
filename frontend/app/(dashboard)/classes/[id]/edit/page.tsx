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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import {
  Classes,
  Locations,
  Trainees,
  type ClassDetail,
  type Location,
  type Trainee,
} from '@/lib/api-resources';

// Edit form: billingMode is shown but read-only (immutable per backend invariant).
// Amount fields are raw strings — parsed in onSubmit to avoid zod-input/output type drift.
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  monthlyAmount: z.string(),
  sessionPrice: z.string(),
  locationIds: z.array(z.string()),
  traineeIds: z.array(z.string()),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

function parsePositive(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function EditClassPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [cls, setCls] = useState<ClassDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
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
      name: '',
      description: '',
      monthlyAmount: '',
      sessionPrice: '',
      locationIds: [],
      traineeIds: [],
      isActive: true,
    },
  });

  useEffect(() => {
    Promise.all([Classes.get(id), Locations.list(), Trainees.list()])
      .then(([detail, locs, trs]) => {
        setCls(detail);
        setLocations(locs);
        setTrainees(trs);
        reset({
          name: detail.name,
          description: detail.description ?? '',
          monthlyAmount: detail.monthlyAmount ?? '',
          sessionPrice: detail.sessionPrice ?? '',
          locationIds: detail.locations.map((l) => l.id),
          traineeIds: detail.trainees.map((tr) => tr.id),
          isActive: detail.isActive,
        });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'load failed'));
  }, [id, reset]);

  const onSubmit = async (values: FormValues) => {
    if (!cls) return;
    setSubmitError(null);
    try {
      await Classes.update(id, {
        name: values.name,
        description: values.description || undefined,
        monthlyAmount:
          cls.billingMode === 'PER_MONTH' ? parsePositive(values.monthlyAmount) : undefined,
        sessionPrice:
          cls.billingMode === 'PER_SESSION' ? parsePositive(values.sessionPrice) : undefined,
        locationIds: values.locationIds,
        traineeIds: values.traineeIds,
        isActive: values.isActive,
      });
      router.replace('/classes');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSubmitError(t('classes.errors.duplicate'));
      } else {
        setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      }
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('classes.edit')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('classes.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !cls ? (
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
              <div className="space-y-1.5">
                <Label>{t('classes.fields.billingMode')}</Label>
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {t(`classes.billing.${cls.billingMode}`)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t('classes.billingImmutable')}
                  </span>
                </p>
              </div>
              {cls.billingMode === 'PER_MONTH' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="monthlyAmount">{t('classes.fields.monthlyAmount')}</Label>
                  <Input
                    id="monthlyAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('monthlyAmount')}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="sessionPrice">{t('classes.fields.sessionPrice')}</Label>
                  <Input
                    id="sessionPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('sessionPrice')}
                  />
                </div>
              )}
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  {t('classes.fields.locations')}
                </legend>
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
                <legend className="px-1 text-sm font-medium">
                  {t('classes.fields.trainees')}
                </legend>
                {trainees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('classes.noTrainees')}</p>
                ) : (
                  <ul className="space-y-1">
                    {trainees.map((tr) => (
                      <li key={tr.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            value={tr.id}
                            className="size-4"
                            {...register('traineeIds')}
                          />
                          {tr.firstName} {tr.lastName}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isActive')} className="size-4" />
                {t('classes.fields.active')}
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
