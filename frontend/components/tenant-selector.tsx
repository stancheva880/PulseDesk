'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { Tenants, type TenantSummary } from '@/lib/api-resources';
import {
  readTenantContext,
  subscribeTenantContext,
  writeTenantContext,
} from '@/lib/tenant-context';
import { useAuth } from './auth-provider';

const NONE_VALUE = '__none__';

// Visible only to SUPER_ADMIN. Sets the X-Tenant-Id header on outgoing API calls so
// tenant-scoped endpoints (locations, classes, etc.) operate on the chosen tenant.
// On change, the page reloads so cached lists rebuild against the new tenant.
export function TenantSelector() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(() => readTenantContext() ?? '');

  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN') return;
    Tenants.list()
      .then(setTenants)
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'load failed');
      });
  }, [user]);

  useEffect(() => {
    return subscribeTenantContext((next) => setSelected(next ?? ''));
  }, []);

  if (user?.role !== 'SUPER_ADMIN') return null;

  const onChange = (value: string) => {
    const next = value === NONE_VALUE ? '' : value;
    setSelected(next);
    writeTenantContext(next || null);
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <Select value={selected || NONE_VALUE} onValueChange={onChange}>
        <SelectTrigger
          aria-label={t('tenants.selector', 'Tenant')}
          className="h-8 w-[200px] text-sm"
        >
          <SelectValue placeholder={t('tenants.none', '— select tenant —')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>{t('tenants.none', '— select tenant —')}</SelectItem>
          {tenants?.map((tenant) => (
            <SelectItem key={tenant.id} value={tenant.id}>
              {tenant.name}
              <span className="ml-2 text-xs text-muted-foreground">{tenant.slug}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
