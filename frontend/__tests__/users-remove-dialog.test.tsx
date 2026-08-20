import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/auth-storage';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersListPage from '@/app/(dashboard)/users/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import bg from '@/locales/bg/common.json';
import en from '@/locales/en/common.json';

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

const EMPLOYEE_ROW = {
  id: 'u2',
  email: 'emp@demo.local',
  firstName: 'Emma',
  lastName: 'Petrova',
  role: 'EMPLOYEE',
  isActive: true,
  status: 'ACTIVE',
  tenantId: 't1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  locations: [],
};

function seedSession(role: string, tenantId: string | null) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(
    buildJwt({ sub: 'u1', email: 'actor@demo.local', role, tenantId, exp }),
  );
  if (tenantId) {
    window.localStorage.setItem(
      'pulsedesk.memberships',
      JSON.stringify([{ tenantId, tenantName: 'Club One', role }]),
    );
    window.localStorage.setItem('pulsedesk.tenantContext', tenantId);
  }
}

function mockApi(memberships: unknown[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('/auth/memberships')) return jsonResponse(200, memberships);
    return jsonResponse(200, { items: [EMPLOYEE_ROW], page: 1, pageSize: 25, total: 1, totalPages: 1 });
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <UsersListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('Users list — per-actor removal dialog copy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ADMIN sees remove-from-club wording (title, body, confirm button)', async () => {
    seedSession('ADMIN', 't1');
    mockApi([{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]);
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole('button', { name: /Delete|Изтриване/ }));

    const title = await screen.findByRole('heading', {
      name: /Remove emp@demo\.local from your club|Премахване на emp@demo\.local от вашия клуб/,
    });
    expect(title).toBeInTheDocument();
    expect(
      screen.getByText(/account and memberships in other clubs|Акаунтът и членствата им в други клубове/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Remove from club|Премахване от клуба/ }),
    ).toBeInTheDocument();
  });

  it('SUPER_ADMIN keeps the delete-account wording', async () => {
    seedSession('SUPER_ADMIN', null);
    window.localStorage.setItem('pulsedesk.tenantContext', 't1');
    mockApi([]);
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole('button', { name: /Delete|Изтриване/ }));

    expect(
      await screen.findByRole('heading', {
        name: /Delete user emp@demo\.local|Изтриване на потребител emp@demo\.local/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Remove from club|Премахване от клуба/)).toBeNull();
  });

  it('both copy variants exist in bg and en', () => {
    for (const locale of [bg, en]) {
      expect(locale.users.deleteConfirm).toBeTruthy();
      expect(locale.users.removeConfirm.title).toBeTruthy();
      expect(locale.users.removeConfirm.description).toBeTruthy();
      expect(locale.users.removeConfirm.confirm).toBeTruthy();
    }
  });
});
