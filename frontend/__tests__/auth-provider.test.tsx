import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { clearStoredTokens, getAccessToken, setAccessToken } from '@/lib/auth-storage';
import { AuthProvider, useAuth } from '@/components/auth-provider';
import { writeTenantContext } from '@/lib/tenant-context';

// Navigation helpers are module-mocked — jsdom can't assert on window.location.
const { reloadApp, hardNavigate } = vi.hoisted(() => ({
  reloadApp: vi.fn(),
  hardNavigate: vi.fn(),
}));
vi.mock('@/lib/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  reloadApp,
  hardNavigate,
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

function seedSession(opts: {
  role: string;
  tenantId: string | null;
  memberships?: { tenantId: string; tenantName: string; role: string }[];
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
  if (opts.memberships) {
    window.localStorage.setItem('pulsedesk.memberships', JSON.stringify(opts.memberships));
  }
  if (opts.activeTenant) {
    window.localStorage.setItem('pulsedesk.tenantContext', opts.activeTenant);
  }
}

const TWO_MEMBERSHIPS = [
  { tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' },
  { tenantId: 't2', tenantName: 'Club Two', role: 'CUSTOMER' },
];

function Probe() {
  const { user, status } = useAuth();
  return <div data-testid="probe">{`${status}:${user?.role ?? '-'}:${user?.tenantId ?? '-'}`}</div>;
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider (active membership)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    reloadApp.mockClear();
    hardNavigate.mockClear();
    // TKT-0036: the access token is module-level state now, so it survives between
    // tests unless cleared — a leftover token makes bootstrapSession skip its fetch.
    clearStoredTokens();
    window.localStorage.clear();
  });

  it('derives the effective role and tenant from the ACTIVE membership, not the JWT claim', async () => {
    // JWT was minted for the oldest membership (ADMIN@t1); the active tenant is t2.
    seedSession({ role: 'ADMIN', tenantId: 't1', memberships: TWO_MEMBERSHIPS, activeTenant: 't2' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, TWO_MEMBERSHIPS));

    renderProbe();
    expect(await screen.findByTestId('probe')).toHaveTextContent('authenticated:CUSTOMER:t2');
  });

  it('recomputes the effective role when the tenant context changes in this tab', async () => {
    seedSession({ role: 'ADMIN', tenantId: 't1', memberships: TWO_MEMBERSHIPS, activeTenant: 't1' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, TWO_MEMBERSHIPS));

    renderProbe();
    expect(await screen.findByTestId('probe')).toHaveTextContent('authenticated:ADMIN:t1');

    act(() => writeTenantContext('t2'));
    expect(await screen.findByTestId('probe')).toHaveTextContent('authenticated:CUSTOMER:t2');
  });

  it('falls back to the JWT claims when no memberships are stored (pre-upgrade session)', async () => {
    seedSession({ role: 'EMPLOYEE', tenantId: 't1' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, [{ tenantId: 't1', tenantName: 'Club One', role: 'EMPLOYEE' }]),
    );

    renderProbe();
    expect(await screen.findByTestId('probe')).toHaveTextContent('authenticated:EMPLOYEE:t1');
  });

  // TKT-0006: memberships snapshot refetched on app load.
  it('refetches memberships on mount (header-less) and overwrites the snapshot', async () => {
    seedSession({
      role: 'ADMIN',
      tenantId: 't1',
      memberships: [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }],
      activeTenant: 't1',
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, TWO_MEMBERSHIPS));

    renderProbe();
    await vi.waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('pulsedesk.memberships')!)).toEqual(
        TWO_MEMBERSHIPS,
      );
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/auth/memberships');
    // Header-less by design: a stale context must not 403 the refetch itself.
    expect((init as RequestInit).headers).not.toHaveProperty('X-Tenant-Id');
  });

  it('active tenant removed: auto-switches to the first remaining membership', async () => {
    seedSession({ role: 'ADMIN', tenantId: 't1', memberships: TWO_MEMBERSHIPS, activeTenant: 't2' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]),
    );

    renderProbe();
    await vi.waitFor(() => {
      expect(window.localStorage.getItem('pulsedesk.tenantContext')).toBe('t1');
    });
    expect(hardNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('last membership removed: clears tokens and navigates to /login', async () => {
    seedSession({
      role: 'ADMIN',
      tenantId: 't1',
      memberships: [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }],
      activeTenant: 't1',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, []));

    renderProbe();
    await vi.waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/login'));
    // Reading localStorage here would now pass vacuously — nothing is written there.
    expect(getAccessToken()).toBeNull();
  });

  it('reloads the tab when another tab changes the tenant context (storage event)', async () => {
    seedSession({ role: 'ADMIN', tenantId: 't1', memberships: TWO_MEMBERSHIPS, activeTenant: 't1' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, TWO_MEMBERSHIPS));

    renderProbe();
    // Boot is a round-trip now, and the cross-tab subscription is gated on
    // 'authenticated' — dispatching before it settles would test nothing.
    await vi.waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('authenticated'),
    );

    // Unrelated key — no reload.
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'other.key', oldValue: 'a', newValue: 'b' }),
      );
    });
    expect(reloadApp).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'pulsedesk.tenantContext',
          oldValue: 't1',
          newValue: 't2',
        }),
      );
    });
    expect(reloadApp).toHaveBeenCalled();
  });

  // TKT-0036 — the mount-time bootstrap replaced the synchronous localStorage read, so
  // it is behaviour in its own right rather than an untested side effect.
  describe('session bootstrap', () => {
    it('recovers a session from the refresh cookie when nothing is in memory', async () => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      const accessToken = buildJwt({
        sub: 'u1',
        email: 'owner@demo.local',
        role: 'ADMIN',
        tenantId: 't1',
        exp,
      });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
        Promise.resolve(
          String(input).endsWith('/auth/refresh')
            ? jsonResponse(200, { accessToken })
            : jsonResponse(200, [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]),
        ),
      );

      renderProbe();

      await vi.waitFor(() =>
        expect(screen.getByTestId('probe')).toHaveTextContent('authenticated:ADMIN'),
      );
      expect(getAccessToken()).toBe(accessToken);
      const refreshCalls = fetchMock.mock.calls.filter(([i]) =>
        String(i).endsWith('/auth/refresh'),
      );
      // Exactly one: an unconditional fetch would rotate twice under StrictMode.
      expect(refreshCalls).toHaveLength(1);
      // The cookie is the credential — nothing is sent in the body.
      expect((refreshCalls[0]![1] as RequestInit).body).toBeUndefined();
    });

    it('settles to anonymous when the cookie is missing or rejected', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(401, { message: 'Invalid refresh token' }),
      );

      renderProbe();

      await vi.waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('anonymous'));
      expect(getAccessToken()).toBeNull();
    });

    // A reload during a blip has no access token — that page load is anonymous either way — but the
    // cookie may still be perfectly good, so the club selection and the membership snapshot must
    // survive it. Wiping them turned a few offline seconds into re-picking the club.
    it('keeps the club context and the membership snapshot when the bootstrap refresh fails transiently', async () => {
      window.localStorage.setItem('pulsedesk.tenantContext', 't1');
      window.localStorage.setItem(
        'pulsedesk.memberships',
        JSON.stringify([{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]),
      );
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

      renderProbe();

      await vi.waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('anonymous'));
      expect(getAccessToken()).toBeNull();
      expect(window.localStorage.getItem('pulsedesk.tenantContext')).toBe('t1');
      expect(window.localStorage.getItem('pulsedesk.memberships')).not.toBeNull();
    });

    // The other half, stated so it cannot regress: a rejected cookie is the end of the session, and
    // the stored state goes with it (TKT-0056 — a club id outliving its database).
    it('clears the club context and the snapshot when the cookie is rejected', async () => {
      window.localStorage.setItem('pulsedesk.tenantContext', 't1');
      window.localStorage.setItem(
        'pulsedesk.memberships',
        JSON.stringify([{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]),
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(401, { message: 'Invalid refresh token' }),
      );

      renderProbe();

      await vi.waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('anonymous'));
      expect(window.localStorage.getItem('pulsedesk.tenantContext')).toBeNull();
      expect(window.localStorage.getItem('pulsedesk.memberships')).toBeNull();
    });
  });
});
