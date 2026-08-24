import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/auth-storage';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersListPage from '@/app/(dashboard)/users/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';

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

function row(id: string, email: string, status: string, isActive: boolean) {
  return {
    id,
    email,
    firstName: null,
    lastName: null,
    role: 'EMPLOYEE',
    isActive,
    status,
    tenantId: 't1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    locations: [],
  };
}

const ROWS = [
  row('u-pending', 'pending@demo.local', 'PENDING', true),
  row('u-active', 'active@demo.local', 'ACTIVE', true),
  row('u-inactive', 'inactive@demo.local', 'INACTIVE', false),
];

const MEMBERSHIPS = [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }];

function seedSession() {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(
    buildJwt({ sub: 'u1', email: 'actor@demo.local', role: 'ADMIN', tenantId: 't1', exp }),
  );
  window.localStorage.setItem(
    'pulsedesk.memberships',
    JSON.stringify([{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]),
  );
  window.localStorage.setItem('pulsedesk.tenantContext', 't1');
}

/** Returns the <tr> holding the given email, so per-row badges and actions can be scoped. */
function rowFor(email: string): HTMLElement {
  return screen.getByText(email).closest('tr') as HTMLElement;
}

function renderPage() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <UsersListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('Users list — account status badges and invite resend', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('renders a distinct badge for pending, active and inactive', async () => {
    seedSession();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/auth/memberships')) return jsonResponse(200, MEMBERSHIPS);
      return jsonResponse(200, {
        items: ROWS,
        page: 1,
        pageSize: 25,
        total: 3,
        totalPages: 1,
      });
    });

    renderPage();
    await screen.findByText('pending@demo.local');

    const pending = within(rowFor('pending@demo.local')).getByText(/Pending|Изчаква/);
    const active = within(rowFor('active@demo.local')).getByText(/^(Active|Активен)$/);
    const inactive = within(rowFor('inactive@demo.local')).getByText(/^(Inactive|Неактивен)$/);

    // Three states, three labels — a pending row must not read like either of the others.
    const labels = [pending.textContent, active.textContent, inactive.textContent];
    expect(new Set(labels).size).toBe(3);
    // ...and must not look like them either.
    expect(pending.className).not.toBe(inactive.className);
    expect(pending.className).not.toBe(active.className);
  });

  it('offers Resend only on pending rows', async () => {
    seedSession();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/auth/memberships')) return jsonResponse(200, MEMBERSHIPS);
      return jsonResponse(200, {
        items: ROWS,
        page: 1,
        pageSize: 25,
        total: 3,
        totalPages: 1,
      });
    });

    renderPage();
    await screen.findByText('pending@demo.local');

    const resend = /Resend invite|Повторно изпращане/;
    expect(within(rowFor('pending@demo.local')).getByRole('button', { name: resend })).toBeInTheDocument();
    expect(within(rowFor('active@demo.local')).queryByRole('button', { name: resend })).toBeNull();
    expect(within(rowFor('inactive@demo.local')).queryByRole('button', { name: resend })).toBeNull();
  });

  it('posts to /users/:id/invite and reports that the mail went out', async () => {
    seedSession();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/auth/memberships')) return jsonResponse(200, MEMBERSHIPS);
      if ((init as RequestInit | undefined)?.method === 'POST') {
        return jsonResponse(200, { inviteEmailSent: true });
      }
      return jsonResponse(200, {
        items: ROWS,
        page: 1,
        pageSize: 25,
        total: 3,
        totalPages: 1,
      });
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('pending@demo.local');
    await user.click(
      within(rowFor('pending@demo.local')).getByRole('button', {
        name: /Resend invite|Повторно изпращане/,
      }),
    );

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/sent|изпратена/i);
    const posted = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain('/users/u-pending/invite');
  });

  // inviteEmailSent: false is a 200, not an error — the admin has to be told which one they got.
  it('reports a failed send distinctly from a successful one', async () => {
    seedSession();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/auth/memberships')) return jsonResponse(200, MEMBERSHIPS);
      if ((init as RequestInit | undefined)?.method === 'POST') {
        return jsonResponse(200, { inviteEmailSent: false });
      }
      return jsonResponse(200, {
        items: ROWS,
        page: 1,
        pageSize: 25,
        total: 3,
        totalPages: 1,
      });
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('pending@demo.local');
    await user.click(
      within(rowFor('pending@demo.local')).getByRole('button', {
        name: /Resend invite|Повторно изпращане/,
      }),
    );

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/could not|не можа/i);
  });
});
