'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArrowRight, Loader2, Lock, Mail } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { ApiError } from '@/lib/api';
import { homePathForRole } from '@/lib/role-redirect';

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(255),
});

type FormValues = z.infer<typeof schema>;

// Reads ?reset=ok. Isolated + Suspense-wrapped so useSearchParams() doesn't force
// the whole page out of static prerendering (Next.js CSR-bailout requirement).
function ResetBanner() {
  const { t } = useTranslation();
  const params = useSearchParams();
  if (params.get('reset') !== 'ok') return null;
  return (
    <p
      role="status"
      className="pd-rise mb-5 flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3.5 py-2.5 text-sm text-success"
    >
      {t('login.resetSuccess')}
    </p>
  );
}

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { login, status, user } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(homePathForRole(user.role));
  }, [status, user, router]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await login({ email: values.email, password: values.password });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setSubmitError(t('login.errors.invalid'));
      } else {
        setSubmitError(t('login.errors.generic'));
      }
    }
  };

  return (
    <AuthShell title={t('login.title')} description={t('login.description')}>
      <Suspense fallback={null}>
        <ResetBanner />
      </Suspense>

      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Email */}
        <div className="pd-rise" style={{ animationDelay: '.1s' }}>
          <Label htmlFor="email">{t('login.fields.email')}</Label>
          <div className="pd-field relative mt-1.5">
            <Mail className="pd-icon pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              className="h-11 pl-10"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
          </div>
          {errors.email ? (
            <p id="email-error" className="mt-1.5 text-xs text-destructive">
              {t('login.errors.email')}
            </p>
          ) : null}
        </div>

        {/* Password */}
        <div className="pd-rise" style={{ animationDelay: '.15s' }}>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t('login.fields.password')}</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
            >
              {t('login.forgotPassword')}
            </Link>
          </div>
          <div className="pd-field relative mt-1.5">
            <Lock className="pd-icon pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <PasswordInput
              id="password"
              autoComplete="current-password"
              className="h-11 pl-10"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
          </div>
          {errors.password ? (
            <p id="password-error" className="mt-1.5 text-xs text-destructive">
              {t('login.errors.password')}
            </p>
          ) : null}
        </div>

        {submitError ? (
          <p
            role="alert"
            className="pd-rise rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
          >
            {submitError}
          </p>
        ) : null}

        <div className="pd-rise" style={{ animationDelay: '.2s' }}>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="group relative h-12 w-full overflow-hidden text-[15px] font-semibold shadow-[0_10px_30px_-8px_hsl(var(--primary)/0.6)]"
          >
            <span aria-hidden className="pd-shimmer" />
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('login.submitting')}
              </>
            ) : (
              <>
                {t('login.submit')}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
