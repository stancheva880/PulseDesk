'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuth } from '@/components/auth-provider';
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
  bankIban: z.string().trim().max(50, 'common.errors.tooLong').optional(),
  bankAccountHolder: z.string().trim().max(120, 'common.errors.tooLong').optional(),
  revolutHandle: z.string().trim().max(120, 'common.errors.tooLong').optional(),
  paypalEmail: z.union([z.string().trim().email('locations.errors.paypalEmail'), z.literal('')]).optional(),
  cashNote: z.string().trim().max(500, 'common.errors.tooLong').optional(),
});
type FormValues = z.infer<typeof schema>;

const EMPTY_PAYMENT = {
  bankIban: '',
  bankAccountHolder: '',
  revolutHandle: '',
  paypalEmail: '',
  cashNote: '',
};

function hasAnyPaymentDetail(v: typeof EMPTY_PAYMENT): boolean {
  return Object.values(v).some((x) => x !== '');
}

// Sends null for a field that was cleared back to empty, the value otherwise, undefined for
// a field never touched — matches the DTO's independently-clearable contract.
function paymentPayload(values: FormValues) {
  const asNullable = (v: string | undefined) => (v ? v : null);
  return {
    bankIban: asNullable(values.bankIban),
    bankAccountHolder: asNullable(values.bankAccountHolder),
    revolutHandle: asNullable(values.revolutHandle),
    paypalEmail: asNullable(values.paypalEmail),
    cashNote: asNullable(values.cashNote),
  };
}

// id comes from the edit page's route params; create mode has none.
export function LocationForm({ mode, id = '' }: { mode: 'create' | 'edit'; id?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  // TKT-0128: create is still SUPER_ADMIN-only (layout.tsx DENY_RULES); edit is now reachable
  // by an ADMIN too, but only for the payment-details section below — name/address/isActive
  // stay a SUPER_ADMIN concern.
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const showFullForm = mode === 'create' || isSuperAdmin;

  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locationName, setLocationName] = useState('');
  // Collapsed by default when the location has no override yet — "no need to fill in the
  // data for every location if it's the same" — expanded automatically once it does, or when
  // the admin presses the "add" button below.
  const [paymentOpen, setPaymentOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', address: '', isActive: true, ...EMPTY_PAYMENT },
  });

  useEffect(() => {
    if (mode !== 'edit') return;
    Locations.get(id)
      .then((loc) => {
        setLocationName(loc.name);
        const payment = {
          bankIban: loc.bankIban ?? '',
          bankAccountHolder: loc.bankAccountHolder ?? '',
          revolutHandle: loc.revolutHandle ?? '',
          paypalEmail: loc.paypalEmail ?? '',
          cashNote: loc.cashNote ?? '',
        };
        setPaymentOpen(hasAnyPaymentDetail(payment));
        reset({ name: loc.name, address: loc.address ?? '', isActive: loc.isActive, ...payment });
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [mode, id, reset]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      if (mode === 'create') {
        await Locations.create({ name: values.name, address: values.address || undefined });
      } else {
        if (isSuperAdmin) {
          await Locations.update(id, {
            name: values.name,
            address: values.address || undefined,
            isActive: values.isActive,
          });
        }
        if (paymentOpen) {
          await Locations.updatePaymentDetails(id, paymentPayload(values));
        }
      }
      // TKT-0092: stay on the form; create resets ready for the next record.
      if (mode === 'create') reset({ name: '', address: '', isActive: true, ...EMPTY_PAYMENT });
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

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
          {showFullForm ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('locations.formTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">{locationName}</p>
          )}

          {mode === 'edit' ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('locations.paymentDetails.title')}</CardTitle>
                <p className="text-sm text-muted-foreground">{t('locations.paymentDetails.hint')}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {paymentOpen ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="bankIban">{t('locations.fields.bankIban')}</Label>
                      <Input
                        id="bankIban"
                        aria-invalid={errors.bankIban ? true : undefined}
                        aria-describedby={errors.bankIban ? 'bankIban-error' : undefined}
                        {...register('bankIban')}
                      />
                      <FieldError id="bankIban-error" messageKey={errors.bankIban?.message} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bankAccountHolder">
                        {t('locations.fields.bankAccountHolder')}
                      </Label>
                      <Input
                        id="bankAccountHolder"
                        aria-invalid={errors.bankAccountHolder ? true : undefined}
                        aria-describedby={
                          errors.bankAccountHolder ? 'bankAccountHolder-error' : undefined
                        }
                        {...register('bankAccountHolder')}
                      />
                      <FieldError
                        id="bankAccountHolder-error"
                        messageKey={errors.bankAccountHolder?.message}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="revolutHandle">{t('locations.fields.revolutHandle')}</Label>
                      <Input
                        id="revolutHandle"
                        aria-invalid={errors.revolutHandle ? true : undefined}
                        aria-describedby={errors.revolutHandle ? 'revolutHandle-error' : undefined}
                        {...register('revolutHandle')}
                      />
                      <FieldError
                        id="revolutHandle-error"
                        messageKey={errors.revolutHandle?.message}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="paypalEmail">{t('locations.fields.paypalEmail')}</Label>
                      <Input
                        id="paypalEmail"
                        type="email"
                        aria-invalid={errors.paypalEmail ? true : undefined}
                        aria-describedby={errors.paypalEmail ? 'paypalEmail-error' : undefined}
                        {...register('paypalEmail')}
                      />
                      <FieldError id="paypalEmail-error" messageKey={errors.paypalEmail?.message} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cashNote">{t('locations.fields.cashNote')}</Label>
                      <Textarea
                        id="cashNote"
                        rows={2}
                        aria-invalid={errors.cashNote ? true : undefined}
                        aria-describedby={errors.cashNote ? 'cashNote-error' : undefined}
                        {...register('cashNote')}
                      />
                      <FieldError id="cashNote-error" messageKey={errors.cashNote?.message} />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPaymentOpen(false);
                        reset((prev) => ({ ...prev, ...EMPTY_PAYMENT }));
                      }}
                    >
                      {t('locations.paymentDetails.remove')}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setPaymentOpen(true)}>
                    {t('locations.paymentDetails.add')}
                  </Button>
                )}
              </CardContent>
            </Card>
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
    </div>
  );
}
