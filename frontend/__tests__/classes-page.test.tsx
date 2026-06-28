import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClassesListPage from '@/app/(dashboard)/classes/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { writeStoredTokens, type UserRole } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  usePathname: () => '/classes',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CLASSES = [
  {
    id: 'c1', tenantId: 't', name: 'Yoga', description: null, billingMode: 'PER_SESSION',
    monthlyAmount: null, sessionPrice: '10', isActive: true, createdAt: '', updatedAt: '',
  },
];

function renderAs(role: UserRole) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  writeStoredTokens({
    accessToken: buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }),
    refreshToken: 'R',
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, CLASSES));
    return Promise.resolve(jsonResponse(200, []));
  });
  return render(
    <I18nProvider>
      <AuthProvider>
        <ClassesListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('ClassesListPage role gating', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows New + row Edit/Delete to an ADMIN', async () => {
    const { container } = renderAs('ADMIN');
    await screen.findByText('Yoga');
    expect(container.querySelector('a[href="/classes/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/classes/c1/edit"]')).not.toBeNull();
  });

  it('shows the read-only list to an EMPLOYEE with no New/Edit/Delete', async () => {
    const { container } = renderAs('EMPLOYEE');
    // The list itself renders (read access) ...
    await screen.findByText('Yoga');
    // ... but the write actions are gone (fetch resolved → role already hydrated to EMPLOYEE).
    expect(container.querySelector('a[href="/classes/new"]')).toBeNull();
    expect(container.querySelector('a[href="/classes/c1/edit"]')).toBeNull();
  });
});
