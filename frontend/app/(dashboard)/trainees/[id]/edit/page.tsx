'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import {
  Classes,
  Contacts,
  Locations,
  Trainees,
  type ClassRow,
  type ContactPerson,
  type ContactRelationship,
  type Location,
  type TraineeDetail,
} from '@/lib/api-resources';

const RELATIONSHIPS = ['PARENT', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER'] as const;

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().min(1),
  phone: z.string().trim().max(50).optional(),
  email: z
    .union([z.string().trim().email().max(255), z.literal('').transform(() => undefined)])
    .optional(),
  notes: z.string().trim().max(2000).optional(),
  locationIds: z.array(z.string()),
  classIds: z.array(z.string()),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export default function EditTraineePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [trainee, setTrainee] = useState<TraineeDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [contacts, setContacts] = useState<ContactPerson[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      locationIds: [],
      classIds: [],
      isActive: true,
    },
  });

  const reload = () => {
    Promise.all([Trainees.get(id), Locations.list(), Classes.list()])
      .then(([detail, locs, cls]) => {
        setTrainee(detail);
        setLocations(locs);
        setClasses(cls);
        setContacts(detail.contacts);
        reset({
          firstName: detail.firstName,
          lastName: detail.lastName,
          dateOfBirth: detail.dateOfBirth.slice(0, 10),
          phone: detail.phone ?? '',
          email: detail.email ?? '',
          notes: detail.notes ?? '',
          locationIds: detail.locations.map((l) => l.id),
          classIds: detail.classes.map((c) => c.id),
          isActive: detail.isActive,
        });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'load failed'));
  };

  useEffect(reload, [id]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Trainees.update(id, {
        firstName: values.firstName,
        lastName: values.lastName,
        dateOfBirth: values.dateOfBirth,
        phone: values.phone || undefined,
        email: values.email || undefined,
        notes: values.notes || undefined,
        locationIds: values.locationIds,
        classIds: values.classIds,
        isActive: values.isActive,
      });
      router.replace('/trainees');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('trainees.edit')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('trainees.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !trainee ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">{t('trainees.fields.firstName')}</Label>
                  <Input id="firstName" {...register('firstName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">{t('trainees.fields.lastName')}</Label>
                  <Input id="lastName" {...register('lastName')} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dateOfBirth">{t('trainees.fields.dateOfBirth')}</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  aria-invalid={Boolean(errors.dateOfBirth)}
                  {...register('dateOfBirth')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">{t('trainees.fields.phone')}</Label>
                  <Input id="phone" {...register('phone')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t('trainees.fields.email')}</Label>
                  <Input id="email" type="email" {...register('email')} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">{t('trainees.fields.notes')}</Label>
                <Textarea id="notes" rows={3} {...register('notes')} />
              </div>
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  {t('trainees.fields.locations')}
                </legend>
                {locations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('classes.noLocations')}</p>
                ) : (
                  <ul className="space-y-1">
                    {locations.map((loc) => (
                      <li key={loc.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            value={loc.id}
                            className="size-4"
                            {...register('locationIds')}
                          />
                          {loc.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  {t('trainees.fields.classes')}
                </legend>
                {classes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('trainees.noClasses')}</p>
                ) : (
                  <ul className="space-y-1">
                    {classes.map((cls) => (
                      <li key={cls.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            value={cls.id}
                            className="size-4"
                            {...register('classIds')}
                          />
                          {cls.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isActive')} className="size-4" />
                {t('trainees.fields.active')}
              </label>
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

      {trainee ? (
        <ContactsSection traineeId={id} contacts={contacts} onChange={reload} />
      ) : null}
    </div>
  );
}

function ContactsSection({
  traineeId,
  contacts,
  onChange,
}: {
  traineeId: string;
  contacts: ContactPerson[];
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const [form, setForm] = useState<{
    firstName: string;
    lastName: string;
    relationship: ContactRelationship;
    phone: string;
    email: string;
    isPrimary: boolean;
  }>({ firstName: '', lastName: '', relationship: 'PARENT', phone: '', email: '', isPrimary: false });

  const submit = async () => {
    setError(null);
    try {
      await Contacts.create(traineeId, {
        firstName: form.firstName,
        lastName: form.lastName,
        relationship: form.relationship,
        phone: form.phone || undefined,
        email: form.email || undefined,
        isPrimary: form.isPrimary,
      });
      setForm({
        firstName: '',
        lastName: '',
        relationship: 'PARENT',
        phone: '',
        email: '',
        isPrimary: false,
      });
      setShowForm(false);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  const onConfirmRemove = async () => {
    if (!pendingDeleteId) return;
    setDelBusy(true);
    try {
      await Contacts.remove(traineeId, pendingDeleteId);
      setPendingDeleteId(null);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      setPendingDeleteId(null);
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('trainees.contacts.legend')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('trainees.contacts.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded border bg-muted/30 p-3"
              >
                <div className="text-sm">
                  <div>
                    <span className="font-medium">
                      {c.firstName} {c.lastName}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t(`trainees.contacts.relationships.${c.relationship}`)}
                    </span>
                    {c.isPrimary ? (
                      <Badge variant="warning" className="ml-2">
                        {t('trainees.contacts.primary')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[c.phone, c.email].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setPendingDeleteId(c.id)}
                >
                  {t('common.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {showForm ? (
          <div className="space-y-2 rounded border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder={t('trainees.contacts.firstName')}
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
              <Input
                placeholder={t('trainees.contacts.lastName')}
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                value={form.relationship}
                onChange={(e) =>
                  setForm({ ...form, relationship: e.target.value as ContactRelationship })
                }
              >
                {(['PARENT', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER'] as const).map((r) => (
                  <option key={r} value={r}>
                    {t(`trainees.contacts.relationships.${r}`)}
                  </option>
                ))}
              </select>
              <Input
                placeholder={t('trainees.contacts.phone')}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <Input
                type="email"
                placeholder={t('trainees.contacts.email')}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-4"
                checked={form.isPrimary}
                onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
              />
              {t('trainees.contacts.primary')}
            </label>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void submit()}>
                {t('common.save')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            {t('trainees.contacts.add')}
          </Button>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title={t('trainees.contacts.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onConfirmRemove}
        busy={delBusy}
      />
    </Card>
  );
}
