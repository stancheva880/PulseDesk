'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { BrandMark } from '@/components/brand-mark';
import { Topbar } from '@/components/topbar';
import { cn } from '@/lib/utils';

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user, status } = useAuth();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated' && user && user.role !== 'CUSTOMER') {
      router.replace('/dashboard');
    }
  }, [status, user, router]);

  if (status !== 'authenticated' || !user || user.role !== 'CUSTOMER') {
    return null;
  }

  const navItems = [
    { href: '/portal/schedule', labelKey: 'portal.navSchedule' },
    { href: '/portal/fees', labelKey: 'portal.navFees' },
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
      <main className="app-surface flex-1 overflow-y-auto px-6 py-8">{children}</main>
    </div>
  );
}
