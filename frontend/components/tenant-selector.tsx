'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiErrorMessage } from '@/lib/api';
import { Tenants, listClubs, type TenantSummary } from '@/lib/api-resources';
import { landingRoute, readStoredMemberships } from '@/lib/auth-storage';
import {
  hardNavigate,
  readTenantContext,
  reloadApp,
  subscribeTenantContext,
  writeTenantContext,
} from '@/lib/tenant-context';
import { useAuth } from './auth-provider';

const SELECT_CLASS =
  'h-8 w-[200px] rounded-md border border-input bg-background px-2 text-sm';

// Sets the active tenant (X-Tenant-Id on outgoing API calls). SUPER_ADMIN picks from
// all tenants; tenant users switch between their own memberships (hidden with fewer
// than two). On change, a full reload rebuilds every cached list against the new tenant.
export function TenantSelector() {
  const { user } = useAuth();
  if (!user) return null;
  return user.role === 'SUPER_ADMIN' ? <SuperAdminSelector /> : <MembershipSwitcher />;
}

function SuperAdminSelector() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [selected, setSelected] = useState<string>(() => readTenantContext() ?? '');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Shares one request with the active-tenant gate. A failure is reported by that gate's
  // panel in <main>, so this control stays silent rather than repeating the message.
  useEffect(() => {
    let cancelled = false;
    void listClubs().then(
      ({ clubs }) => {
        if (!cancelled) setTenants(clubs);
      },
      () => {
        /* the gate renders the failure */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeTenantContext((next) => setSelected(next ?? ''));
  }, []);

  const onChange = (value: string) => {
    setSelected(value);
    writeTenantContext(value || null);
    if (typeof window !== 'undefined') window.location.reload();
  };

  const selectedTenant = tenants?.find((tenant) => tenant.id === selected) ?? null;

  const openDelete = () => {
    setConfirmText('');
    setDeleteError(null);
    setDeleteOpen(true);
  };

  // TKT-0132: deletes everything the club owns (schema.prisma cascades) — irreversible, so
  // the confirm button stays disabled until the operator types the exact club name.
  const onDelete = async () => {
    if (!selectedTenant || confirmText !== selectedTenant.name) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await Tenants.remove(selectedTenant.id);
      writeTenantContext(null);
      reloadApp();
    } catch (e) {
      setDeleteError(apiErrorMessage(e));
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        aria-label={t('tenants.selector', 'Tenant')}
        className={SELECT_CLASS}
        value={selected}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('tenants.none', '— select tenant —')}</option>
        {tenants?.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name} · {tenant.slug}
          </option>
        ))}
      </select>
      {/* Onboarding a club is SUPER_ADMIN-only, so its entry point lives with their selector. */}
      <Button asChild variant="outline" size="sm" title={t('tenants.new')}>
        <Link href="/tenants/new" aria-label={t('tenants.new')}>
          <Plus className="h-4 w-4" />
        </Link>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={!selectedTenant}
        title={t('tenants.delete.trigger')}
        aria-label={t('tenants.delete.trigger')}
        onClick={openDelete}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tenants.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('tenants.delete.description', { name: selectedTenant?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              aria-label={t('tenants.delete.confirmLabel')}
              placeholder={selectedTenant?.name ?? ''}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={deleteBusy || confirmText !== selectedTenant?.name}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Own memberships come from localStorage (persisted at login) — no API call, and
// never a list of other tenants. Switching lands per the NEW membership's role.
function MembershipSwitcher() {
  const { t } = useTranslation();
  const [memberships] = useState(readStoredMemberships);
  const [selected, setSelected] = useState<string>(() => readTenantContext() ?? '');

  useEffect(() => {
    return subscribeTenantContext((next) => setSelected(next ?? ''));
  }, []);

  if (memberships.length < 2) return null;

  const onChange = (tenantId: string) => {
    const next = memberships.find((m) => m.tenantId === tenantId);
    if (!next || tenantId === selected) return;
    setSelected(tenantId);
    writeTenantContext(tenantId);
    hardNavigate(landingRoute(next.role));
  };

  return (
    <select
      aria-label={t('tenants.switcher', 'Club')}
      className={SELECT_CLASS}
      value={selected}
      onChange={(e) => onChange(e.target.value)}
    >
      {memberships.map((m) => (
        <option key={m.tenantId} value={m.tenantId}>
          {m.tenantName} · {t(`login.pickTenant.roles.${m.role}`)}
        </option>
      ))}
    </select>
  );
}
