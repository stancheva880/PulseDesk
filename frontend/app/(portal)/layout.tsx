'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { BrandMark } from '@/components/brand-mark';
import { Topbar } from '@/components/topbar';
import { useActiveTenant, useRequireRole } from '@/lib/use-require-role';

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const ready = useRequireRole(user?.role === 'CUSTOMER', '/dashboard');
  // A CUSTOMER is a tenant user, so this half only ever recovers the active tenant from
  // their memberships — the select-tenant panel is SUPER_ADMIN's, and a SUPER_ADMIN never
  // gets past the guard above.
  const tenant = useActiveTenant(user?.role);
  if (!ready) return null;

  // Schedule/Fees/Cards nav links removed for now — fees moved into the profile page's own
  // tab (reachable from the Topbar's avatar menu), and the rest is being reconsidered
  // alongside it. The routes themselves are untouched, only this entry point.
  const portalNav = (
    <Link href="/portal/schedule" className="flex items-center gap-2.5">
      <BrandMark className="h-8 w-8" />
      <span className="font-semibold tracking-tight">{t('app.name')}</span>
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar nav={portalNav} />
      <main className="app-surface flex-1 overflow-y-auto px-6 py-8">
        {tenant === 'ready' ? children : null}
      </main>
    </div>
  );
}
