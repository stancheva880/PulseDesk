import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/auth-storage';
import { render, screen, within } from '@testing-library/react';
import UsersListPage from '@/app/(dashboard)/users/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';

// TKT-0083: the list is the only place a phone is displayed — there is no user detail page.
// An account without one reads as an em dash, the same idiom the other nullable cells use.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(''),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function row(id: string, email: string, phone: string | null) {
  return {
    id,
    email,
    firstName: null,
    lastName: null,
    phone,
    role: 'EMPLOYEE',
    isActive: true,
    status: 'ACTIVE',
    tenantId: 't1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    locations: [],
  };
}

const ROWS = [
  row('u-with', 'with@demo.local', '0888 123 456'),
  row('u-without', 'without@demo.local', null),
];

const MEMBERSHIPS = [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }];

function seedSession() {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(
    buildJwt({ sub: 'u1', email: 'actor@demo.local', role: 'ADMIN', tenantId: 't1', exp }),
  );
  window.localStorage.setItem('pulsedesk.memberships', JSON.stringify(MEMBERSHIPS));
  window.localStorage.setItem('pulsedesk.tenantContext', 't1');
}

function rowFor(email: string): HTMLElement {
  return screen.getByText(email).closest('tr') as HTMLElement;
}

describe('Users list — the phone column', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('shows the number when set and an em dash when not', async () => {
    seedSession();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/auth/memberships')) return jsonResponse(200, MEMBERSHIPS);
      return jsonResponse(200, { items: ROWS, page: 1, pageSize: 25, total: 2, totalPages: 1 });
    });

    render(
      <I18nProvider>
        <AuthProvider>
          <UsersListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByText('with@demo.local');

    expect(within(rowFor('with@demo.local')).getByText('0888 123 456')).toBeInTheDocument();
    // The name cell is also an em dash on these rows, so count rather than assert a single node.
    expect(within(rowFor('without@demo.local')).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(within(rowFor('without@demo.local')).queryByText('0888 123 456')).toBeNull();
  });
});
