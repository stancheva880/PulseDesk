'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { stashToast } from '@/components/toast';
import { Tenants } from '@/lib/api-resources';
import { hardNavigate, writeTenantContext } from '@/lib/tenant-context';

// Onboarding a club: the club, its first location and its first administrator arrive together,
// because an ADMIN with no location reads empty lists (TKT-0054) and a club with no venue cannot
// hold a class. The route is SUPER_ADMIN-only — the dashboard layout denies the others.
// Same shape as the backend's CreateTenantDto, and linear for the same reason.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// TKT-0090: zod messages carry i18n keys; FieldError translates them.
const schema = z.object({
  name: z.string().trim().min(2, 'common.errors.required').max(120, 'common.errors.tooLong'),
  slug: z
    .string()
    .trim()
    .min(2, 'common.errors.required')
    .max(60, 'common.errors.tooLong')
    .regex(SLUG_PATTERN, 'tenants.errors.slugFormat'),
  locationName: z
    .string()
    .trim()
    .min(2, 'common.errors.required')
    .max(120, 'common.errors.tooLong'),
  locationAddress: z.string().trim().max(200, 'common.errors.tooLong').optional(),
  // TKT-0133: a club can be created with no administrator yet, and one assigned later from
  // Users — so this is optional, same shape as locationAddress above.
  adminEmail: z.union([z.string().trim().email('login.errors.email'), z.literal('')]).optional(),
  adminFirstName: z.string().trim().max(120, 'common.errors.tooLong').optional(),
  adminLastName: z.string().trim().max(120, 'common.errors.tooLong').optional(),
});
type FormValues = z.infer<typeof schema>;

export default function NewTenantPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set only when the club was created and its administrator's invite did not go out. The
  // club exists, so this is a warning with a recovery, never an error.
  const [undeliveredInvite, setUndeliveredInvite] = useState<{
    id: string;
    email: string;
    name: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      const created = await Tenants.create({
        name: values.name,
        slug: values.slug,
        locationName: values.locationName,
        locationAddress: values.locationAddress || undefined,
        adminEmail: values.adminEmail || undefined,
        adminFirstName: values.adminFirstName || undefined,
        adminLastName: values.adminLastName || undefined,
      });
      if (!created.notificationSent && values.adminEmail) {
        // Navigating away would take the only notice of the failure with it, and the
        // administrator cannot sign in until someone re-sends the invite.
        setUndeliveredInvite({ id: created.id, email: values.adminEmail, name: created.name });
        return;
      }
      enterClub(created.id, created.name);
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  // A full reload refetches the selector, so the new club is both listed and active without a
  // re-login.
  function enterClub(id: string, name: string) {
    // TKT-0092: hardNavigate discards the JS context, so the confirmation rides sessionStorage
    // and the next document's ToastViewport drains it on mount.
    stashToast({ text: t('tenants.createdToast', { name }), variant: 'success' });
    writeTenantContext(id);
    hardNavigate('/dashboard');
  }

  if (undeliveredInvite) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('tenants.new')}</h1>
        <Card>
          <CardHeader>
            <CardTitle>{t('tenants.inviteFailed.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('tenants.inviteFailed.body', { email: undeliveredInvite.email })}
            </p>
            <Button
              type="button"
              onClick={() => enterClub(undeliveredInvite.id, undeliveredInvite.name)}
            >
              {t('tenants.inviteFailed.continue')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('tenants.new')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('tenants.formTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('tenants.subtitle')}</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="name">{t('tenants.fields.name')}</Label>
              <Input
                id="name"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'name-error' : undefined}
                {...register('name')}
              />
              <FieldError id="name-error" messageKey={errors.name?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slug">{t('tenants.fields.slug')}</Label>
              <Input
                id="slug"
                aria-invalid={errors.slug ? true : undefined}
                aria-describedby={errors.slug ? 'slug-error' : undefined}
                {...register('slug')}
              />
              <p className="text-xs text-muted-foreground">{t('tenants.fields.slugHint')}</p>
              <FieldError id="slug-error" messageKey={errors.slug?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="locationName">{t('tenants.fields.locationName')}</Label>
              <Input
                id="locationName"
                aria-invalid={errors.locationName ? true : undefined}
                aria-describedby={errors.locationName ? 'locationName-error' : undefined}
                {...register('locationName')}
              />
              <FieldError id="locationName-error" messageKey={errors.locationName?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="locationAddress">{t('tenants.fields.locationAddress')}</Label>
              <Input
                id="locationAddress"
                aria-invalid={errors.locationAddress ? true : undefined}
                aria-describedby={errors.locationAddress ? 'locationAddress-error' : undefined}
                {...register('locationAddress')}
              />
              <FieldError id="locationAddress-error" messageKey={errors.locationAddress?.message} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="adminEmail">{t('tenants.fields.adminEmail')}</Label>
                <Input
                  id="adminEmail"
                  type="email"
                  aria-invalid={errors.adminEmail ? true : undefined}
                  aria-describedby={errors.adminEmail ? 'adminEmail-error' : undefined}
                  {...register('adminEmail')}
                />
                <FieldError id="adminEmail-error" messageKey={errors.adminEmail?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminFirstName">{t('tenants.fields.adminFirstName')}</Label>
                <Input
                  id="adminFirstName"
                  aria-invalid={errors.adminFirstName ? true : undefined}
                  aria-describedby={errors.adminFirstName ? 'adminFirstName-error' : undefined}
                  {...register('adminFirstName')}
                />
                <FieldError id="adminFirstName-error" messageKey={errors.adminFirstName?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminLastName">{t('tenants.fields.adminLastName')}</Label>
                <Input
                  id="adminLastName"
                  aria-invalid={errors.adminLastName ? true : undefined}
                  aria-describedby={errors.adminLastName ? 'adminLastName-error' : undefined}
                  {...register('adminLastName')}
                />
                <FieldError id="adminLastName-error" messageKey={errors.adminLastName?.message} />
              </div>
            </div>

            <SubmitError message={submitError} />

            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('common.saving') : t('common.save')}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/dashboard')}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
