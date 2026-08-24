import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// Local-midnight helpers — assertions hold in any timezone (TKT-0094 convention).
function localMidnight(y: number, m: number, d: number): Date {
  return new Date(y, m, d);
}
function dayIso(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}
function paramOf(url: string, key: string): string | null {
  return new URL(url, 'http://test.local').searchParams.get(key);
}

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

describe('SessionsListPage calendar view (TKT-0099)', () => {
  let sessionUrls: string[] = [];

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    search = '';
    sessionUrls = [];
    replace.mockReset();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) {
        sessionUrls.push(url);
        return Promise.resolve(jsonResponse(200, paged(SESSIONS)));
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC #1 + #2 — bare URL: calendar is the default view, week the initial mode.
  // AC #3 — the request covers exactly the visible week via listAll (pageSize=100).
  it('defaults to the calendar in week mode and fetches exactly the visible week', async () => {
    const { container } = renderPage();

    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));

    const monday = mondayOf(now);
    const last = sessionUrls[sessionUrls.length - 1]!;
    expect(paramOf(last, 'startsAtFrom')).toBe(dayIso(monday));
    expect(paramOf(last, 'startsAtBefore')).toBe(dayIso(addDays(monday, 7)));
    expect(paramOf(last, 'pageSize')).toBe('100');
    // Calendar UI present, table filter inputs absent.
    expect(await screen.findByRole('button', { name: 'Днес' })).toBeInTheDocument();
    expect(container.querySelector('#filter-from')).toBeNull();
  });

  // AC #3 — month mode fetches the whole visible grid (incl. adjacent-month days):
  // March 2026 renders Feb 23 .. Apr 5, so the half-open range ends Apr 6.
  it('fetches the full visible month grid in month mode', async () => {
    search = 'view=calendar&mode=month&date=2026-03-02';
    renderPage();

    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));

    const last = sessionUrls[sessionUrls.length - 1]!;
    expect(paramOf(last, 'startsAtFrom')).toBe(dayIso(localMidnight(2026, 1, 23)));
    expect(paramOf(last, 'startsAtBefore')).toBe(dayIso(localMidnight(2026, 3, 6)));
  });

  // AC #1 — mode/date round-trip from the URL without an explicit view param.
  it('fetches a single day in day mode read from the URL', async () => {
    search = 'mode=day&date=2026-03-02';
    renderPage();

    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));

    const last = sessionUrls[sessionUrls.length - 1]!;
    expect(paramOf(last, 'startsAtFrom')).toBe(dayIso(localMidnight(2026, 2, 2)));
    expect(paramOf(last, 'startsAtBefore')).toBe(dayIso(localMidnight(2026, 2, 3)));
  });

  // The dashboard-tile seam (TKT-0096): legacy range params without a view render the table.
  it('renders the table when legacy startsAtFrom arrives without a view param', async () => {
    search = new URLSearchParams({ startsAtFrom: dayIso(localMidnight(2026, 2, 2)) }).toString();
    const { container } = renderPage();

    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));

    expect(container.querySelector('#filter-from')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Днес' })).toBeNull();
  });

  // AC #1 — the toggle writes the view into the URL.
  it('switches to the table view through the URL', async () => {
    renderPage();
    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Таблица' }));

    expect(replace).toHaveBeenCalled();
    const target = String(replace.mock.calls[replace.mock.calls.length - 1]![0]);
    expect(target).toContain('view=table');
  });

  // AC #1 + #2 — a mode switch is URL state too.
  it('writes a mode change into the URL', async () => {
    renderPage();
    await waitFor(() => expect(sessionUrls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Месец' }));

    const target = String(replace.mock.calls[replace.mock.calls.length - 1]![0]);
    expect(target).toContain('mode=month');
    expect(target).toContain('view=calendar');
  });
});
