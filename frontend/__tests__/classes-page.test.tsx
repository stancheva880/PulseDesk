import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClassesListPage from '@/app/(dashboard)/classes/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken, type UserRole } from '@/lib/auth-storage';

const push = vi.fn();
// TKT-0096: the page reads ?isActive=true — switchable per test.
let search = '';
vi.mock('next/navigation', () => ({
  usePathname: () => '/classes',
  useRouter: () => ({ replace: vi.fn(), push, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
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

function paged<T>(items: T[]): unknown {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

const CLASSES = [
  {
    id: 'c1', tenantId: 't', name: 'Yoga', description: null, billingMode: 'PER_SESSION',
    monthlyAmount: null, sessionPrice: '10', isActive: true, createdAt: '', updatedAt: '',
  },
];

function renderAs(role: UserRole) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }));
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
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

  // TKT-0091: contextual create — each row links to the child forms with ?classId= carried.
  it('offers contextual create links on a row to an ADMIN', async () => {
    const { container } = renderAs('ADMIN');
    await screen.findByText('Yoga');
    expect(container.querySelector('a[href="/sessions/new?classId=c1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/schedules/new?classId=c1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/fees/new?classId=c1"]')).not.toBeNull();
  });

  it('hides the contextual create links from an EMPLOYEE', async () => {
    const { container } = renderAs('EMPLOYEE');
    await screen.findByText('Yoga');
    expect(container.querySelector('a[href="/sessions/new?classId=c1"]')).toBeNull();
    expect(container.querySelector('a[href="/schedules/new?classId=c1"]')).toBeNull();
    expect(container.querySelector('a[href="/fees/new?classId=c1"]')).toBeNull();
  });

  // TKT-0088: row activation opens the record; classes have no detail page, so the edit form.
  it('opens the edit form when an admin activates the row', async () => {
    push.mockReset();
    renderAs('ADMIN');

    fireEvent.click(await screen.findByText('Yoga'));

    expect(push).toHaveBeenCalledWith('/classes/c1/edit');
  });

  // The actions cell returns null for an EMPLOYEE — the row must still work (TKT-0088 AC #4).
  it('opens the edit form when an EMPLOYEE activates the row, with no action controls', async () => {
    push.mockReset();
    renderAs('EMPLOYEE');

    fireEvent.click(await screen.findByText('Yoga'));

    expect(push).toHaveBeenCalledWith('/classes/c1/edit');
  });

  // TKT-0092 AC #6 — nothing caches the list between mounts: returning to the page after a
  // create must refetch, so the new record is there. Pin the per-mount fetch.
  it('refetches the list on every mount', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      return Promise.resolve(jsonResponse(200, []));
    });
    const listCalls = () =>
      fetchSpy.mock.calls.filter(([input]) =>
        String(typeof input === 'string' ? input : (input as Request).url).includes('/classes'),
      ).length;

    const first = render(
      <I18nProvider>
        <AuthProvider>
          <ClassesListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByText('Yoga');
    const afterFirst = listCalls();
    expect(afterFirst).toBeGreaterThan(0);
    first.unmount();

    render(
      <I18nProvider>
        <AuthProvider>
          <ClassesListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByText('Yoga');
    expect(listCalls()).toBeGreaterThan(afterFirst);
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

// TKT-0096: the dashboard's active-classes tile links here with ?isActive=true, so the
// destination must show the same set the tile counted — and let the user out of the filter.
describe('ClassesListPage isActive filter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    search = '';
  });

  function renderWithCapture() {
    const urls: string[] = [];
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      urls.push(url);
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      return Promise.resolve(jsonResponse(200, []));
    });
    render(
      <I18nProvider>
        <AuthProvider>
          <ClassesListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    return urls;
  }

  it('?isActive=true filters the request and can be cleared', async () => {
    search = 'isActive=true';
    const urls = renderWithCapture();
    await screen.findByText('Yoga');

    expect(urls.find((u) => u.includes('/classes'))).toContain('isActive=true');

    fireEvent.click(screen.getByRole('button', { name: /Clear|Изчистване/ }));

    await waitFor(() => {
      const listCalls = urls.filter((u) => u.includes('/classes'));
      expect(listCalls[listCalls.length - 1]).not.toContain('isActive');
    });
  });

  it('sends no filter and shows no filter line without the parameter', async () => {
    const urls = renderWithCapture();
    await screen.findByText('Yoga');

    expect(urls.find((u) => u.includes('/classes'))).not.toContain('isActive');
    expect(screen.queryByRole('button', { name: /Clear|Изчистване/ })).toBeNull();
  });

  // TKT-0093: the search box and the TKT-0096 isActive filter live in the same params object —
  // one request carries both.
  it('search composes with the isActive filter in one request', async () => {
    search = 'isActive=true';
    const urls = renderWithCapture();
    await screen.findByText('Yoga');

    fireEvent.change(screen.getByPlaceholderText(/Search|Търсене/), {
      target: { value: 'yo' },
    });

    await waitFor(() => {
      const last = urls.filter((u) => u.includes('/classes')).pop()!;
      expect(last).toContain('search=yo');
      expect(last).toContain('isActive=true');
      expect(last).toContain('page=1');
    });
  });
});
