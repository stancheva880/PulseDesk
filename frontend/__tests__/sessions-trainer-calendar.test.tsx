import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SessionsListPage from '@/app/(dashboard)/sessions/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

// TKT-0101: the trainer's calendar seat. The server-side narrowing itself is pinned by the
// backend spec (sessions.controller.spec.ts — employee visibility + trainer-filter
// intersection); these cases pin what the EMPLOYEE sees in the browser: the same calendar,
// no admin-only chrome, no admin-only lookups.

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

// Today at 10:00 local — lands in the default week view in any timezone.
const now = new Date();
const SESSIONS = [
  {
    id: 's1', tenantId: 't', classId: 'c1', locationId: 'loc-1',
    startsAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
    endsAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).toISOString(),
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
  },
];
const CLASSES = [{ id: 'c1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true }];
const LOCATIONS = [{ id: 'loc-1', tenantId: 't', name: 'Main Hall', address: null, isActive: true }];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <SessionsListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('SessionsListPage as a trainer (TKT-0101)', () => {
  let sessionUrls: string[] = [];
  let userUrls: string[] = [];

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u-emp', email: 'e@x', role: 'EMPLOYEE', tenantId: 't', exp }));
    search = '';
    sessionUrls = [];
    userUrls = [];
    replace.mockReset();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) {
        sessionUrls.push(url);
        return Promise.resolve(jsonResponse(200, paged(SESSIONS)));
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      if (url.includes('/users')) {
        userUrls.push(url);
        return Promise.resolve(jsonResponse(403, { message: 'Forbidden' }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC #2 + #3 — same calendar, chips link to attendance; no filter bar, no /users lookup.
  it('renders attendance-linked chips with no filter bar and no users lookup', async () => {
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelector('a[href="/sessions/s1/attendance"]')).not.toBeNull(),
    );
    const chip = container.querySelector('a[href="/sessions/s1/attendance"]')!;
    expect(chip.textContent).toContain('10:00');
    expect(chip.textContent).toContain('Yoga');

    expect(container.querySelector('#filter-class')).toBeNull();
    expect(container.querySelector('#filter-trainer')).toBeNull();
    expect(container.querySelector('#filter-location')).toBeNull();
    expect(userUrls).toHaveLength(0);
  });

  // AC #3 — mode and anchor are URL state for a trainer exactly as for an admin.
  it('lets the trainer switch mode and step the anchor through the URL', async () => {
    renderPage();
    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Месец' }));
    let target = String(replace.mock.calls[replace.mock.calls.length - 1]![0]);
    expect(target).toContain('mode=month');
    expect(target).toContain('view=calendar');

    fireEvent.click(screen.getByRole('button', { name: 'Следващ период' }));
    target = String(replace.mock.calls[replace.mock.calls.length - 1]![0]);
    expect(target).toMatch(/date=\d{4}-\d{2}-\d{2}/);
  });
});
