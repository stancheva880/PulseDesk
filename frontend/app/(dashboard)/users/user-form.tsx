'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChipsCombobox, type ComboboxOption } from '@/components/ui/chips-combobox';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api';
import { listAll, Locations, Users, type AppUserRole, type Location, type UserRow } from '@/lib/api-resources';

const ALL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CUSTOMER'] as const;

// email is a create-only input, so create tightens it via extend. TKT-0058: create no longer
// takes a password at all — the invited person sets their own. Edit still offers one, treating
// a blank value as "keep current".
// TKT-0054: an ADMIN or EMPLOYEE reads only their assigned locations, so an account without
// one signs in to an empty app. The backend rejects it; this catches it before the round trip.
const LOCATION_SCOPED_ROLES: readonly AppUserRole[] = ['ADMIN', 'EMPLOYEE'];

const baseObject = z.object({
  email: z.string(),
  password: z.union([z.string().min(8).max(200), z.literal('')]),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(50).optional(),
  role: z.enum(ALL_ROLES),
  locationIds: z.array(z.string()).optional(),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof baseObject>;

// `locationRequired` is a key, not a sentence — the field renders it through i18next.
const hasLocationWhenScoped = (v: FormValues): boolean =>
  !LOCATION_SCOPED_ROLES.includes(v.role) || (v.locationIds?.length ?? 0) > 0;
const LOCATION_ISSUE = { path: ['locationIds'], message: 'locationRequired' };

const baseSchema = baseObject.refine(hasLocationWhenScoped, LOCATION_ISSUE);
const createSchema = baseObject
  .extend({
    email: z.string().email(),
  })
  .refine(hasLocationWhenScoped, LOCATION_ISSUE);

const ROLES_BY_ACTOR: Record<string, AppUserRole[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CUSTOMER'],
  ADMIN: ['EMPLOYEE', 'CUSTOMER'],
};

// id comes from the edit page's route params; create mode has none.
export function UserForm({ mode, id = '' }: { mode: 'create' | 'edit'; id?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user: actor } = useAuth();

  const [target, setTarget] = useState<UserRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  const allowedRoles = ROLES_BY_ACTOR[actor?.role ?? ''] ?? [];

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(mode === 'create' ? createSchema : baseSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      phone: '',
      role: mode === 'create' ? (allowedRoles[0] ?? 'EMPLOYEE') : undefined,
      locationIds: [],
      isActive: true,
    },
  });

  useEffect(() => {
    if (mode === 'edit') {
      Users.get(id)
        .then((u) => {
          setTarget(u);
          reset({
            email: u.email,
            firstName: u.firstName ?? '',
            lastName: u.lastName ?? '',
            phone: u.phone ?? '',
            isActive: u.isActive,
            password: '',
            role: u.role,
            locationIds: u.locations.map((l) => l.id),
          });
        })
        .catch((e: unknown) =>
          setLoadError(e instanceof Error ? e.message : t('common.errors.generic')),
        );
    }
    listAll(Locations.list)
      .then(setLocations)
      .catch(() => undefined);
  }, [mode, id, reset, t]);

  // Locations are bounded, so they stay on listAll and the picker filters them in memory — the
  // combobox's `search` prop is the seam, no endpoint behind it. useCallback is load-bearing: the
  // component's fetch effect depends on this identity.
  const searchLocations = useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      const q = query.trim().toLocaleLowerCase();
      return locations
        .filter((l) => (q ? l.name.toLocaleLowerCase().includes(q) : true))
        .map((l) => ({ id: l.id, label: l.name }));
    },
    [locations],
  );
  const locationOptions = useMemo<ComboboxOption[]>(
    () => locations.map((l) => ({ id: l.id, label: l.name })),
    [locations],
  );

  const role = watch('role');
  const canChangeRole = actor?.role === 'SUPER_ADMIN';
  const showLocations = role !== 'SUPER_ADMIN';

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      if (mode === 'create') {
        const created = await Users.create({
          email: values.email,
          role: values.role,
          firstName: values.firstName || undefined,
          lastName: values.lastName || undefined,
          phone: values.phone || undefined,
          locationIds: values.role === 'SUPER_ADMIN' ? undefined : values.locationIds,
        });
        router.replace(created.attachedExisting ? '/users?attached=1' : '/users');
        return;
      }
      if (!target) return;
      const payload: Parameters<typeof Users.update>[1] = {
        firstName: values.firstName || null,
        lastName: values.lastName || null,
        phone: values.phone || null,
        isActive: values.isActive,
      };
      if (values.password) payload.password = values.password;
      if (canChangeRole && values.role) payload.role = values.role as AppUserRole;
      if (showLocations) payload.locationIds = values.locationIds ?? [];
      await Users.update(target.id, payload);
      router.replace('/users');
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  const ready = mode === 'create' || target !== null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === 'create' ? t('users.new', 'New user') : t('users.edit', 'Edit user')}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('users.formTitle', 'User details')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              {mode === 'create' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">{t('users.fields.email', 'Email')}</Label>
                    <Input
                      id="email"
                      type="email"
                      aria-invalid={Boolean(errors.email)}
                      {...register('email')}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{target!.email}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">{t('users.fields.firstName', 'First name')}</Label>
                  <Input id="firstName" {...register('firstName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">{t('users.fields.lastName', 'Last name')}</Label>
                  <Input id="lastName" {...register('lastName')} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t('users.fields.phone', 'Phone')}</Label>
                <Input id="phone" type="tel" {...register('phone')} />
              </div>
              {mode === 'edit' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="password">
                    {t('users.fields.passwordOptional', 'New password (leave blank to keep)')}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    aria-invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                </div>
              ) : null}
              {mode === 'create' || canChangeRole ? (
                <div className="space-y-1.5">
                  <Label htmlFor="role">{t('users.fields.role', 'Role')}</Label>
                  <select
                    id="role"
                    {...register('role')}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {(mode === 'create' ? allowedRoles : (ALL_ROLES as readonly AppUserRole[])).map(
                      (r) => (
                        <option key={r} value={r}>
                          {t(`login.pickTenant.roles.${r}`, r)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              ) : null}
              {showLocations ? (
                <div className="space-y-1.5">
                  <Label htmlFor="locationIds">{t('users.fields.locations', 'Locations')}</Label>
                  <Controller<FormValues, 'locationIds'>
                    name="locationIds"
                    control={control}
                    render={({ field }) => (
                      <ChipsCombobox
                        id="locationIds"
                        value={field.value ?? []}
                        onChange={field.onChange}
                        search={searchLocations}
                        selected={locationOptions}
                        placeholder={t('users.fields.locationsPlaceholder')}
                        emptyLabel={t('users.fields.noLocations')}
                        noMatchesLabel={t('common.search.noMatches')}
                        invalid={Boolean(errors.locationIds)}
                      />
                    )}
                  />
                  {errors.locationIds ? (
                    <p className="text-sm text-destructive">{t('users.errors.locationRequired')}</p>
                  ) : null}
                </div>
              ) : null}
              {mode === 'edit' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('isActive')} className="size-4" />
                  {t('users.fields.active', 'Active')}
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
    </div>
  );
}
