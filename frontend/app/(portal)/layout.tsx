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

// The four tabs a customer's family view is organised into. "Деца" confirms who is actually
// linked to the account (a trainee with no fees/cards/sessions yet still appears there); the
// rest are per-topic views over the same family. Every one of them is scoped server-side to
// the signed-in customer's own trainees, so there is nothing to hide per tab.
// TKT-0130: "Данни за плащане" used to be its own tab here; it is now a second sub-tab inside
// Fees ("Плащане на такси", next to "Моите такси") — a customer looking at a fee can now see
// where to pay it without leaving the page.
const PORTAL_TABS = [
  { href: '/portal/children', labelKey: 'portal.tabs.children' },
  { href: '/portal/classes', labelKey: 'portal.tabs.classes' },
  { href: '/portal/schedule', labelKey: 'portal.tabs.sessions' },
  { href: '/portal/fees', labelKey: 'portal.tabs.fees' },
] as const;

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = usePathname();

  const ready = useRequireRole(user?.role === 'CUSTOMER', '/dashboard');
  // A CUSTOMER is a tenant user, so this half only ever recovers the active tenant from
  // their memberships — the select-tenant panel is SUPER_ADMIN's, and a SUPER_ADMIN never
  // gets past the guard above.
  const tenant = useActiveTenant(user?.role);
  if (!ready) return null;

  const portalNav = (
    <Link href="/portal/schedule" className="flex items-center gap-2.5">
      <BrandMark className="h-8 w-8" />
      <span className="font-semibold tracking-tight">{t('app.name')}</span>
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar nav={portalNav} />
      <nav
        aria-label={t('portal.tabs.label')}
        className="flex gap-1 overflow-x-auto border-b bg-background px-6"
      >
        {PORTAL_TABS.map((tab) => {
          const active = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </nav>
      <main className="app-surface flex-1 overflow-y-auto px-6 py-8">
        {tenant === 'ready' ? children : null}
      </main>
    </div>
  );
}
