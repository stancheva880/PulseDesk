'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiErrorMessage } from '@/lib/api';
import {
  Classes,
  Contacts,
  Locations,
  Trainees,
  Users,
  type ContactPerson,
  type ContactRelationship,
  type Location,
  type TraineeDetail,
  type UserRow,
  listAll,
} from '@/lib/api-resources';

// Customer accounts, from the server: the linked account and the guardians both come from this
// one role. One helper so the create and the edit branch cannot ask for different things.
// Still whole-table: the linked-account single select below needs every customer, and swapping it
// for a searchable single select is deliberately out of scope (PRD-0011 §9).
const listCustomers = () => listAll((p) => Users.list({ ...p, role: 'CUSTOMER' }));

// TKT-0080: the two multi-pick fields search instead of rendering the whole table.
const PICKER_PAGE = 10;
const searchClasses = async (query: string): Promise<ComboboxOption[]> => {
  const page = await Classes.list({
    pageSize: PICKER_PAGE,
    ...(query ? { search: query } : {}),
  });
  return page.items.map((c) => ({ id: c.id, label: c.name }));
};
const searchCustomers = async (query: string): Promise<ComboboxOption[]> => {
  const page = await Users.list({
    role: 'CUSTOMER',
    pageSize: PICKER_PAGE,
    ...(query ? { search: query } : {}),
  });
  return page.items.map((u) => ({ id: u.id, label: customerDisplayName(u) }));
};
import { isMinor } from '@/lib/age';
import { NativeSelect } from '@/components/ui/native-select';
import { ChipsCombobox, type ComboboxOption } from '@/components/ui/chips-combobox';

const RELATIONSHIPS = ['PARENT', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER'] as const;

const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  relationship: z.enum(RELATIONSHIPS),
  phone: z.string().trim().max(50).optional(),
  email: z
    .union([z.string().trim().email().max(255), z.literal('').transform(() => undefined)])
    .optional(),
  isPrimary: z.boolean().optional(),
});

// contacts + the under-18 refine are create-only (edit manages contacts through the
// separate ContactsSection CRUD card); isActive is edit-only.
const baseSchema = z.object({
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
  userId: z.string().optional(),
  guardianUserIds: z.array(z.string()),
  contacts: z.array(contactSchema),
  isActive: z.boolean(),
});

// PRD: under-18 trainees must have ≥1 contact in the create payload.
const createSchema = baseSchema.refine(
  (v) => !isMinor(v.dateOfBirth) || v.contacts.length >= 1,
  { path: ['contacts'], message: 'minor-requires-contact' },
);

type FormValues = z.infer<typeof baseSchema>;

const customerDisplayName = (u: UserRow) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

const emptyContact = {
  firstName: '',
  lastName: '',
  relationship: 'PARENT' as const,
  phone: '',
  email: '',
  isPrimary: false,
};

