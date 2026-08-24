'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, SubmitError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import { parseAmount } from '@/lib/utils';
import { listAll, Cards, Classes, Trainees, type ClassRow, type Trainee } from '@/lib/api-resources';
import { NativeSelect } from '@/components/ui/native-select';

// Unlike fees, a card may be free — 0 is a valid price, which parseAmount rejects.
function parsePrice(raw: string): number | null {
  const n = parseAmount(raw);
  if (n !== null) return n;
  return /^0(\.0{1,2})?$/.test(raw.trim()) ? 0 : null;
}

// TKT-0090: zod messages carry i18n keys; FieldError translates them.
const schema = z.object({
  traineeId: z.string().min(1, 'common.errors.required'),
  // Empty = tenant-wide card (any class in the club).
  classId: z.string().optional(),
  totalVisits: z.string().regex(/^[1-9]\d*$/, 'cards.errors.visits'),
  price: z.string().refine((v) => parsePrice(v) !== null, 'common.errors.amount'),
  expiresAt: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// initialTraineeId is the page's ?traineeId= — contextual-create prefill (TKT-0091).
function NewCardForm({ initialTraineeId }: { initialTraineeId?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { traineeId: '', classId: '', totalVisits: '', price: '', expiresAt: '' },
  });

  // The query-parameter parent, kept only when it is in the tenant-scoped list — a
  // malformed or foreign id is simply absent, so a bad link degrades to no selection.
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

  // Applied after the options render: setting a native select to a value with no
  // matching <option> is silently ignored.
  useEffect(() => {
    if (prefilledTraineeId) setValue('traineeId', prefilledTraineeId);
  }, [prefilledTraineeId, setValue]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    // zod rejected anything else already; this only narrows the type.
    const price = parsePrice(values.price);
    if (price === null) return;
    try {
      await Cards.create({
        traineeId: values.traineeId,
        classId: values.classId || undefined,
        totalVisits: Number(values.totalVisits),
        price,
        expiresAt: values.expiresAt || undefined,
      });
      showToast({ text: t('common.savedToast'), variant: 'success' });
      // TKT-0092: stay on the form, ready for the next sale.
      reset({ traineeId: prefilledTraineeId, classId: '', totalVisits: '', price: '', expiresAt: '' });
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('cards.new')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('cards.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="traineeId">{t('cards.fields.trainee')}</Label>
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
            <div className="space-y-1.5">
              <Label htmlFor="classId">{t('cards.fields.scope')}</Label>
              <NativeSelect id="classId" {...register('classId')}>
                <option value="">{t('cards.wholeClub')}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="totalVisits">{t('cards.fields.totalVisits')}</Label>
                <Input
                  id="totalVisits"
                  type="number"
                  min="1"
                  step="1"
                  aria-invalid={errors.totalVisits ? true : undefined}
                  aria-describedby={errors.totalVisits ? 'totalVisits-error' : undefined}
                  {...register('totalVisits')}
                />
                <FieldError id="totalVisits-error" messageKey={errors.totalVisits?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">
                  {t('cards.fields.price')} ({t('fees.currency')})
                </Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  aria-invalid={errors.price ? true : undefined}
                  aria-describedby={errors.price ? 'price-error' : undefined}
                  {...register('price')}
                />
                <FieldError id="price-error" messageKey={errors.price?.message} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiresAt">{t('cards.fields.expiresAt')}</Label>
              <Input id="expiresAt" type="date" {...register('expiresAt')} />
              <p className="text-xs text-muted-foreground">{t('cards.expiryHint')}</p>
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

// Reads ?traineeId=. Isolated + Suspense-wrapped so useSearchParams() doesn't force the
// whole page out of static prerendering (Next.js CSR-bailout requirement).
function NewCardFormFromParams() {
  const params = useSearchParams();
  return <NewCardForm initialTraineeId={params.get('traineeId') ?? undefined} />;
}

export default function NewCardPage() {
  return (
    <Suspense fallback={null}>
      <NewCardFormFromParams />
    </Suspense>
  );
}
