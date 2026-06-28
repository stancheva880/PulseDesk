'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, status } = useAuth();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated' && user?.role === 'CUSTOMER') {
      router.replace('/portal/schedule');
    }
  }, [status, user, router]);

  if (status !== 'authenticated' || !user || user.role === 'CUSTOMER') {
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
