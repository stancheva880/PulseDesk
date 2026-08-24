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
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import { Locations } from '@/lib/api-resources';

// TKT-0090: zod messages carry i18n keys; FieldError translates them.
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'common.errors.required')
    .max(120, 'common.errors.tooLong'),
  address: z.string().trim().max(500, 'common.errors.tooLong').optional(),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

// id comes from the edit page's route params; create mode has none.
export function LocationForm({ mode, id = '' }: { mode: 'create' | 'edit'; id?: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', address: '', isActive: true },
  });

  useEffect(() => {
    if (mode !== 'edit') return;
    Locations.get(id)
      .then((loc) =>
        reset({ name: loc.name, address: loc.address ?? '', isActive: loc.isActive }),
      )
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [mode, id, reset]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      if (mode === 'create') {
        await Locations.create({ name: values.name, address: values.address || undefined });
      } else {
        await Locations.update(id, {
          name: values.name,
          address: values.address || undefined,
          isActive: values.isActive,
        });
      }
      // TKT-0092: stay on the form; create resets ready for the next record.
      if (mode === 'create') reset({ name: '', address: '', isActive: true });
      showToast({ text: t('common.savedToast'), variant: 'success' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSubmitError(t('locations.errors.duplicate'));
      } else {
        setSubmitError(apiErrorMessage(e));
      }
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t(mode === 'create' ? 'locations.new' : 'locations.edit')}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('locations.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('locations.fields.name')}</Label>
                <Input
                  id="name"
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                  {...register('name')}
                />
                <FieldError id="name-error" messageKey={errors.name?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="address">{t('locations.fields.address')}</Label>
                <Textarea
                  id="address"
                  rows={3}
                  aria-invalid={errors.address ? true : undefined}
                  aria-describedby={errors.address ? 'address-error' : undefined}
                  {...register('address')}
                />
                <FieldError id="address-error" messageKey={errors.address?.message} />
              </div>
              {mode === 'edit' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('isActive')} className="size-4" />
                  {t('locations.fields.active')}
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
