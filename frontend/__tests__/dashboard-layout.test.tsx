import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import DashboardLayout from '@/app/(dashboard)/layout';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import {
  setAccessToken,
  writeStoredMemberships,
  type LoginMembership,
  type UserRole,
} from '@/lib/auth-storage';
import { resetClubsRequest, type TenantSummary } from '@/lib/api-resources';
import { readTenantContext, writeTenantContext } from '@/lib/tenant-context';

// Hoisted so the vi.mock factory can close over them without a TDZ error.
const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: { current: '/dashboard' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => nav.pathname.current,
}));

// jsdom can't navigate; the rest of the module (the tenant-context channel this suite
// reads and writes) stays real.
const { hardNavigate, reloadApp } = vi.hoisted(() => ({
  hardNavigate: vi.fn(),
  reloadApp: vi.fn(),
}));
vi.mock('@/lib/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  hardNavigate,
  reloadApp,
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

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

const CHILD = 'page-content';
const PANEL = 'select-tenant-panel';
const FAILED = 'clubs-failed-panel';

// What GET /auth/memberships answers for the case under test.
let membershipsResponse: LoginMembership[] = [];

// TKT-0055: the gate now needs the club list too, so the fetch mock routes by URL instead
// of answering everything with the membership snapshot. `clubs` is what GET /api/tenants
// returns; `clubsMode` makes that request fail or never settle.
// TKT-0056 (approved TEST CHANGE REQUEST): 't9' joined the default list. The gate now checks the
// stored club against it, so a case that picks a club has to pick one the server actually has.
const ONE_CLUB: TenantSummary[] = [
  { id: 't', slug: 'club', name: 'Club', isActive: true },
  { id: 't9', slug: 'club-nine', name: 'Club Nine', isActive: true },
];
let clubs: TenantSummary[] = ONE_CLUB;
let clubsMode: 'ok' | 'fail' | 'pending' = 'ok';

function jsonOf(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    if (String(input).includes('/api/tenants')) {
      if (clubsMode === 'pending') return new Promise<Response>(() => {});
      if (clubsMode === 'fail') return Promise.resolve(jsonOf({ message: 'boom' }, 500));
      return Promise.resolve(jsonOf(clubs));
    }
    return Promise.resolve(jsonOf(membershipsResponse));
  });
}

function fetchedUrls(): string[] {
  return vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
}

// Lets the auth bootstrap settle without waiting on the club list, which some cases hold open.
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

interface RenderOptions {
  /** Active tenant to seed. `null` renders the no-active-tenant state. */
  tenant?: string | null;
  memberships?: LoginMembership[];
}

