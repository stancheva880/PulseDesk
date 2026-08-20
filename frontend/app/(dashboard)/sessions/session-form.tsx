'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/api';
import {
  Classes,
  Locations,
  Sessions,
  Users,
  type ClassRow,
  type Location,
  type SessionDetail,
  type SessionStatus,
  listAll,
} from '@/lib/api-resources';

// TKT-0082: trainers are searched, not downloaded — same contract as the class form's picker.
const TRAINER_PAGE = 10;
const personLabel = (u: { firstName: string | null; lastName: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
const searchTrainers = async (query: string): Promise<ComboboxOption[]> => {
  const page = await Users.list({
    role: 'EMPLOYEE',
    pageSize: TRAINER_PAGE,
    ...(query ? { search: query } : {}),
  });
  return page.items.map((u) => ({ id: u.id, label: personLabel(u) }));
};
import { NativeSelect } from '@/components/ui/native-select';
import { ChipsCombobox, type ComboboxOption } from '@/components/ui/chips-combobox';

const SESSION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const satisfies readonly SessionStatus[];

// `datetime-local` produces "YYYY-MM-DDTHH:MM" without a timezone — we treat it as
// local time and convert to a full ISO string at submit time. Backend stores UTC.
// classId is create-only (a session can't move to another class); status is edit-only.
const baseSchema = z.object({
  classId: z.string(),
  locationId: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  status: z.enum(SESSION_STATUSES),
  trainerIds: z.array(z.string()),
  notes: z.string().max(2000).optional(),
});

const endAfterStart = {
  path: ['endsAt'] as ['endsAt'],
  message: 'endsBeforeStarts',
};
const createSchema = baseSchema
  .extend({ classId: z.string().min(1) })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), endAfterStart);
const editSchema = baseSchema.refine(
  (v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(),
  endAfterStart,
);

type FormValues = z.infer<typeof baseSchema>;

function isoToLocal(iso: string): string {
  // Render the existing UTC time as a local "datetime-local" value (no seconds, no TZ).
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(local: string): string {
  return new Date(local).toISOString();
}

// id comes from the edit page's route params; create mode has none.
export function SessionForm({ mode, id = '' }: { mode: 'create' | 'edit'; id?: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [trainerSeed, setTrainerSeed] = useState<ComboboxOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(mode === 'create' ? createSchema : editSchema),
    defaultValues: {
      classId: '',
      locationId: '',
      startsAt: '',
      endsAt: '',
      status: 'SCHEDULED',
      trainerIds: [],
      notes: '',
    },
  });

  useEffect(() => {
    if (mode === 'create') {
      Promise.all([listAll(Classes.list), listAll(Locations.list)])
        .then(([c, l]) => {
          setClasses(c);
          setLocations(l);
        })
        .catch(() => {
          setClasses([]);
          setLocations([]);
        });
      return;
    }
    Promise.all([Sessions.get(id), listAll(Locations.list)])
      .then(([detail, locs]) => {
        setSession(detail);
        setLocations(locs);
        // Chips seed from the session, not from a search — a trainer the search cannot reach
        // still renders and still saves.
        setTrainerSeed(detail.trainers.map((tr) => ({ id: tr.id, label: personLabel(tr) })));
        reset({
          classId: detail.classId,
          locationId: detail.locationId,
          startsAt: isoToLocal(detail.startsAt),
          endsAt: isoToLocal(detail.endsAt),
          status: detail.status,
          trainerIds: detail.trainers.map((tr) => tr.id),
          notes: detail.notes ?? '',
        });
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [mode, id, reset]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      if (mode === 'create') {
        await Sessions.create({
          classId: values.classId,
          locationId: values.locationId,
          startsAt: localToIso(values.startsAt),
          endsAt: localToIso(values.endsAt),
          trainerIds: values.trainerIds.length ? values.trainerIds : undefined,
          notes: values.notes || undefined,
        });
      } else {
        await Sessions.update(id, {
          locationId: values.locationId,
          startsAt: localToIso(values.startsAt),
          endsAt: localToIso(values.endsAt),
          status: values.status,
          trainerIds: values.trainerIds,
          notes: values.notes || undefined,
        });
      }
      router.replace('/sessions');
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  const ready = mode === 'create' || session !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t(mode === 'create' ? 'sessions.new' : 'sessions.edit')}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('sessions.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              {mode === 'create' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="classId">{t('sessions.fields.class')}</Label>
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
              ) : (
                <div className="space-y-1.5">
                  <Label>{t('sessions.fields.class')}</Label>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {session!.class.name}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="locationId">{t('sessions.fields.location')}</Label>
                <NativeSelect
                  id="locationId"
                  aria-invalid={Boolean(errors.locationId)}
                  {...register('locationId')}
                >
                  {mode === 'create' ? <option value="">—</option> : null}
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="startsAt">{t('sessions.fields.startsAt')}</Label>
                  <Input
                    id="startsAt"
                    type="datetime-local"
                    aria-invalid={Boolean(errors.startsAt)}
                    {...register('startsAt')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endsAt">{t('sessions.fields.endsAt')}</Label>
                  <Input
                    id="endsAt"
                    type="datetime-local"
                    aria-invalid={Boolean(errors.endsAt)}
                    {...register('endsAt')}
                  />
                  {errors.endsAt?.message === 'endsBeforeStarts' ? (
                    <p className="text-xs text-destructive">
                      {t('sessions.errors.endsBeforeStarts')}
                    </p>
                  ) : null}
                </div>
              </div>

              {mode === 'edit' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="status">{t('sessions.fields.status')}</Label>
                  <NativeSelect
                    id="status"
                    {...register('status')}
                  >
                    {SESSION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`sessions.status.${s}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t('sessions.fields.trainers')}</legend>
                <p className="text-xs text-muted-foreground">{t('sessions.fields.trainersHint')}</p>
                <Controller<FormValues, 'trainerIds'>
                  name="trainerIds"
                  control={control}
                  render={({ field }) => (
                    <ChipsCombobox
                      id="trainerIds"
                      value={field.value ?? []}
                      onChange={field.onChange}
                      search={searchTrainers}
                      selected={trainerSeed}
                      placeholder={t('common.search.person')}
                      noMatchesLabel={t('common.search.noMatches')}
                      emptyLabel={t('sessions.fields.noTrainers')}
                    />
                  )}
                />
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="notes">{t('sessions.fields.notes')}</Label>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
