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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { Classes, Locations, Trainees, type Location, type Trainee } from '@/lib/api-resources';

// monthlyAmount/sessionPrice are kept as raw strings to dodge a
// zod-input-vs-output type mismatch with @hookform/resolvers; we coerce + validate
// in onSubmit and let the backend's class-validator do the final positivity check.
const schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    billingMode: z.enum(['PER_MONTH', 'PER_SESSION']),
    monthlyAmount: z.string(),
    sessionPrice: z.string(),
    locationIds: z.array(z.string()),
    traineeIds: z.array(z.string()),
  })
  .refine((v) => v.billingMode !== 'PER_MONTH' || v.monthlyAmount.trim() !== '', {
    path: ['monthlyAmount'],
    message: 'required',
  })
  .refine((v) => v.billingMode !== 'PER_SESSION' || v.sessionPrice.trim() !== '', {
    path: ['sessionPrice'],
    message: 'required',
  });

type FormValues = z.infer<typeof schema>;

function parsePositive(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function NewClassPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);

  useEffect(() => {
    Locations.list().then(setLocations).catch(() => setLocations([]));
    Trainees.list().then(setTrainees).catch(() => setTrainees([]));
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      description: '',
      billingMode: 'PER_MONTH',
      monthlyAmount: '',
      sessionPrice: '',
      locationIds: [],
      traineeIds: [],
    },
  });

  const billingMode = watch('billingMode');

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Classes.create({
        name: values.name,
        description: values.description || undefined,
        billingMode: values.billingMode,
        monthlyAmount:
          values.billingMode === 'PER_MONTH' ? parsePositive(values.monthlyAmount) : undefined,
        sessionPrice:
          values.billingMode === 'PER_SESSION' ? parsePositive(values.sessionPrice) : undefined,
        locationIds: values.locationIds.length ? values.locationIds : undefined,
        traineeIds: values.traineeIds.length ? values.traineeIds : undefined,
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
      <h1 className="text-2xl font-semibold tracking-tight">{t('classes.new')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('classes.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
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
              <Label htmlFor="billingMode">{t('classes.fields.billingMode')}</Label>
              <select
                id="billingMode"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register('billingMode')}
              >
                <option value="PER_MONTH">{t('classes.billing.PER_MONTH')}</option>
                <option value="PER_SESSION">{t('classes.billing.PER_SESSION')}</option>
              </select>
            </div>

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
                  <p className="text-xs text-destructive">{t('common.errors.required')}</p>
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
                  <p className="text-xs text-destructive">{t('common.errors.required')}</p>
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