function renderLayout(role: UserRole, pathname: string, options: RenderOptions = {}) {
  const memberships =
    options.memberships ??
    (role === 'SUPER_ADMIN' ? [] : [{ tenantId: 't', tenantName: 'Club', role }]);
  writeStoredMemberships(memberships);
  membershipsResponse = memberships;

  signIn(role);
  // TKT-0039: dashboard content now requires an active tenant, so the route-permission
  // cases have to state that precondition. Cases about tenant selection pass
  // `tenant: null` to get the empty state on purpose.
  const tenant = options.tenant === undefined ? 't' : options.tenant;
  if (tenant) writeTenantContext(tenant);

  nav.pathname.current = pathname;
  return render(
    <I18nProvider>
      <AuthProvider>
        <DashboardLayout>
          <p>{CHILD}</p>
        </DashboardLayout>
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('DashboardLayout route guards', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    hardNavigate.mockClear();
    writeTenantContext(null);
    writeStoredMemberships([]);
    membershipsResponse = [];
    clubs = ONE_CLUB;
    clubsMode = 'ok';
    resetClubsRequest();
    // AuthProvider refreshes the membership snapshot for tenant-bound roles; the gate reads
    // the club list. Routed by URL so one is not answered with the other's payload.
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Location writes are SUPER_ADMIN-only on the API (locations.controller.ts:52,58,68),
  // so an ADMIN must not reach either write route even by direct URL.
  it('redirects an ADMIN away from the location write routes', async () => {
    renderLayout('ADMIN', '/locations/new');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/locations'));
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  it('redirects an ADMIN away from a location edit route', async () => {
    renderLayout('ADMIN', '/locations/loc-1/edit');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/locations'));
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  it('leaves the location list reachable for an ADMIN', async () => {
    renderLayout('ADMIN', '/locations');

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('lets a SUPER_ADMIN open the location write routes', async () => {
    renderLayout('SUPER_ADMIN', '/locations/new');

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('still sends an EMPLOYEE on an admin-only path to the dashboard', async () => {
    renderLayout('EMPLOYEE', '/schedules');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });
});

// TKT-0039: with no active tenant every tenant-scoped route answers 400 (SUPER_ADMIN) or
// 403 (everyone else), so the layout resolves that state instead of letting pages fetch.
describe('DashboardLayout active-tenant gate', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    hardNavigate.mockClear();
    writeTenantContext(null);
    writeStoredMemberships([]);
    membershipsResponse = [];
    clubs = ONE_CLUB;
    clubsMode = 'ok';
    resetClubsRequest();
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the select-tenant panel to a SUPER_ADMIN with no active tenant', async () => {
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: null });

    expect(await screen.findByTestId(PANEL)).toBeInTheDocument();
    // Children never mount, so no page can send a tenant-scoped request. The shell's own
    // two calls are the exception and neither needs a tenant: /auth/memberships is
    // header-less by design, and GET /api/tenants is what fills the selector the panel
    // points at (no @TenantId() on that route, so it answers without an active tenant).
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    const shell = ['/auth/', '/api/tenants'];
    expect(fetchedUrls().filter((u) => !shell.some((s) => u.includes(s)))).toEqual([]);
  });

  it('renders page content once the SUPER_ADMIN picks a tenant', async () => {
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: null });
    await screen.findByTestId(PANEL);

    act(() => writeTenantContext('t9'));

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
  });

  it('brings the panel back when the SUPER_ADMIN clears the tenant selection', async () => {
    renderLayout('SUPER_ADMIN', '/dashboard');
    expect(await screen.findByText(CHILD)).toBeInTheDocument();

    act(() => writeTenantContext(null));

    expect(await screen.findByTestId(PANEL)).toBeInTheDocument();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  it("recovers a tenant user's active tenant from the first stored membership", async () => {
    renderLayout('ADMIN', '/dashboard', {
      tenant: null,
      memberships: [
        { tenantId: 't-first', tenantName: 'First', role: 'ADMIN' },
        { tenantId: 't-second', tenantName: 'Second', role: 'ADMIN' },
      ],
    });

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(readTenantContext()).toBe('t-first');
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
  });

  it('renders no page content for a tenant user with no memberships', async () => {
    renderLayout('ADMIN', '/dashboard', { tenant: null, memberships: [] });

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    // Nothing to recover from, so the gate must not invent a tenant.
    expect(readTenantContext()).toBeNull();
  });
});

// TKT-0055: zero clubs is the normal first boot (prisma/seed.ts:103 gates the demo data), and
// "select a club in the top bar" is unfollowable when the selector is empty. The gate sends
// that administrator to the form instead.
describe('DashboardLayout first-run club onboarding', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    hardNavigate.mockClear();
    writeTenantContext(null);
    writeStoredMemberships([]);
    membershipsResponse = [];
    clubs = ONE_CLUB;
    clubsMode = 'ok';
    resetClubsRequest();
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a SUPER_ADMIN with no clubs to the club form', async () => {
    clubs = [];
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: null });

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/tenants/new'));
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  // The guard answers 404 for an inactive club exactly as for a missing one
  // (tenant-context.guard.ts:56), so an all-inactive deployment has nothing to work in.
  it('treats a deployment of only inactive clubs as having none', async () => {
    clubs = [{ id: 'gone', slug: 'gone', name: 'Closed Club', isActive: false }];
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: null });

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/tenants/new'));
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
  });

  it('renders no panel and no page content while the club list is loading', async () => {
    clubsMode = 'pending';
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: null });

    await settle();

    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
    expect(screen.queryByTestId(FAILED)).not.toBeInTheDocument();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  // dashboard-page.test.tsx:41 records this mistake being fixed once already: a failed request
  // rendered as a real but empty club. A broken list must not read as "no clubs exist".
  it('shows a load-failure card instead of sending a SUPER_ADMIN to the club form', async () => {
    clubsMode = 'fail';
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: null });

    expect(await screen.findByTestId(FAILED)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalledWith('/tenants/new');
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  it('issues no navigation when the SUPER_ADMIN is already on the club form', async () => {
    clubs = [];
    renderLayout('SUPER_ADMIN', '/tenants/new', { tenant: null });

    // /tenants/new is tenant-free, so the form itself renders and replacing to the current
    // route would be a loop.
    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('redirects exactly once', async () => {
    clubs = [];
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: null });

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/tenants/new'));
    await settle();
    expect(nav.replace.mock.calls).toEqual([['/tenants/new']]);
  });

  // GET /tenants is @Roles(SUPER_ADMIN) and would answer 403, so no member may request it —
  // and no member may be sent to a club-creation form DENY_RULES already blocks.
  it('never sends a member to the club form or fetches the club list', async () => {
    clubs = [];
    renderLayout('ADMIN', '/dashboard', {
      memberships: [{ tenantId: 't', tenantName: 'Club', role: 'ADMIN' }],
    });

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalledWith('/tenants/new');
    expect(fetchedUrls().some((u) => u.includes('/api/tenants'))).toBe(false);
  });
});

