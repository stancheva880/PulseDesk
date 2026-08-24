import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PortalSchedulePage from '@/app/(portal)/portal/schedule/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/schedule',
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
function paramOf(url: string, key: string): string | null {
  return new URL(url, 'http://test.local').searchParams.get(key);
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

// Today at 10:00 local so the entry lands in the default week in any timezone.
const now = new Date();
const ENTRIES = [
  {
    id: 's1', tenantId: 't', classId: 'c', locationId: 'l',
    startsAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString(),
    endsAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).toISOString(),
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
    class: { id: 'c', name: 'Yoga 101' },
    location: { id: 'l', name: 'Studio A' },
    attendances: [],
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <PortalSchedulePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('PortalSchedulePage calendar view (TKT-0102)', () => {
  let meUrls: string[] = [];

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u-cust', email: 'c@x', role: 'CUSTOMER', tenantId: 't', exp }));
    search = '';
    meUrls = [];
    replace.mockReset();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/me/sessions')) {
        meUrls.push(url);
        return Promise.resolve(jsonResponse(200, ENTRIES));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC #2 — the card list stays the default; the toggle exists; no range params are sent.
  it('defaults to the card list with a view toggle', async () => {
    renderPage();

    expect(await screen.findByText(/Yoga 101/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Списък' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Календар' })).toBeInTheDocument();
    expect(paramOf(meUrls[0]!, 'from')).toBeNull();
    expect(paramOf(meUrls[0]!, 'to')).toBeNull();
  });

  // AC #3 + #4 — calendar view: week window via from/to, chips read-only (zero links).
  it('fetches the visible week and renders read-only chips in calendar view', async () => {
    search = 'view=calendar';
    const { container } = renderPage();

    await waitFor(() => expect(meUrls.length).toBeGreaterThan(0));
    const monday = mondayOf(now);
    const last = meUrls[meUrls.length - 1]!;
    expect(paramOf(last, 'from')).toBe(dayIso(monday));
    expect(paramOf(last, 'to')).toBe(dayIso(addDays(monday, 7)));

    await waitFor(() => expect(container.textContent).toContain('Yoga 101'));
    expect(container.textContent).toContain('10:00');
    expect(container.querySelectorAll('a[href*="/sessions/"]')).toHaveLength(0);
  });

  // AC #4 — mode and anchor are URL state, same contract as the staff calendar.
  it('writes a mode change into the URL', async () => {
    search = 'view=calendar';
    renderPage();
    await waitFor(() => expect(meUrls.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Месец' }));

    const target = String(replace.mock.calls[replace.mock.calls.length - 1]![0]);
    expect(target).toContain('mode=month');
    expect(target).toContain('view=calendar');
  });

  // AC #2 — switching to the calendar is URL state too.
  it('writes the calendar view into the URL from the toggle', async () => {
    renderPage();
    await screen.findByText(/Yoga 101/);

    fireEvent.click(screen.getByRole('button', { name: 'Календар' }));

    const target = String(replace.mock.calls[replace.mock.calls.length - 1]![0]);
    expect(target).toContain('view=calendar');
  });
});
