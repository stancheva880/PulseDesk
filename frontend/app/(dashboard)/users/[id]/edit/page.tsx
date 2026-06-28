'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { Locations, Users, type AppUserRole, type Location, type UserRow } from '@/lib/api-resources';

const schema = z.object({
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  isActive: z.boolean(),
  password: z.string().min(8).max(200).optional().or(z.literal('')),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CUSTOMER']).optional(),
  locationIds: z.array(z.string()).optional(),
});
type FormValues = z.infer<typeof schema>;

export default function EditUserPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user: actor } = useAuth();
  const [target, setTarget] = useState<UserRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      isActive: true,
      password: '',
      locationIds: [],
    },
  });

  useEffect(() => {
    Users.get(id)
      .then((u) => {
        setTarget(u);
        reset({
          firstName: u.firstName ?? '',
          lastName: u.lastName ?? '',
          isActive: u.isActive,
          password: '',
          role: u.role,
          locationIds: u.locations.map((l) => l.id),
        });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'load failed'));
    Locations.list()
      .then(setLocations)
      .catch(() => undefined);
  }, [id, reset]);

  const role = watch('role');
  const canChangeRole = actor?.role === 'SUPER_ADMIN';
  const showLocations = role !== 'SUPER_ADMIN';

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    if (!target) return;
    try {
      const payload: Parameters<typeof Users.update>[1] = {
        firstName: values.firstName || null,
        lastName: values.lastName || null,
        isActive: values.isActive,
      };
      if (values.password) payload.password = values.password;
      if (canChangeRole && values.role) payload.role = values.role as AppUserRole;
      if (showLocations) payload.locationIds = values.locationIds ?? [];
      await Users.update(target.id, payload);
      router.replace('/users');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('users.edit', 'Edit user')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('users.formTitle', 'User details')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !target ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <p className="text-sm text-muted-foreground">{target.email}</p>
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
              {canChangeRole ? (
                <div className="space-y-1.5">
                  <Label htmlFor="role">{t('users.fields.role', 'Role')}</Label>
                  <select
                    id="role"
                    {...register('role')}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {(['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CUSTOMER'] as AppUserRole[]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {showLocations ? (
                <div className="space-y-1.5">
                  <Label htmlFor="locationIds">{t('users.fields.locations', 'Locations')}</Label>
                  <select
                    id="locationIds"
                    multiple
                    {...register('locationIds')}
                    className="h-32 w-full rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isActive')} className="size-4" />
                {t('users.fields.active', 'Active')}
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
    </div>
  );
}
