'use client';

import Link from 'next/link';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArrowLeft, Loader2, Mail, Send } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Auth } from '@/lib/api-resources';

const schema = z.object({
  email: z.string().trim().email(),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Auth.forgotPassword(values.email);
      setSubmitted(true);
    } catch {
      setSubmitError(t('forgotPassword.errors.generic'));
    }
  };

  return (
    <AuthShell title={t('forgotPassword.title')} description={t('forgotPassword.description')}>
      {submitted ? (
        <div className="pd-rise space-y-4">
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3.5 py-2.5 text-sm text-success"
          >
            {t('forgotPassword.success')}
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('forgotPassword.backToLogin')}
          </Link>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="pd-rise" style={{ animationDelay: '.1s' }}>
            <Label htmlFor="email">{t('forgotPassword.fields.email')}</Label>
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
                {t('forgotPassword.errors.email')}
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

          <div className="pd-rise space-y-4" style={{ animationDelay: '.15s' }}>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="group relative h-12 w-full overflow-hidden text-[15px] font-semibold shadow-[0_10px_30px_-8px_hsl(var(--primary)/0.6)]"
            >
              <span aria-hidden className="pd-shimmer" />
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('forgotPassword.submitting')}
                </>
              ) : (
                <>
                  {t('forgotPassword.submit')}
                  <Send className="h-4 w-4" />
                </>
              )}
            </Button>
            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('forgotPassword.backToLogin')}
              </Link>
            </div>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
