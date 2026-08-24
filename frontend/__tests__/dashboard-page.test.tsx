import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import DashboardHomePage from '@/app/(dashboard)/dashboard/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken, writeStoredMemberships, type LoginMembership } from '@/lib/auth-storage';
import { writeTenantContext } from '@/lib/tenant-context';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
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
function paged<T>(items: T[]): unknown {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

const MEMBERSHIPS: LoginMembership[] = [{ tenantId: 't', tenantName: 'Club', role: 'EMPLOYEE' }];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <DashboardHomePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

// TKT-0039: the counts used to be zeroed on any failure, which rendered a broken request
// as a real but empty club. EMPLOYEE so the admin-only fees chart stays out of the way.
describe('DashboardHomePage', () => {
  beforeEach(() => {
    writeTenantContext('t');
    writeStoredMemberships(MEMBERSHIPS);
    setAccessToken(
      buildJwt({
        sub: 'u',
        email: 'e@b',
        role: 'EMPLOYEE',
        tenantId: 't',
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TKT-0069: two of the three tiles used to page every class and every session in the tenant to
  // produce one integer each, while the third already read the count off the envelope. All three
  // now do, so the cost of the landing page stops depending on the size of the club.
  it('counts off the envelope and asks the server for the filters it needs', async () => {
    const urls: string[] = [];
    const envelope = (total: number) =>
      Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total, totalPages: total }),
      );
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/auth/')) return Promise.resolve(jsonResponse(200, MEMBERSHIPS));
      if (url.includes('/locations')) return envelope(4);
      if (url.includes('/classes')) return envelope(7);
      if (url.includes('/sessions')) return envelope(3);
      return Promise.resolve(jsonResponse(200, paged([])));
    });

    renderPage();

    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(await screen.findByText('3')).toBeInTheDocument();

    const classes = urls.find((u) => u.includes('/classes'));
    expect(classes).toContain('pageSize=1');
    expect(classes).toContain('isActive=true');

    const sessions = urls.find((u) => u.includes('/sessions'));
    expect(sessions).toContain('pageSize=1');
    const params = new URL(sessions!, 'http://test.local').searchParams;
    const from = new Date(params.get('startsAtFrom')!);
    const before = new Date(params.get('startsAtBefore')!);
    // The week the page has always computed: local Monday at midnight, exclusive upper bound.
    expect(from.getDay()).toBe(1);
    expect(from.getHours()).toBe(0);
    expect(before.getTime()).toBeGreaterThan(from.getTime());

    // totalPages is 7 and 3 above, so a listAll still on this screen would follow them.
    expect(urls.filter((u) => u.includes('page=2'))).toEqual([]);
  });

  it('surfaces a failed stats request as an error instead of zero', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/auth/')) return Promise.resolve(jsonResponse(200, MEMBERSHIPS));
      if (url.includes('/locations')) {
        return Promise.resolve(jsonResponse(500, { message: 'Locations unavailable' }));
      }
      return Promise.resolve(jsonResponse(200, paged([])));
    });

    renderPage();

    expect(await screen.findByText('Locations unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  // TKT-0096: each loaded tile is a real link into the list behind its number. The sessions
  // link must carry the same window the count request sent — one computation, not two.
  it('links each loaded tile into its list, sessions carrying the counted window', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/auth/')) return Promise.resolve(jsonResponse(200, MEMBERSHIPS));
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 1, total: 2, totalPages: 2 }),
      );
    });

    renderPage();
    await screen.findAllByText('2');

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/locations');
    expect(hrefs).toContain('/classes?isActive=true');

    const sessionsHref = hrefs.find((h) => h?.startsWith('/sessions?'));
    expect(sessionsHref).toBeDefined();
    const linkParams = new URL(sessionsHref!, 'http://test.local').searchParams;
    const request = urls.find((u) => u.includes('/sessions'));
    const requestParams = new URL(request!, 'http://test.local').searchParams;
    expect(linkParams.get('startsAtFrom')).toBe(requestParams.get('startsAtFrom'));
    expect(linkParams.get('startsAtBefore')).toBe(requestParams.get('startsAtBefore'));
  });

  it('renders no links while the counts are loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/auth/')) return Promise.resolve(jsonResponse(200, MEMBERSHIPS));
      return new Promise<Response>(() => {});
    });

    renderPage();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it('renders no links when a count request failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/auth/')) return Promise.resolve(jsonResponse(200, MEMBERSHIPS));
      if (url.includes('/locations')) {
        return Promise.resolve(jsonResponse(500, { message: 'Locations unavailable' }));
      }
      return Promise.resolve(jsonResponse(200, paged([])));
    });

    renderPage();

    expect(await screen.findByText('Locations unavailable')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it('renders the counts when every request succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/auth/')) return Promise.resolve(jsonResponse(200, MEMBERSHIPS));
      if (url.includes('/locations')) {
        return Promise.resolve(
          jsonResponse(200, { items: [], page: 1, pageSize: 1, total: 4, totalPages: 4 }),
        );
      }
      return Promise.resolve(jsonResponse(200, paged([])));
    });

    renderPage();

    // The locations count comes off the pagination envelope, not the rows.
    expect(await screen.findByText('4')).toBeInTheDocument();
  });
});
