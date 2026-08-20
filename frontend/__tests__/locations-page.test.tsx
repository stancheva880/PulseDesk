import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LocationsListPage from '@/app/(dashboard)/locations/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken, type UserRole } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/locations',
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}
function jsonResponse(status: number, body: unknown): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function paged<T>(items: T[]): unknown {
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 };
}
// Location writes are SUPER_ADMIN-only on the API (locations.controller.ts:52,58,68),
// so the role under test decides whether the write controls should render at all.
function signIn(role: UserRole): void {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(
    buildJwt({
      sub: 'u',
      email: 'a@b',
      role,
      tenantId: role === 'SUPER_ADMIN' ? null : 't',
      exp,
    }),
  );
}

const LOCATIONS = [
  { id: 'loc-1', tenantId: 't', name: 'Main Hall', address: 'Center 1', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'loc-2', tenantId: 't', name: 'Annex', address: null, isActive: false, createdAt: '', updatedAt: '' },
];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <LocationsListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('LocationsListPage', () => {
  let deleted: string | null = null;
  let listCalls = 0;

  beforeEach(() => {
    signIn('SUPER_ADMIN');
    deleted = null;
    listCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/locations/loc-1') && method === 'DELETE') {
        deleted = 'loc-1';
        return Promise.resolve(jsonResponse(204, null));
      }
      if (url.includes('/locations') && method === 'GET') {
        listCalls += 1;
        return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one row per location with name, address and edit/new links', async () => {
    const { container } = renderPage();

    expect(await screen.findByText('Main Hall')).toBeInTheDocument();
    expect(screen.getByText('Center 1')).toBeInTheDocument();
    expect(screen.getByText('Annex')).toBeInTheDocument();
    expect(container.querySelector('a[href="/locations/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/locations/loc-1/edit"]')).not.toBeNull();
    expect(container.querySelector('a[href="/locations/loc-2/edit"]')).not.toBeNull();
  });

  it('hides the new, edit and delete controls from an ADMIN', async () => {
    signIn('ADMIN');
    const { container } = renderPage();

    expect(await screen.findByText('Main Hall')).toBeInTheDocument();
    expect(container.querySelector('a[href="/locations/new"]')).toBeNull();
    expect(container.querySelector('a[href="/locations/loc-1/edit"]')).toBeNull();
    expect(container.querySelector('a[href="/locations/loc-2/edit"]')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /Delete|Изтриване/ })).toHaveLength(0);
  });

  it('renders the list read-only for an EMPLOYEE', async () => {
    signIn('EMPLOYEE');
    const { container } = renderPage();

    expect(await screen.findByText('Main Hall')).toBeInTheDocument();
    expect(screen.getByText('Annex')).toBeInTheDocument();
    expect(container.querySelector('a[href="/locations/new"]')).toBeNull();
    expect(container.querySelector('a[href="/locations/loc-1/edit"]')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /Delete|Изтриване/ })).toHaveLength(0);
  });

  it('delete flow: confirm dialog fires DELETE and reloads the list', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Main Hall');
    const callsAfterLoad = listCalls;

    const deleteButtons = screen.getAllByRole('button', { name: /Delete|Изтриване/ });
    await user.click(deleteButtons[0]!);

    await screen.findByRole('heading', { name: /Main Hall/ });
    const allDelete = screen.getAllByRole('button', { name: /Delete|Изтриване/ });
    await user.click(allDelete[allDelete.length - 1]!);

    await waitFor(() => {
      expect(deleted).toBe('loc-1');
      expect(listCalls).toBeGreaterThan(callsAfterLoad);
    });
  });
});
