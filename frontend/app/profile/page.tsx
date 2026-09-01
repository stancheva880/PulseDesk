'use client';

import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { apiErrorMessage } from '@/lib/api';
import { Users } from '@/lib/api-resources';
import { useRequireRole } from '@/lib/use-require-role';

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'match',
  });

type FormValues = z.infer<typeof schema>;

// Reachable by every signed-in role — no dashboard sidebar or portal nav, since neither
// shell fits a page that isn't scoped to a role or a club. `useRequireRole(true, ...)`
// still bounces an anonymous visitor to /login; the `true` just means every role passes.
export default function ProfilePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, logout } = useAuth();
  const ready = useRequireRole(true, '/login');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: FormValues) => {
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('profile.changePassword.title')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('profile.changePassword.description')}
              </p>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="currentPassword">
                    {t('profile.changePassword.fields.currentPassword')}
                  </Label>
                  <div className="relative">
                    <PasswordInput
                      id="currentPassword"
                      autoComplete="current-password"
                      aria-invalid={Boolean(errors.currentPassword)}
                      aria-describedby={errors.currentPassword ? 'currentPassword-error' : undefined}
                      {...register('currentPassword')}
                    />
                  </div>
                  {errors.currentPassword ? (
                    <p id="currentPassword-error" className="text-xs text-destructive">
                      {t('profile.changePassword.errors.currentRequired')}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="newPassword">
                    {t('profile.changePassword.fields.newPassword')}
                  </Label>
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
        </div>
      </main>
    </div>
  );
}
