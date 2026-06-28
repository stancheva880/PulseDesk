'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

// Sections an EMPLOYEE (trainer) can't access at all — their list endpoints are ADMIN-only.
// The nav already hides these; this also blocks direct-URL access.
const ADMIN_ONLY_PREFIXES = ['/schedules', '/users'];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, status } = useAuth();

  const employeeOnAdminPath =
    user?.role === 'EMPLOYEE' &&
    ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated' && user?.role === 'CUSTOMER') {
      router.replace('/portal/schedule');
    } else if (status === 'authenticated' && employeeOnAdminPath) {
      router.replace('/dashboard');
    }
  }, [status, user, router, employeeOnAdminPath]);

  if (status !== 'authenticated' || !user || user.role === 'CUSTOMER' || employeeOnAdminPath) {
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar showTenantSelector />
        <main className="app-surface flex-1 overflow-y-auto px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
