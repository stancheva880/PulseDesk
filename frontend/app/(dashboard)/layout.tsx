'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { MobileNav } from '@/components/mobile-nav';
import { SelectTenantPanel } from '@/components/select-tenant-panel';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { useActiveTenant, useRequireRole } from '@/lib/use-require-role';
import type { UserRole } from '@/lib/auth-storage';

// Paths a role may not reach, and where it goes instead. The nav already hides most of
// these; this also blocks direct-URL access.
const DENY_RULES: Array<{
  role: UserRole;
  matches: (pathname: string) => boolean;
  redirectTo: string;
}> = [
  // Sections an EMPLOYEE (trainer) can't access at all — their list endpoints are ADMIN-only.
  {
    role: 'EMPLOYEE',
    matches: (p) => p === '/users' || p.startsWith('/users/'),
    redirectTo: '/dashboard',
  },
  // EMPLOYEE reads their own schedules (class-schedules.service.ts's scopeWhere) but cannot
  // write one — matches SessionsController's ADMIN-only create/update/delete.
  {
    role: 'EMPLOYEE',
    matches: (p) => p === '/schedules/new' || /^\/schedules\/[^/]+\/edit$/.test(p),
    redirectTo: '/schedules',
  },
  // Location writes are SUPER_ADMIN-only (locations.controller.ts:52,58,68). Matched
  // exactly rather than by prefix, so /locations itself stays reachable for an ADMIN.
  {
    role: 'ADMIN',
    matches: (p) => p === '/locations/new' || /^\/locations\/[^/]+\/edit$/.test(p),
    redirectTo: '/locations',
  },
  // Creating a club is SUPER_ADMIN-only (tenants.controller.ts is @Roles(SUPER_ADMIN)).
  { role: 'ADMIN', matches: (p) => p.startsWith('/tenants'), redirectTo: '/dashboard' },
  { role: 'EMPLOYEE', matches: (p) => p.startsWith('/tenants'), redirectTo: '/dashboard' },
  // TKT-0122: platform maintenance is SUPER_ADMIN-only (waitlist-sweep.controller.ts). The nav
  // already hides it; this stops a deep link landing on a page whose only button would 403.
  { role: 'ADMIN', matches: (p) => p.startsWith('/maintenance'), redirectTo: '/dashboard' },
  { role: 'EMPLOYEE', matches: (p) => p.startsWith('/maintenance'), redirectTo: '/dashboard' },
];

// Onboarding the very first club happens before any club can be active, so this one route
// renders without the active-tenant gate below. Every other page needs an X-Tenant-Id.
const TENANT_FREE_ROUTES = ['/tenants/new'];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const isCustomer = user?.role === 'CUSTOMER';
  const denied = user
    ? DENY_RULES.find((rule) => rule.role === user.role && rule.matches(pathname))
    : undefined;

  // CUSTOMERs belong in the portal; anyone who deep-links into a section their role
  // cannot use goes wherever that rule sends them.
  const ready = useRequireRole(
    !isCustomer && !denied,
    isCustomer ? '/portal/schedule' : (denied?.redirectTo ?? '/dashboard'),
  );
  // Held back until an active tenant exists: without one every page below fetches a 400
  // (SUPER_ADMIN) or a 403 (everyone else). The shell keeps rendering, because the
  // control the panel names is the tenant selector in the Topbar.
  const tenant = useActiveTenant(user?.role);

  // No club exists yet, so there is nothing to select and nothing to show: send the system
  // administrator to the form that creates the first one. Suppressed on TENANT_FREE_ROUTES —
  // /tenants/new is the destination, and replacing to the current route inside an effect is a
  // loop waiting to happen. Only a SUPER_ADMIN reaches 'empty', which is what keeps this from
  // fighting the DENY_RULES above: those send ADMIN and EMPLOYEE the opposite way.
  useEffect(() => {
    if (!ready || tenant !== 'empty') return;
    if (TENANT_FREE_ROUTES.includes(pathname)) return;
    router.replace('/tenants/new');
  }, [ready, tenant, pathname, router]);

  if (!ready) return null;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar nav={<MobileNav />} />
        <main className="app-surface flex-1 overflow-y-auto px-6 py-8">
          {tenant === 'ready' || TENANT_FREE_ROUTES.includes(pathname) ? (
            children
          ) : tenant === 'unselected' ? (
            <SelectTenantPanel />
          ) : tenant === 'failed' ? (
            <SelectTenantPanel failed />
          ) : null}
        </main>
      </div>
    </div>
  );
}
