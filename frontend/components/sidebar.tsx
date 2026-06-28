'use client';

import {
  CalendarDays,
  Clock,
  Dumbbell,
  LayoutDashboard,
  MapPin,
  Receipt,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/brand-mark';
import { useAuth } from '@/components/auth-provider';
import type { UserRole } from '@/lib/auth-storage';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  // When set, only these roles see the item. Omitted = visible to every dashboard user.
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/locations', labelKey: 'nav.locations', icon: MapPin },
  { href: '/classes', labelKey: 'nav.classes', icon: Dumbbell },
  { href: '/schedules', labelKey: 'nav.schedules', icon: CalendarDays, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { href: '/sessions', labelKey: 'nav.sessions', icon: Clock },
  { href: '/trainees', labelKey: 'nav.trainees', icon: Users },
  { href: '/fees', labelKey: 'nav.fees', icon: Receipt },
  { href: '/users', labelKey: 'nav.users', icon: UserCog, roles: ['SUPER_ADMIN', 'ADMIN'] },
];

export function Sidebar() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { user } = useAuth();
  const navItems = NAV_ITEMS.filter(
    (item) => !item.roles || (user != null && item.roles.includes(user.role)),
  );

  return (
    <nav
      aria-label={t('nav.aria')}
      className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex"
    >
      <div className="flex h-14 items-center gap-2.5 border-b px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="font-semibold tracking-tight">{t('app.name')}</span>
        </Link>
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 p-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive ? 'true' : undefined}
                className={cn(
                  'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r-full bg-primary transition-all',
                    isActive ? 'w-1' : 'w-0',
                  )}
                  aria-hidden="true"
                />
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                  )}
                />
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
