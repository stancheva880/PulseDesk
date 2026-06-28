'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { Classes, Locations, Trainees, type ClassRow, type Location } from '@/lib/api-resources';
import { isMinor } from '@/lib/age';

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
  contacts: z.array(contactSchema),
});

// PRD: under-18 trainees must have ≥1 contact in the create payload.
const schema = baseSchema.refine(
  (v) => !isMinor(v.dateOfBirth) || v.contacts.length >= 1,
  { path: ['contacts'], message: 'minor-requires-contact' },
);

type FormValues = z.infer<typeof schema>;

const emptyContact = {
  firstName: '',
  lastName: '',
  relationship: 'PARENT' as const,
  phone: '',
  email: '',
  isPrimary: false,
};

export default function NewTraineePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  useEffect(() => {
    Locations.list().then(setLocations).catch(() => setLocations([]));
    Classes.list().then(setClasses).catch(() => setClasses([]));
  }, []);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      phone: '',
      email: '',
      notes: '',
      locationIds: [],
      classIds: [],
      contacts: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'contacts' });

  const dob = watch('dateOfBirth');
  const showContacts = useMemo(() => isMinor(dob), [dob]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Trainees.create({
        firstName: values.firstName,
        lastName: values.lastName,
        dateOfBirth: values.dateOfBirth,
        phone: values.phone || undefined,
        email: values.email || undefined,
        notes: values.notes || undefined,
        locationIds: values.locationIds.length ? values.locationIds : undefined,
        classIds: values.classIds.length ? values.classIds : undefined,
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
      router.replace('/trainees');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('trainees.new')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('trainees.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
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
                          <select
                            id={`contacts.${index}.relationship`}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                            {...register(`contacts.${index}.relationship` as const)}
                          >
                            {RELATIONSHIPS.map((r) => (
                              <option key={r} value={r}>
                                {t(`trainees.contacts.relationships.${r}`)}
                              </option>
                            ))}
                          </select>
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
