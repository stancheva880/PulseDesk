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
import { apiErrorMessage } from '@/lib/api';
import { Tenants } from '@/lib/api-resources';
import { hardNavigate, writeTenantContext } from '@/lib/tenant-context';

// Onboarding a club: the club, its first location and its first administrator arrive together,
// because an ADMIN with no location reads empty lists (TKT-0054) and a club with no venue cannot
// hold a class. The route is SUPER_ADMIN-only — the dashboard layout denies the others.
// Same shape as the backend's CreateTenantDto, and linear for the same reason.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(60).regex(SLUG_PATTERN, 'slugFormat'),
  locationName: z.string().trim().min(2).max(120),
  locationAddress: z.string().trim().max(200).optional(),
  adminEmail: z.string().email(),
  adminFirstName: z.string().trim().max(120).optional(),
  adminLastName: z.string().trim().max(120).optional(),
});
type FormValues = z.infer<typeof schema>;

export default function NewTenantPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set only when the club was created and its administrator's invite did not go out. The
  // club exists, so this is a warning with a recovery, never an error.
  const [undeliveredInvite, setUndeliveredInvite] = useState<{ id: string; email: string } | null>(
    null,
  );

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
        adminEmail: values.adminEmail,
        adminFirstName: values.adminFirstName || undefined,
        adminLastName: values.adminLastName || undefined,
      });
      if (!created.notificationSent) {
        // Navigating away would take the only notice of the failure with it, and the
        // administrator cannot sign in until someone re-sends the invite.
        setUndeliveredInvite({ id: created.id, email: values.adminEmail });
        return;
      }
      enterClub(created.id);
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  // A full reload refetches the selector, so the new club is both listed and active without a
  // re-login.
  function enterClub(id: string) {
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
            <Button type="button" onClick={() => enterClub(undeliveredInvite.id)}>
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
              <Input id="name" {...register('name')} />
              {errors.name ? (
                <p className="text-sm text-destructive">{t('common.errors.required')}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slug">{t('tenants.fields.slug')}</Label>
              <Input id="slug" {...register('slug')} />
              <p className="text-xs text-muted-foreground">{t('tenants.fields.slugHint')}</p>
              {errors.slug ? (
                <p className="text-sm text-destructive">{t('tenants.errors.slugFormat')}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="locationName">{t('tenants.fields.locationName')}</Label>
              <Input id="locationName" {...register('locationName')} />
              {errors.locationName ? (
                <p className="text-sm text-destructive">{t('common.errors.required')}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="locationAddress">{t('tenants.fields.locationAddress')}</Label>
              <Input id="locationAddress" {...register('locationAddress')} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="adminEmail">{t('tenants.fields.adminEmail')}</Label>
                <Input id="adminEmail" type="email" {...register('adminEmail')} />
                {errors.adminEmail ? (
                  <p className="text-sm text-destructive">{t('login.errors.email')}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminFirstName">{t('tenants.fields.adminFirstName')}</Label>
                <Input id="adminFirstName" {...register('adminFirstName')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminLastName">{t('tenants.fields.adminLastName')}</Label>
                <Input id="adminLastName" {...register('adminLastName')} />
              </div>
            </div>

            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

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
