'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { LanguageSwitcher } from '@/components/language-switcher';
import { TenantSelector } from '@/components/tenant-selector';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';


interface TopbarProps {
  /** Optional left-side nav (used by the customer portal). */
  nav?: ReactNode;
}

export function Topbar({ nav }: TopbarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-w-0 items-center gap-4">{nav}</div>
      <div className="flex items-center gap-2">
        {user ? (
          <>
            <span className="hidden text-sm text-muted-foreground md:inline">{user.email}</span>
            <Badge variant="outline" className="hidden font-mono text-[10px] uppercase tracking-wide md:inline-flex">
              {t(`login.pickTenant.roles.${user.role}`, user.role)}
            </Badge>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-border md:block" />
          </>
        ) : null}
        <TenantSelector />
        <ThemeToggle />
        <LanguageSwitcher />
        {user ? (
          <Button variant="outline" size="sm" asChild>
            <Link href="/profile">{t('nav.profile')}</Link>
          </Button>
        ) : null}
        {user ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void logout().then(() => router.replace('/login'));
            }}
          >
            {t('nav.logout')}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
