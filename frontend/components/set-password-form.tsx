'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { KeyRound, Loader2, Lock } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { ApiError } from '@/lib/api';
import { Auth } from '@/lib/api-resources';

const schema = z
  .object({
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'match',
  });

type FormValues = z.infer<typeof schema>;

interface SetPasswordFormProps {
  /** Heading (already translated). */
  title: string;
  /** Sub-heading (already translated). */
  description: string;
  /** Submit button label (already translated). */
  submitLabel: string;
  /** Shown on a 4xx — a used or expired token (already translated). */
  invalidLinkMessage: string;
}

/**
 * Shared set-a-password form behind a `[token]` route: /reset-password and /accept-invite.
 * Only the four strings above differ between them — field labels, validation messages and
 * the "request a new link" recovery path read the same either way, so they stay keyed to
 * `resetPassword.*` here.
 */
export function SetPasswordForm({
  title,
  description,
  submitLabel,
  invalidLinkMessage,
}: SetPasswordFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Auth.resetPassword({ token, newPassword: values.newPassword });
      router.replace('/login?reset=ok');
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setSubmitError(invalidLinkMessage);
      } else {
        setSubmitError(t('resetPassword.errors.generic'));
      }
    }
  };

  const confirmErrorKey =
    errors.confirmPassword?.message === 'match'
      ? 'resetPassword.errors.match'
      : 'resetPassword.errors.length';

  return (
    <AuthShell title={title} description={description}>
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="pd-rise" style={{ animationDelay: '.1s' }}>
          <Label htmlFor="newPassword">{t('resetPassword.fields.newPassword')}</Label>
          <div className="pd-field relative mt-1.5">
            <Lock className="pd-icon pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              className="h-11 pl-10"
              aria-invalid={Boolean(errors.newPassword)}
              aria-describedby={errors.newPassword ? 'newPassword-error' : undefined}
              {...register('newPassword')}
            />
          </div>
          {errors.newPassword ? (
            <p id="newPassword-error" className="mt-1.5 text-xs text-destructive">
              {t('resetPassword.errors.length')}
            </p>
          ) : null}
        </div>

        <div className="pd-rise" style={{ animationDelay: '.15s' }}>
          <Label htmlFor="confirmPassword">{t('resetPassword.fields.confirmPassword')}</Label>
          <div className="pd-field relative mt-1.5">
            <Lock className="pd-icon pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              className="h-11 pl-10"
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
              {...register('confirmPassword')}
            />
          </div>
          {errors.confirmPassword ? (
            <p id="confirmPassword-error" className="mt-1.5 text-xs text-destructive">
              {t(confirmErrorKey)}
            </p>
          ) : null}
        </div>

        {submitError ? (
          <div className="pd-rise space-y-2" role="alert">
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              {submitError}
            </p>
            <Link
              href="/forgot-password"
              className="inline-block text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
            >
              {t('resetPassword.requestNewLink')}
            </Link>
          </div>
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
                {t('resetPassword.submitting')}
              </>
            ) : (
              <>
                {submitLabel}
                <KeyRound className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
