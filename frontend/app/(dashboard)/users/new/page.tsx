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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { Locations, Users, type AppUserRole, type Location } from '@/lib/api-resources';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CUSTOMER']),
  locationIds: z.array(z.string()).optional(),
});
type FormValues = z.infer<typeof schema>;

const ROLES_BY_ACTOR: Record<string, AppUserRole[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CUSTOMER'],
  ADMIN: ['EMPLOYEE', 'CUSTOMER'],
};

export default function NewUserPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  const allowedRoles = ROLES_BY_ACTOR[user?.role ?? ''] ?? [];

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      role: allowedRoles[0] ?? 'EMPLOYEE',
      locationIds: [],
    },
  });

  const role = watch('role');

  useEffect(() => {
    Locations.list()
      .then(setLocations)
      .catch(() => undefined);
  }, []);

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await Users.create({
        email: values.email,
        password: values.password,
        role: values.role,
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
        locationIds: values.role === 'SUPER_ADMIN' ? undefined : values.locationIds,
      });
      router.replace('/users');
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('common.errors.generic'));
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('users.new', 'New user')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('users.formTitle', 'User details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('users.fields.email', 'Email')}</Label>
              <Input id="email" type="email" aria-invalid={Boolean(errors.email)} {...register('email')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('users.fields.password', 'Password')}</Label>
              <Input
                id="password"
                type="password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </div>
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
              <Label htmlFor="role">{t('users.fields.role', 'Role')}</Label>
              <select
                id="role"
                {...register('role')}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {role !== 'SUPER_ADMIN' ? (
              <div className="space-y-1.5">
                <Label htmlFor="locationIds">
                  {t('users.fields.locations', 'Locations')}
                </Label>
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
                <p className="text-xs text-muted-foreground">
                  {t('users.fields.locationsHint', 'Hold Ctrl/Cmd to select multiple.')}
                </p>
              </div>
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
