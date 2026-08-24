'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { BrandMark } from '@/components/brand-mark';
import { Topbar } from '@/components/topbar';
import { cn } from '@/lib/utils';
import { useActiveTenant, useRequireRole } from '@/lib/use-require-role';

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { user } = useAuth();

  const ready = useRequireRole(user?.role === 'CUSTOMER', '/dashboard');
  // A CUSTOMER is a tenant user, so this half only ever recovers the active tenant from
  // their memberships — the select-tenant panel is SUPER_ADMIN's, and a SUPER_ADMIN never
  // gets past the guard above.
  const tenant = useActiveTenant(user?.role);
  if (!ready) return null;

  const navItems = [
    { href: '/portal/schedule', labelKey: 'portal.navSchedule' },
    { href: '/portal/fees', labelKey: 'portal.navFees' },
    { href: '/portal/cards', labelKey: 'portal.navCards' },
  ];

  const portalNav = (
    <>
      <Link href="/portal/schedule" className="flex items-center gap-2.5">
        <BrandMark className="h-8 w-8" />
        <span className="font-semibold tracking-tight">{t('app.name')}</span>
      </Link>
      <nav className="flex items-center gap-1" aria-label={t('nav.aria')}>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </>
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
