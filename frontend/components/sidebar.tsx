'use client';

import {
  CalendarDays,
  Clock,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  Landmark,
  MapPin,
  Receipt,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/brand-mark';
import { useAuth } from '@/components/auth-provider';
import type { UserRole } from '@/lib/auth-storage';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  // When set, only these roles see the item. Omitted = visible to every dashboard user.
  roles?: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/locations', labelKey: 'nav.locations', icon: MapPin },
  { href: '/classes', labelKey: 'nav.classes', icon: Dumbbell },
  // EMPLOYEE reads their own schedules (class-schedules.service.ts's scopeWhere) — writes
  // (new/edit/delete/generate) stay ADMIN-only, gated in the page itself and in DENY_RULES.
  { href: '/schedules', labelKey: 'nav.schedules', icon: CalendarDays, roles: ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'] },
  { href: '/sessions', labelKey: 'nav.sessions', icon: Clock },
  { href: '/trainees', labelKey: 'nav.trainees', icon: Users },
  { href: '/fees', labelKey: 'nav.fees', icon: Receipt },
  { href: '/cards', labelKey: 'nav.cards', icon: CreditCard },
  { href: '/users', labelKey: 'nav.users', icon: UserCog, roles: ['SUPER_ADMIN', 'ADMIN'] },
  // TKT-0131: moved off /profile — a club-wide setting belongs in the menu, not an admin's
  // personal settings page. Follows the active tenant (Topbar's selector), so a SUPER_ADMIN
  // running several clubs sets different payment details per club.
  {
    href: '/payment-details',
    labelKey: 'nav.paymentDetails',
    icon: Landmark,
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  // TKT-0122: platform maintenance actions. SUPER_ADMIN-only, and layout.tsx DENY_RULES
  // bounces anyone else who deep-links the route.
  { href: '/maintenance', labelKey: 'nav.maintenance', icon: Wrench, roles: ['SUPER_ADMIN'] },
];

/**
 * The destinations the current user may see. Shared by the desktop sidebar and the mobile drawer so
 * one role predicate serves both — a second copy would drift the first time NAV_ITEMS changes.
 */
function useVisibleNavItems(): NavItem[] {
  const { user } = useAuth();
  return NAV_ITEMS.filter(
    (item) => !item.roles || (user != null && item.roles.includes(user.role)),
  );
}

interface NavListProps {
  /** Called after a destination is activated. The drawer uses it to close itself. */
  onNavigate?: () => void;
}

/** The nav destinations as a list. Rendered identically by the sidebar and the mobile drawer. */
export function NavList({ onNavigate }: NavListProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const navItems = useVisibleNavItems();

  return (
    <ul className="flex flex-1 flex-col gap-0.5 p-3">
      {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
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
  );
}

/** Brand header shared by the sidebar and the mobile drawer. */
export function NavBrand({ onNavigate }: NavListProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-14 items-center gap-2.5 border-b px-5">
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5">
        <BrandMark className="h-8 w-8" />
        <span className="font-semibold tracking-tight">{t('app.name')}</span>
      </Link>
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('nav.aria')}
      className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex"
    >
      <NavBrand />
      <NavList />
    </nav>
  );
}
