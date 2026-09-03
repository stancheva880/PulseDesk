'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FieldError, SubmitError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import { Tenants } from '@/lib/api-resources';

const paymentDetailsSchema = z.object({
  bankIban: z.string().trim().max(50).optional(),
  bankAccountHolder: z.string().trim().max(120).optional(),
  revolutHandle: z.string().trim().max(120).optional(),
  myposLink: z.union([z.string().trim().url('locations.errors.myposLink'), z.literal('')]).optional(),
  cashNote: z.string().trim().max(500).optional(),
});
type PaymentDetailsFormValues = z.infer<typeof paymentDetailsSchema>;

/**
 * TKT-0131: this used to be a tab on /profile — an admin's personal settings page, which read
 * oddly for a club-wide setting and had no obvious link to "the club I currently have active".
 * It's now its own menu item; the club it edits follows the Topbar's tenant selector (every
 * request already carries X-Tenant-Id — see lib/api.ts), so a SUPER_ADMIN running several
 * clubs switches the active one and sets different payment details for each.
 *
 * ADMIN or SUPER_ADMIN only — the nav item is role-gated (sidebar.tsx NAV_ITEMS) and
 * layout.tsx DENY_RULES bounces an EMPLOYEE off the route; the endpoint is
 * @Roles(ADMIN, SUPER_ADMIN) regardless, so the API is the real gate.
 */
export default function PaymentDetailsPage() {
  const { t } = useTranslation();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PaymentDetailsFormValues>({
    resolver: zodResolver(paymentDetailsSchema),
    defaultValues: {
      bankIban: '',
      bankAccountHolder: '',
      revolutHandle: '',
      myposLink: '',
      cashNote: '',
    },
  });

  useEffect(() => {
    Tenants.getPaymentDetails()
      .then((d) => {
        reset({
          bankIban: d.bankIban ?? '',
          bankAccountHolder: d.bankAccountHolder ?? '',
          revolutHandle: d.revolutHandle ?? '',
          myposLink: d.myposLink ?? '',
          cashNote: d.cashNote ?? '',
        });
        setLoaded(true);
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [reset]);

  const onSubmit = async (values: PaymentDetailsFormValues) => {
    setSubmitError(null);
    try {
      const asNullable = (v: string | undefined) => (v ? v : null);
      await Tenants.updatePaymentDetails({
        bankIban: asNullable(values.bankIban),
        bankAccountHolder: asNullable(values.bankAccountHolder),
        revolutHandle: asNullable(values.revolutHandle),
        myposLink: asNullable(values.myposLink),
        cashNote: asNullable(values.cashNote),
      });
      showToast({ text: t('common.savedToast'), variant: 'success' });
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('clubPaymentDetails.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('clubPaymentDetails.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('clubPaymentDetails.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
          {!loaded && !loadError ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : null}
          {loaded ? (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="club-bankIban">{t('locations.fields.bankIban')}</Label>
                <Input id="club-bankIban" {...register('bankIban')} />
                <FieldError id="club-bankIban-error" messageKey={errors.bankIban?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="club-bankAccountHolder">
                  {t('locations.fields.bankAccountHolder')}
                </Label>
                <Input id="club-bankAccountHolder" {...register('bankAccountHolder')} />
                <FieldError
                  id="club-bankAccountHolder-error"
                  messageKey={errors.bankAccountHolder?.message}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="club-revolutHandle">{t('locations.fields.revolutHandle')}</Label>
                <Input id="club-revolutHandle" {...register('revolutHandle')} />
                <FieldError
                  id="club-revolutHandle-error"
                  messageKey={errors.revolutHandle?.message}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="club-myposLink">{t('locations.fields.myposLink')}</Label>
                <Input
                  id="club-myposLink"
                  type="url"
                  placeholder="https://www.mypos.com/..."
                  {...register('myposLink')}
                />
                <FieldError id="club-myposLink-error" messageKey={errors.myposLink?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="club-cashNote">{t('locations.fields.cashNote')}</Label>
                <Input id="club-cashNote" {...register('cashNote')} />
                <FieldError id="club-cashNote-error" messageKey={errors.cashNote?.message} />
              </div>
              <SubmitError message={submitError} />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('common.saving') : t('common.save')}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