// TKT-0056: a club id kept from a database that no longer has it made every screen render
// `Tenant <id> not found`. The gate now checks the stored club against the list before letting any
// page mount, so the id is corrected rather than displayed.
describe('DashboardLayout stale club healing', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    hardNavigate.mockClear();
    writeTenantContext(null);
    writeStoredMemberships([]);
    membershipsResponse = [];
    clubs = ONE_CLUB;
    clubsMode = 'ok';
    resetClubsRequest();
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears a stored club that is not in the club list', async () => {
    clubs = [{ id: 'live', slug: 'live', name: 'Live Club', isActive: true }];
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: 'gone' });

    expect(await screen.findByTestId(PANEL)).toBeInTheDocument();
    expect(readTenantContext()).toBeNull();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  // The guard answers 404 for a deactivated club exactly as for a missing one, so an administrator
  // holding one would otherwise 404 forever with the club still listed as present.
  it('clears a stored club that has been deactivated', async () => {
    clubs = [
      { id: 'live', slug: 'live', name: 'Live Club', isActive: true },
      { id: 'closed', slug: 'closed', name: 'Closed Club', isActive: false },
    ];
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: 'closed' });

    expect(await screen.findByTestId(PANEL)).toBeInTheDocument();
    expect(readTenantContext()).toBeNull();
  });

  it('sends no tenant-scoped request while the stored club is unverified', async () => {
    clubs = [{ id: 'live', slug: 'live', name: 'Live Club', isActive: true }];
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: 'gone' });

    await screen.findByTestId(PANEL);

    // Children never mount, so nothing can send the stale id. The shell's own calls are the
    // exception and neither uses @TenantId().
    const shell = ['/auth/', '/api/tenants'];
    expect(fetchedUrls().filter((u) => !shell.some((s) => u.includes(s)))).toEqual([]);
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  // Absence from a capped list is not proof of absence, and above the cap the selector cannot offer
  // that club either — so the stored id is the only way into it. Discarding it would remove the
  // sole access path.
  it('keeps a stored club that is missing only because the list was truncated', async () => {
    clubs = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      slug: `c${i}`,
      name: `Club ${i}`,
      isActive: true,
    }));
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: 'club-101' });

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(readTenantContext()).toBe('club-101');
  });

  // A failed list says nothing about whether the stored club is valid, so refusing to render would
  // lock an administrator out of a good club whenever /tenants blips.
  it('keeps a stored club when the club list fails to load', async () => {
    clubsMode = 'fail';
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: 't' });

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(readTenantContext()).toBe('t');
    expect(screen.queryByTestId(FAILED)).not.toBeInTheDocument();
  });

  // A club written after this document loaded is newer than the list fetched at mount, so that list
  // is no evidence against it. The new-club form writes the club it has just created and then
  // reloads; judging that id against the older list threw the selection away and left the reload on
  // the no-club-selected panel, contradicting the client guides' story 2.
  it('keeps a club written after mount that the cached list cannot know about', async () => {
    clubs = [{ id: 'live', slug: 'live', name: 'Live Club', isActive: true }];
    renderLayout('SUPER_ADMIN', '/dashboard', { tenant: 'live' });
    expect(await screen.findByText(CHILD)).toBeInTheDocument();

    act(() => writeTenantContext('brand-new'));
    await settle();

    expect(readTenantContext()).toBe('brand-new');
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
  });

  // The SUPER_ADMIN path validates against the club list. A member's wrong stored club is repaired
  // by auth-provider.tsx:96-118 from the fresh membership list instead, so this ticket adds no
  // second writer for them; TKT-0057 closes the window before that repair lands.
  it('adds no club-list request and no second writer for a member', async () => {
    renderLayout('ADMIN', '/dashboard', {
      tenant: 'not-mine',
      memberships: [{ tenantId: 't', tenantName: 'Club', role: 'ADMIN' }],
    });

    // The provider's existing heal is what moves them, and it hard-navigates when it does.
    await waitFor(() => expect(readTenantContext()).toBe('t'));
    expect(fetchedUrls().some((u) => u.includes('/api/tenants'))).toBe(false);
  });
});

