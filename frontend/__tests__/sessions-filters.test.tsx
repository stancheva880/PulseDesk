import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import SessionsListPage from '@/app/(dashboard)/sessions/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sessions',
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
function paramOf(url: string, key: string): string | null {
  return new URL(url, 'http://test.local').searchParams.get(key);
}

const CLASSES = [{ id: 'c1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true }];
const LOCATIONS = [
  { id: 'loc-1', tenantId: 't', name: 'Main Hall', address: null, isActive: true },
  // TKT-0127: retired halls stay in the *filter* dropdown — the forms drop them, the filters
  // must not, or history at a hall the club left becomes unfilterable.
  { id: 'loc-2', tenantId: 't', name: 'Retired Hall', address: null, isActive: false },
];
const TRAINERS = [
  {
    id: 'u-emp', email: 'emp@x', firstName: 'Ivan', lastName: 'Petrov',
    phone: null, isActive: true, role: 'EMPLOYEE', locations: [], memberships: [],
  },
];

function setRole(role: string) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }));
}

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <SessionsListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('SessionsListPage filters (TKT-0100)', () => {
  let sessionUrls: string[] = [];
  let userUrls: string[] = [];

  beforeEach(() => {
    setRole('ADMIN');
    search = '';
    sessionUrls = [];
    userUrls = [];
    replace.mockReset();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) {
        sessionUrls.push(url);
        return Promise.resolve(jsonResponse(200, paged([])));
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      if (url.includes('/users')) {
        userUrls.push(url);
        return Promise.resolve(jsonResponse(200, paged(TRAINERS)));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC #3 — the bar is ADMIN-only.
  it('shows the filter bar to an admin and hides it from a trainer', async () => {
    const admin = renderPage();
    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));
    expect(admin.container.querySelector('#filter-class')).not.toBeNull();
    expect(admin.container.querySelector('#filter-trainer')).not.toBeNull();
    expect(admin.container.querySelector('#filter-location')).not.toBeNull();
    admin.unmount();

    setRole('EMPLOYEE');
    sessionUrls = [];
    const trainer = renderPage();
    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));
    expect(trainer.container.querySelector('#filter-class')).toBeNull();
  });

  // TKT-0127 AC #3 — guards code this ticket deliberately leaves alone: if anyone later
  // applies the forms' active-only filter here too, history at a retired hall stops being
  // filterable.
  it('keeps a deactivated location in the filter dropdown', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));
    const options = await waitFor(() => {
      const found = [...container.querySelectorAll<HTMLOptionElement>('#filter-location option')]
        .map((o) => o.value)
        .filter(Boolean);
      if (!found.length) throw new Error('location options not loaded');
      return found;
    });
    expect(options).toContain('loc-2');
  });

  // AC #4 — the trainer dropdown is fed by the EMPLOYEE user lookup.
  it('fills the trainer dropdown from the EMPLOYEE user list', async () => {
    const { container } = renderPage();

    await waitFor(() => expect(userUrls.length).toBeGreaterThan(0));
    expect(paramOf(userUrls[0]!, 'role')).toBe('EMPLOYEE');

    await waitFor(() => {
      const options = Array.from(
        container.querySelectorAll('#filter-trainer option'),
        (o) => o.textContent,
      );
      expect(options).toContain('Ivan Petrov');
    });
  });

  // AC #3 — a selection is URL state.
  it('writes a class selection into the URL', async () => {
    const { container } = renderPage();
    await waitFor(() =>
      expect(container.querySelectorAll('#filter-class option').length).toBeGreaterThan(1),
    );

    fireEvent.change(container.querySelector('#filter-class')!, { target: { value: 'c1' } });

    expect(replace).toHaveBeenCalled();
    const target = String(replace.mock.calls[replace.mock.calls.length - 1]![0]);
    expect(target).toContain('classId=c1');
  });

  // AC #3 — the calendar request carries the URL filters.
  it('sends the filters with the calendar range request', async () => {
    search = 'view=calendar&classId=c1&trainerId=u-emp&locationId=loc-1';
    renderPage();

    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));
    const last = sessionUrls[sessionUrls.length - 1]!;
    expect(paramOf(last, 'classId')).toBe('c1');
    expect(paramOf(last, 'trainerId')).toBe('u-emp');
    expect(paramOf(last, 'locationId')).toBe('loc-1');
    expect(paramOf(last, 'startsAtFrom')).not.toBeNull();
  });

  // AC #3 — the table honours the same URL state.
  it('sends the filters with the table request too', async () => {
    search = 'view=table&classId=c1';
    renderPage();

    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));
    const last = sessionUrls[sessionUrls.length - 1]!;
    expect(paramOf(last, 'classId')).toBe('c1');
    expect(paramOf(last, 'page')).toBe('1');
  });
});
