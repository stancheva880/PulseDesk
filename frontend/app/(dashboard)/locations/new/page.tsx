'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Locations } from '@/lib/api-resources';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500).optional(),
});
type FormValues = z.infer<typeof schema>;

export default function NewLocationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', address: '' } });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Locations.create({ name: values.name, address: values.address || undefined });
      router.replace('/locations');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSubmitError(t('locations.errors.duplicate'));
      } else {
        setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      }
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('locations.new')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('locations.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="name">{t('locations.fields.name')}</Label>
              <Input id="name" aria-invalid={Boolean(errors.name)} {...register('name')} />
              {errors.name ? (
                <p className="text-xs text-destructive">{t('common.errors.required')}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">{t('locations.fields.address')}</Label>
              <Textarea id="address" rows={3} {...register('address')} />
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