// TKT-0057: a member's stored club used to be trusted on sight, so a leftover from another
// environment (or a club they were removed from) let every page mount and answer 403
// `Not a member of this tenant` until auth-provider's fresh membership fetch repaired it. The gate
// now holds back for exactly that window — and only when the member's own snapshot already says the
// club is not theirs, so TKT-0039's snapshot-first recovery is untouched.
describe('DashboardLayout unverified member club', () => {
  const MINE: LoginMembership[] = [{ tenantId: 'mine', tenantName: 'Mine', role: 'ADMIN' }];

  beforeEach(() => {
    nav.replace.mockClear();
    hardNavigate.mockClear();
    writeTenantContext(null);
    writeStoredMemberships([]);
    membershipsResponse = [];
    clubs = ONE_CLUB;
    clubsMode = 'ok';
    resetClubsRequest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Leaves /auth/memberships pending so only what the gate does by itself is observable. */
  function mockPendingSync(): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      String(input).includes('/auth/memberships')
        ? new Promise<Response>(() => {})
        : Promise.resolve(jsonOf(membershipsResponse)),
    );
  }

  it('holds a member back while the stored club is not one of theirs', async () => {
    writeStoredMemberships(MINE);
    membershipsResponse = MINE;
    mockPendingSync();
    signIn('ADMIN');
    writeTenantContext('left-over');
    nav.pathname.current = '/dashboard';

    render(
      <I18nProvider>
        <AuthProvider>
          <DashboardLayout>
            <p>{CHILD}</p>
          </DashboardLayout>
        </AuthProvider>
      </I18nProvider>,
    );
    await settle();

    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    // Nothing may go out carrying the suspect id.
    const shell = ['/auth/'];
    expect(fetchedUrls().filter((u) => !shell.some((s) => u.includes(s)))).toEqual([]);
    // And the gate writes nothing — auth-provider.tsx:96-118 stays the only writer.
    expect(readTenantContext()).toBe('left-over');
  });

  it('renders immediately for a member whose stored club is one of theirs', async () => {
    writeStoredMemberships(MINE);
    membershipsResponse = MINE;
    mockPendingSync();
    signIn('ADMIN');
    writeTenantContext('mine');
    nav.pathname.current = '/dashboard';

    render(
      <I18nProvider>
        <AuthProvider>
          <DashboardLayout>
            <p>{CHILD}</p>
          </DashboardLayout>
        </AuthProvider>
      </I18nProvider>,
    );

    // The snapshot vouches for it, so no wait on the server — TKT-0039's behaviour.
    expect(await screen.findByText(CHILD)).toBeInTheDocument();
  });

  it('renders once the membership sync fails rather than holding forever', async () => {
    writeStoredMemberships(MINE);
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      String(input).includes('/auth/memberships')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(jsonOf(membershipsResponse)),
    );
    signIn('ADMIN');
    writeTenantContext('left-over');
    nav.pathname.current = '/dashboard';

    render(
      <I18nProvider>
        <AuthProvider>
          <DashboardLayout>
            <p>{CHILD}</p>
          </DashboardLayout>
        </AuthProvider>
      </I18nProvider>,
    );

    // A failed sync says nothing about the stored club, so holding would lock the member out of
    // their own data over one bad request.
    expect(await screen.findByText(CHILD)).toBeInTheDocument();
  });
});
