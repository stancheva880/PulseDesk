'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, SubmitError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import { parseAmount } from '@/lib/utils';
import { listAll, Classes, Fees, Trainees, type ClassRow, type Trainee } from '@/lib/api-resources';
import { NativeSelect } from '@/components/ui/native-select';

// TKT-0090: zod messages carry i18n keys; FieldError translates them.
const schema = z
  .object({
    classId: z.string().min(1, 'common.errors.required'),
    traineeId: z.string().min(1, 'common.errors.required'),
    amount: z.string(),
    periodStart: z.string().min(1, 'common.errors.required'),
    periodEnd: z.string().min(1, 'common.errors.required'),
    notes: z.string().max(2000, 'common.errors.tooLong').optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    path: ['periodEnd'],
    message: 'fees.errors.endsBeforeStarts',
  })
  // Money stays a string in the schema — class-form.tsx documents why — so the numeric rule is a
  // refine rather than a coercion.
  .refine((v) => parseAmount(v.amount) !== null, {
    path: ['amount'],
    message: 'common.errors.amount',
  });

type FormValues = z.infer<typeof schema>;

// initialClassId / initialTraineeId are the page's ?classId= / ?traineeId= —
// contextual-create prefills (TKT-0091).
function NewFeeForm({
  initialClassId,
  initialTraineeId,
}: {
  initialClassId?: string;
  initialTraineeId?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
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

  // The query-parameter parents, kept only when they are in the tenant-scoped lists — a
  // malformed or foreign id is simply absent, so a bad link degrades to no selection (TKT-0091).
  const prefilledClassId =
    initialClassId && classes.some((c) => c.id === initialClassId) ? initialClassId : '';
  const prefilledTraineeId =
    initialTraineeId && trainees.some((tr) => tr.id === initialTraineeId) ? initialTraineeId : '';

  useEffect(() => {
    Promise.all([listAll(Classes.list), listAll(Trainees.list)])
      .then(([c, tr]) => {
        setClasses(c);
        setTrainees(tr);
      })
      .catch(() => undefined);
  }, []);

  // Apply the prefills after the options render: setting a native select to a value with no
  // matching <option> is silently ignored, so this cannot live in the fetch handler above.
  useEffect(() => {
    if (prefilledClassId) setValue('classId', prefilledClassId);
    if (prefilledTraineeId) setValue('traineeId', prefilledTraineeId);
  }, [prefilledClassId, prefilledTraineeId, setValue]);

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
      showToast({ text: t('common.savedToast'), variant: 'success' });
      // TKT-0092: stay on the form, ready for the next record — the query-parameter parents
      // survive the reset. The amount is re-primed here directly: the watch effect above only
      // fires when classId *changes*, and the reset restores the same class.
      const cls = classes.find((c) => c.id === prefilledClassId);
      const price = cls
        ? cls.billingMode === 'PER_MONTH'
          ? cls.monthlyAmount
          : cls.sessionPrice
        : null;
      reset({
        classId: prefilledClassId,
        traineeId: prefilledTraineeId,
        amount: price == null ? '' : String(Number(price)),
        periodStart: '',
        periodEnd: '',
        notes: '',
      });
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
                aria-invalid={errors.classId ? true : undefined}
                aria-describedby={errors.classId ? 'classId-error' : undefined}
                {...register('classId')}
              >
                <option value="">—</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <FieldError id="classId-error" messageKey={errors.classId?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="traineeId">{t('fees.fields.trainee')}</Label>
              <NativeSelect
                id="traineeId"
                aria-invalid={errors.traineeId ? true : undefined}
                aria-describedby={errors.traineeId ? 'traineeId-error' : undefined}
                {...register('traineeId')}
              >
                <option value="">—</option>
                {trainees.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.firstName} {tr.lastName}
                  </option>
                ))}
              </NativeSelect>
              <FieldError id="traineeId-error" messageKey={errors.traineeId?.message} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">{t('fees.fields.periodStart')}</Label>
                <Input
                  id="periodStart"
                  type="date"
                  aria-invalid={errors.periodStart ? true : undefined}
                  aria-describedby={errors.periodStart ? 'periodStart-error' : undefined}
                  {...register('periodStart')}
                />
                <FieldError id="periodStart-error" messageKey={errors.periodStart?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">{t('fees.fields.periodEnd')}</Label>
                <Input
                  id="periodEnd"
                  type="date"
                  aria-invalid={errors.periodEnd ? true : undefined}
                  aria-describedby={errors.periodEnd ? 'periodEnd-error' : undefined}
                  {...register('periodEnd')}
                />
                <FieldError id="periodEnd-error" messageKey={errors.periodEnd?.message} />
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
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? 'amount-error' : undefined}
                {...register('amount')}
              />
              <FieldError id="amount-error" messageKey={errors.amount?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t('fees.fields.notes')}</Label>
              <Textarea
                id="notes"
                rows={3}
                aria-invalid={errors.notes ? true : undefined}
                aria-describedby={errors.notes ? 'notes-error' : undefined}
                {...register('notes')}
              />
              <FieldError id="notes-error" messageKey={errors.notes?.message} />
            </div>
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
        </CardContent>
      </Card>
    </div>
  );
}

// Reads ?classId= and ?traineeId=. Isolated + Suspense-wrapped so useSearchParams() doesn't
// force the whole page out of static prerendering (Next.js CSR-bailout requirement).
function NewFeeFormFromParams() {
  const params = useSearchParams();
  return (
    <NewFeeForm
      initialClassId={params.get('classId') ?? undefined}
      initialTraineeId={params.get('traineeId') ?? undefined}
    />
  );
}

export default function NewFeePage() {
  return (
    <Suspense fallback={null}>
      <NewFeeFormFromParams />
    </Suspense>
  );
}