// id comes from the edit page's route params; create mode has none.
export function TraineeForm({ mode, id = '' }: { mode: 'create' | 'edit'; id?: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [trainee, setTrainee] = useState<TraineeDetail | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [contacts, setContacts] = useState<ContactPerson[]>([]);
  const [customers, setCustomers] = useState<UserRow[]>([]);
  const [classSeed, setClassSeed] = useState<ComboboxOption[]>([]);
  const [guardianSeed, setGuardianSeed] = useState<ComboboxOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(mode === 'create' ? createSchema : baseSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      phone: '',
      email: '',
      notes: '',
      locationIds: [],
      classIds: [],
      userId: '',
      guardianUserIds: [],
      contacts: [],
      isActive: true,
    },
  });

  const reload = () => {
    if (mode === 'create') {
      listAll(Locations.list).then(setLocations).catch(() => setLocations([]));
      listCustomers()
        .then(setCustomers)
        .catch(() => setCustomers([]));
      return;
    }
    Promise.all([Trainees.get(id), listAll(Locations.list), listCustomers()])
      .then(([detail, locs, us]) => {
        setTrainee(detail);
        setLocations(locs);
        setCustomers(us);
        // Chips seed from the trainee, not from a search — the same rule as the class roster.
        setClassSeed(detail.classes.map((c) => ({ id: c.id, label: c.name })));
        setGuardianSeed(
          detail.guardians.map((g) => ({
            id: g.id,
            label: [g.firstName, g.lastName].filter(Boolean).join(' ') || g.email,
          })),
        );
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
          userId: detail.user?.id ?? '',
          guardianUserIds: detail.guardians.map((g) => g.id),
          contacts: [],
          isActive: detail.isActive,
        });
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  };

  // `reset` has a stable identity (react-hook-form), so this still runs only on mode/id change.
  useEffect(reload, [mode, id, reset]);

  const { fields, append, remove } = useFieldArray({ control, name: 'contacts' });

  const dob = watch('dateOfBirth');
  const showContacts = useMemo(() => mode === 'create' && isMinor(dob), [mode, dob]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      if (mode === 'create') {
        await Trainees.create({
          firstName: values.firstName,
          lastName: values.lastName,
          dateOfBirth: values.dateOfBirth,
          phone: values.phone || undefined,
          email: values.email || undefined,
          notes: values.notes || undefined,
          locationIds: values.locationIds.length ? values.locationIds : undefined,
          classIds: values.classIds.length ? values.classIds : undefined,
          userId: values.userId || undefined,
          guardianUserIds: values.guardianUserIds.length ? values.guardianUserIds : undefined,
          contacts: values.contacts.length
            ? values.contacts.map((c) => ({
                firstName: c.firstName,
                lastName: c.lastName,
                relationship: c.relationship,
                phone: c.phone || undefined,
                email: c.email || undefined,
                isPrimary: c.isPrimary ?? false,
              }))
            : undefined,
        });
      } else {
        await Trainees.update(id, {
          firstName: values.firstName,
          lastName: values.lastName,
          dateOfBirth: values.dateOfBirth,
          phone: values.phone || undefined,
          email: values.email || undefined,
          notes: values.notes || undefined,
          locationIds: values.locationIds,
          classIds: values.classIds,
          // Empty select = unlink; backend maps null to a disconnect.
          userId: values.userId || null,
          guardianUserIds: values.guardianUserIds,
          isActive: values.isActive,
        });
      }
      router.replace('/trainees');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSubmitError(t('trainees.linking.conflict'));
      } else {
        setSubmitError(apiErrorMessage(e));
      }
    }
  };

  const ready = mode === 'create' || trainee !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t(mode === 'create' ? 'trainees.new' : 'trainees.edit')}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('trainees.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">{t('trainees.fields.firstName')}</Label>
                  <Input
                    id="firstName"
                    aria-invalid={Boolean(errors.firstName)}
                    {...register('firstName')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">{t('trainees.fields.lastName')}</Label>
                  <Input
                    id="lastName"
                    aria-invalid={Boolean(errors.lastName)}
                    {...register('lastName')}
                  />
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
                <legend className="px-1 text-sm font-medium">{t('trainees.fields.locations')}</legend>
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
                <legend className="px-1 text-sm font-medium">{t('trainees.fields.classes')}</legend>
                <Controller<FormValues, "classIds">
                  name="classIds"
                  control={control}
                  render={({ field }) => (
                    <ChipsCombobox
                      id="classIds"
                      value={field.value ?? []}
                      onChange={field.onChange}
                      search={searchClasses}
                      selected={classSeed}
                      placeholder={t('common.search.byName')}
                      noMatchesLabel={t('common.search.noMatches')}
                      emptyLabel={t('trainees.noClasses')}
                    />
                  )}
                />
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="userId">{t('trainees.fields.linkedAccount')}</Label>
                <NativeSelect
                  id="userId"
                className="px-2"
                  {...register('userId')}
                >
                  <option value="">{t('trainees.fields.linkedAccountNone')}</option>
                  {customers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {customerDisplayName(u)}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t('trainees.fields.guardians')}</legend>
                <Controller<FormValues, "guardianUserIds">
                  name="guardianUserIds"
                  control={control}
                  render={({ field }) => (
                    <ChipsCombobox
                      id="guardianUserIds"
                      value={field.value ?? []}
                      onChange={field.onChange}
                      search={searchCustomers}
                      selected={guardianSeed}
                      placeholder={t('common.search.person')}
                      noMatchesLabel={t('common.search.noMatches')}
                      emptyLabel={t('trainees.linking.noCustomers')}
                    />
                  )}
                />
              </fieldset>

              {/* PRD: dynamically show the Guardian Contacts section only if DOB makes the trainee under 18. */}
              {showContacts ? (
                <fieldset
                  aria-labelledby="contacts-legend"
                  className="space-y-3 rounded-md border border-amber-300 bg-amber-50/50 p-3"
                >
                  <legend
                    id="contacts-legend"
                    className="px-1 text-sm font-medium text-amber-900"
                  >
                    {t('trainees.contacts.legend')}
                  </legend>
                  <p className="text-xs text-amber-900">{t('trainees.contacts.minorHelp')}</p>

                  {fields.length === 0 ? (
                    <p className="text-sm text-amber-900">{t('trainees.contacts.empty')}</p>
                  ) : (
                    fields.map((field, index) => (
                      <div key={field.id} className="space-y-2 rounded border bg-background p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`contacts.${index}.firstName`}>
                              {t('trainees.contacts.firstName')}
                            </Label>
                            <Input
                              id={`contacts.${index}.firstName`}
                              {...register(`contacts.${index}.firstName` as const)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`contacts.${index}.lastName`}>
                              {t('trainees.contacts.lastName')}
                            </Label>
                            <Input
                              id={`contacts.${index}.lastName`}
                              {...register(`contacts.${index}.lastName` as const)}
                            />
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label htmlFor={`contacts.${index}.relationship`}>
                              {t('trainees.contacts.relationship')}
                            </Label>
                            <NativeSelect
                              id={`contacts.${index}.relationship`}
                className="px-2"
                              {...register(`contacts.${index}.relationship` as const)}
                            >
                              {RELATIONSHIPS.map((r) => (
                                <option key={r} value={r}>
                                  {t(`trainees.contacts.relationships.${r}`)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`contacts.${index}.phone`}>
                              {t('trainees.contacts.phone')}
                            </Label>
                            <Input
                              id={`contacts.${index}.phone`}
                              {...register(`contacts.${index}.phone` as const)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`contacts.${index}.email`}>
                              {t('trainees.contacts.email')}
                            </Label>
                            <Input
                              id={`contacts.${index}.email`}
                              type="email"
                              {...register(`contacts.${index}.email` as const)}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              className="size-4"
                              {...register(`contacts.${index}.isPrimary` as const)}
                            />
                            {t('trainees.contacts.primary')}
                          </label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => remove(index)}
                          >
                            {t('common.remove')}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ ...emptyContact })}
                  >
                    {t('trainees.contacts.add')}
                  </Button>

                  {errors.contacts ? (
                    <p role="alert" className="text-xs text-destructive">
                      {t('trainees.contacts.required')}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}

              {mode === 'edit' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('isActive')} className="size-4" />
                  {t('trainees.fields.active')}
                </label>
              ) : null}

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

      {mode === 'edit' && trainee ? (
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
      setError(apiErrorMessage(e));
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
      setError(apiErrorMessage(e));
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
              <NativeSelect
                className="px-2"
                value={form.relationship}
                onChange={(e) =>
                  setForm({ ...form, relationship: e.target.value as ContactRelationship })
                }
              >
                {RELATIONSHIPS.map((r) => (
                  <option key={r} value={r}>
                    {t(`trainees.contacts.relationships.${r}`)}
                  </option>
                ))}
              </NativeSelect>
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
