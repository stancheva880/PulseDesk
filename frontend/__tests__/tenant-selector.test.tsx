import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setAccessToken } from '@/lib/auth-storage';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { TenantSelector } from '@/components/tenant-selector';

// Navigation helpers are module-mocked — jsdom can't assert on window.location.
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function seedSession(opts: {
  role: string;
  tenantId: string | null;
  memberships: { tenantId: string; tenantName: string; role: string }[];
  activeTenant?: string;
}) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const accessToken = buildJwt({
    sub: 'u1',
    email: 'owner@demo.local',
    role: opts.role,
    tenantId: opts.tenantId,
    exp,
  });
  // TKT-0036: the access token lives in memory; the refresh token is an httpOnly
  // cookie the client cannot set. Same intent — establish a signed-in session.
  setAccessToken(accessToken);
  window.localStorage.setItem('pulsedesk.memberships', JSON.stringify(opts.memberships));
  if (opts.activeTenant) {
    window.localStorage.setItem('pulsedesk.tenantContext', opts.activeTenant);
  }
}

const TWO_MEMBERSHIPS = [
  { tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' },
  { tenantId: 't2', tenantName: 'Club Two', role: 'CUSTOMER' },
];

function renderSelector() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <TenantSelector />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('TenantSelector (membership switcher)', () => {
  beforeEach(() => {
    hardNavigate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists exactly the user’s own memberships (name + role), not all tenants', async () => {
    // TKT-0006 change request (approved): the AuthProvider now refetches
    // /auth/memberships on mount, so "no fetch at all" became wrong by spec.
    // The preserved assertion: the switcher never loads the all-tenants list.
    // TKT-0014 change request (approved): native <select> — options are always in
    // the DOM, no popup to open; asserted outcomes unchanged.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, TWO_MEMBERSHIPS));
    seedSession({ role: 'ADMIN', tenantId: 't1', memberships: TWO_MEMBERSHIPS, activeTenant: 't1' });

    renderSelector();
    await screen.findByRole('combobox');

    expect(await screen.findByText(/Club Two/)).toBeInTheDocument();
    expect(screen.getAllByText(/Club One/).length).toBeGreaterThan(0);
    // Per-membership role labels, not the raw enum.
    expect(screen.getAllByText(/Administrator|Администратор/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Customer|Клиент/).length).toBeGreaterThan(0);
    // Own memberships come from storage — never the all-tenants endpoint.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/tenants'))).toBe(true);
  });

  it('switching writes the tenant context and hard-navigates per the new membership role', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, TWO_MEMBERSHIPS));
    seedSession({ role: 'ADMIN', tenantId: 't1', memberships: TWO_MEMBERSHIPS, activeTenant: 't1' });
    const user = userEvent.setup();

    renderSelector();
    await user.selectOptions(await screen.findByRole('combobox'), 't2');

    expect(window.localStorage.getItem('pulsedesk.tenantContext')).toBe('t2');
    // Club Two membership is CUSTOMER — lands in the portal (hard navigation = reload).
    expect(hardNavigate).toHaveBeenCalledWith('/portal/schedule');
  });

  it('renders nothing for a single-membership non-super user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]),
    );
    seedSession({
      role: 'ADMIN',
      tenantId: 't1',
      memberships: [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }],
      activeTenant: 't1',
    });

    renderSelector();
    await vi.waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(screen.queryByText('Club One')).toBeNull();
  });
});

// TKT-0132: SUPER_ADMIN gets a delete option next to the tenant dropdown — irreversible
// (schema.prisma cascades everything the club owns), so confirming requires typing the exact
// club name, same shape as GitHub's "type the repo name" delete flow.
describe('TenantSelector (super admin)', () => {
  const CLUBS = [
    { id: 't1', slug: 'club-one', name: 'Club One', isActive: true },
    { id: 't2', slug: 'club-two', name: 'Club Two', isActive: true },
  ];

  function seedSuperAdmin(activeTenant = 't1') {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(
      buildJwt({ sub: 'su', email: 'su@x', role: 'SUPER_ADMIN', tenantId: null, exp }),
    );
    window.localStorage.setItem('pulsedesk.tenantContext', activeTenant);
  }

  beforeEach(() => {
    hardNavigate.mockClear();
    reloadApp.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('disables the delete button until a club is selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, CLUBS));
    seedSuperAdmin('');

    renderSelector();
    await screen.findByRole('combobox');

    expect(screen.getByRole('button', { name: /Delete club|Изтриване на клуб/ })).toBeDisabled();
  });

  it('names the selected club and keeps Delete disabled until the typed name matches exactly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, CLUBS));
    seedSuperAdmin('t1');
    const user = userEvent.setup();

    renderSelector();
    await screen.findByRole('option', { name: /Club One/ });
    await user.click(screen.getByRole('button', { name: /Delete club|Изтриване на клуб/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Club One/)).toBeInTheDocument();
    const confirmDelete = within(dialog).getByRole('button', { name: /^Delete$|^Изтриване$/ });
    expect(confirmDelete).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'not the name');
    expect(confirmDelete).toBeDisabled();

    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Club One');
    expect(confirmDelete).not.toBeDisabled();
  });

  it('deletes the club, clears the tenant context, and reloads on success', async () => {
    let deleteCalled: { url: string; method: string } | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.endsWith('/tenants/t1') && method === 'DELETE') {
        deleteCalled = { url, method };
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, CLUBS));
    });
    seedSuperAdmin('t1');
    const user = userEvent.setup();

    renderSelector();
    await screen.findByRole('option', { name: /Club One/ });
    await user.click(screen.getByRole('button', { name: /Delete club|Изтриване на клуб/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Club One');
    await user.click(within(dialog).getByRole('button', { name: /^Delete$|^Изтриване$/ }));

    await vi.waitFor(() => expect(deleteCalled).not.toBeNull());
    expect(window.localStorage.getItem('pulsedesk.tenantContext')).toBeNull();
    expect(reloadApp).toHaveBeenCalled();
  });

  it('shows the server error and keeps the dialog open when the delete fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.endsWith('/tenants/t1') && method === 'DELETE') {
        return Promise.resolve(
          jsonResponse(409, { statusCode: 409, message: 'Club still in use' }),
        );
      }
      return Promise.resolve(jsonResponse(200, CLUBS));
    });
    seedSuperAdmin('t1');
    const user = userEvent.setup();

    renderSelector();
    await screen.findByRole('option', { name: /Club One/ });
    await user.click(screen.getByRole('button', { name: /Delete club|Изтриване на клуб/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Club One');
    await user.click(within(dialog).getByRole('button', { name: /^Delete$|^Изтриване$/ }));

    expect(await within(dialog).findByText(/Club still in use/)).toBeInTheDocument();
    expect(reloadApp).not.toHaveBeenCalled();
  });
});
