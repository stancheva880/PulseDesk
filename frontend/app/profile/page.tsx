'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Topbar } from '@/components/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import { Users, type OwnProfile } from '@/lib/api-resources';
import { useRequireRole } from '@/lib/use-require-role';

// Reachable by every signed-in role — no dashboard sidebar or portal nav, since neither
// shell fits a page that isn't scoped to a role or a club. `useRequireRole(true, ...)`
// still bounces an anonymous visitor to /login; the `true` just means every role passes.
export default function ProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const ready = useRequireRole(true, '/login');

  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    Users.getOwnProfile()
      .then(setProfile)
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [ready]);

  if (!ready) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar />
      <main className="app-surface flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-lg space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('profile.title')}</h1>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>

          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
          {profile ? (
            <ProfileDetailsCard profile={profile} onSaved={setProfile} />
          ) : !loadError ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : null}

          <ChangePasswordCard />
        </div>
      </main>
    </div>
  );
}

const detailsSchema = z.object({
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email(),
  currentPassword: z.string().optional(),
});
type DetailsFormValues = z.infer<typeof detailsSchema>;

// firstName/lastName/phone save unconditionally; email only writes — and only then needs
// currentPassword — when it actually differs from what was loaded, same as the backend's own
// "unchanged email skips the password check" rule (users.service.ts:updateOwnProfile).
function ProfileDetailsCard({
  profile,
  onSaved,
}: {
  profile: OwnProfile;
  onSaved: (p: OwnProfile) => void;
}) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DetailsFormValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      phone: profile.phone ?? '',
      email: profile.email,
      currentPassword: '',
    },
  });

  const onSubmit = async (values: DetailsFormValues) => {
    setSubmitError(null);
    const emailChanged = values.email !== profile.email;
    if (emailChanged && !values.currentPassword) {
      setSubmitError(t('profile.details.errors.currentPasswordRequired'));
      return;
    }
    try {
      const updated = await Users.updateOwnProfile({
        firstName: values.firstName || null,
        lastName: values.lastName || null,
        phone: values.phone || null,
        ...(emailChanged
          ? { email: values.email, currentPassword: values.currentPassword }
          : {}),
      });
      showToast({ text: t('common.savedToast'), variant: 'success' });
      onSaved(updated);
      reset({
        firstName: updated.firstName ?? '',
        lastName: updated.lastName ?? '',
        phone: updated.phone ?? '',
        email: updated.email,
        currentPassword: '',
      });
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('profile.details.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">{t('users.fields.firstName')}</Label>
              <Input id="firstName" {...register('firstName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">{t('users.fields.lastName')}</Label>
              <Input id="lastName" {...register('lastName')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">{t('users.fields.phone')}</Label>
            <Input id="phone" type="tel" {...register('phone')} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">{t('users.fields.email')}</Label>
            <Input
              id="email"
              type="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email ? (
              <p id="email-error" className="text-xs text-destructive">
                {t('profile.details.errors.email')}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">
              {t('profile.changePassword.fields.currentPassword')}
            </Label>
            <div className="relative">
              <PasswordInput
                id="currentPassword"
                autoComplete="current-password"
                {...register('currentPassword')}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('profile.details.currentPasswordHint')}</p>
          </div>

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'match',
  });
type PasswordFormValues = z.infer<typeof passwordSchema>;

function ChangePasswordCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { logout } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: PasswordFormValues) => {
    setSubmitError(null);
    try {
      await Users.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // The backend just revoked every refresh token, this session's included — logout()
      // clears local state to match rather than leave a client that thinks it is still
      // signed in. Same success banner as reset-password: both end with "sign in again".
      await logout();
      router.replace('/login?reset=ok');
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  const confirmErrorKey =
    errors.confirmPassword?.message === 'match'
      ? 'profile.changePassword.errors.match'
      : 'profile.changePassword.errors.length';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('profile.changePassword.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('profile.changePassword.description')}</p>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="pw-currentPassword">
              {t('profile.changePassword.fields.currentPassword')}
            </Label>
            <div className="relative">
              <PasswordInput
                id="pw-currentPassword"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.currentPassword)}
                aria-describedby={errors.currentPassword ? 'pw-currentPassword-error' : undefined}
                {...register('currentPassword')}
              />
            </div>
            {errors.currentPassword ? (
              <p id="pw-currentPassword-error" className="text-xs text-destructive">
                {t('profile.changePassword.errors.currentRequired')}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">{t('profile.changePassword.fields.newPassword')}</Label>
            <div className="relative">
              <PasswordInput
                id="newPassword"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.newPassword)}
                aria-describedby={errors.newPassword ? 'newPassword-error' : undefined}
                {...register('newPassword')}
              />
            </div>
            {errors.newPassword ? (
              <p id="newPassword-error" className="text-xs text-destructive">
                {t('profile.changePassword.errors.length')}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">
              {t('profile.changePassword.fields.confirmPassword')}
            </Label>
            <div className="relative">
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
                {...register('confirmPassword')}
              />
            </div>
            {errors.confirmPassword ? (
              <p id="confirmPassword-error" className="text-xs text-destructive">
                {t(confirmErrorKey)}
              </p>
            ) : null}
          </div>

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('profile.changePassword.submitting')}
              </>
            ) : (
              t('profile.changePassword.submit')
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
