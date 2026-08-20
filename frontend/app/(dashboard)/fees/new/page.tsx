'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/api';
import { parseAmount } from '@/lib/utils';
import { listAll, Classes, Fees, Trainees, type ClassRow, type Trainee } from '@/lib/api-resources';
import { NativeSelect } from '@/components/ui/native-select';

const schema = z
  .object({
    classId: z.string().min(1),
    traineeId: z.string().min(1),
    amount: z.string(),
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    path: ['periodEnd'],
    message: 'endsBeforeStarts',
  })
  // Money stays a string in the schema — class-form.tsx documents why — so the numeric rule is a
  // refine rather than a coercion.
  .refine((v) => parseAmount(v.amount) !== null, {
    path: ['amount'],
    message: 'amount',
  });

type FormValues = z.infer<typeof schema>;

export default function NewFeePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listAll(Classes.list), listAll(Trainees.list)])
      .then(([c, tr]) => {
        setClasses(c);
        setTrainees(tr);
      })
      .catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      classId: '',
      traineeId: '',
      amount: '',
      periodStart: '',
      periodEnd: '',
      notes: '',
    },
  });

  // The class already carries its price — monthlyAmount for PER_MONTH, sessionPrice for
  // PER_SESSION, the same pairing FeesService's two generators use — and it arrives with the
  // select options, so leaving the amount blank made the trainer retype a number the browser
  // already had. Prefilled, not fixed: the field stays editable, and a class with no price for
  // its mode leaves whatever is there alone.
  const classId = useWatch({ control, name: 'classId' });
  useEffect(() => {
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return;
    const price = cls.billingMode === 'PER_MONTH' ? cls.monthlyAmount : cls.sessionPrice;
    if (price === null) return;
    // String(Number(...)) so '80.00' shows as 80, as the fee detail screen does.
    setValue('amount', String(Number(price)), { shouldValidate: true });
  }, [classId, classes, setValue]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    // zod rejected anything else already; this only narrows the type.
    const amt = parseAmount(values.amount);
    if (amt === null) return;
    try {
      await Fees.create({
        classId: values.classId,
        traineeId: values.traineeId,
        amount: amt,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        notes: values.notes || undefined,
      });
      router.replace('/fees');
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('fees.new')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('fees.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="classId">{t('fees.fields.class')}</Label>
              <NativeSelect
                id="classId"
                aria-invalid={Boolean(errors.classId)}
                {...register('classId')}
              >
                <option value="">—</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="traineeId">{t('fees.fields.trainee')}</Label>
              <NativeSelect
                id="traineeId"
                aria-invalid={Boolean(errors.traineeId)}
                {...register('traineeId')}
              >
                <option value="">—</option>
                {trainees.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.firstName} {tr.lastName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">{t('fees.fields.periodStart')}</Label>
                <Input id="periodStart" type="date" {...register('periodStart')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">{t('fees.fields.periodEnd')}</Label>
                <Input
                  id="periodEnd"
                  type="date"
                  aria-invalid={Boolean(errors.periodEnd)}
                  {...register('periodEnd')}
                />
                {errors.periodEnd?.message === 'endsBeforeStarts' ? (
                  <p className="text-xs text-destructive">{t('fees.errors.endsBeforeStarts')}</p>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">
                {t('fees.fields.amount')} ({t('fees.currency')})
              </Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                aria-invalid={Boolean(errors.amount)}
                {...register('amount')}
              />
              {errors.amount ? (
                <p className="text-xs text-destructive">{t('common.errors.amount')}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t('fees.fields.notes')}</Label>
              <Textarea id="notes" rows={3} {...register('notes')} />
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
