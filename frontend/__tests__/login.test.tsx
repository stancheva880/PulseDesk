import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/login/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ThemeProvider } from 'next-themes';
import { clearStoredTokens, getAccessToken } from '@/lib/auth-storage';

// TKT-0036: AuthProvider asks /auth/refresh on mount whether a session cookie exists, so
// every render here makes one extra call. Route by URL instead of by mock ordering, and
// give the bootstrap its honest anonymous answer.
function mockLogin(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) return Promise.resolve(jsonResponse(401, { message: 'No session' }));
    if (url.endsWith('/auth/login')) return Promise.resolve(jsonResponse(status, body));
    return Promise.resolve(jsonResponse(200, []));
  });
}

function loginCalls(m: { mock: { calls: unknown[][] } }) {
  return m.mock.calls.filter((c) => String(c[0]).endsWith('/auth/login'));
}

const replace = vi.fn();
let searchParamsValue = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(searchParamsValue),
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

function renderLogin() {
  return render(
    <I18nProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    clearStoredTokens();
    window.localStorage.removeItem('pulsedesk.tenantContext');
    replace.mockClear();
    searchParamsValue = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the form', async () => {
    renderLogin();
    expect(await screen.findByLabelText(/Email|Имейл/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password|Парола/)).toBeInTheDocument();
  });

  it('submits credentials, stores tokens, and navigates to /dashboard on success', async () => {
    const user = userEvent.setup();
    const exp = Math.floor(Date.now() / 1000) + 600;
    const accessToken = buildJwt({
      sub: 'u1',
      email: 'admin@demo.local',
      role: 'ADMIN',
      tenantId: 't1',
      exp,
    });
    const fetchMock = mockLogin({ accessToken });

    renderLogin();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'admin@demo.local');
    await user.type(screen.getByLabelText(/Password|Парола/), 'pass1234');
    await user.click(screen.getByRole('button', { name: /Sign in|Вход/ }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    // Scoped to /auth/login under the approved TCR: the mount-time bootstrap call means
    // total request count is no longer a statement about login behaviour.
    expect(loginCalls(fetchMock)).toHaveLength(1);
    const [, init] = loginCalls(fetchMock)[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: 'admin@demo.local',
      password: 'pass1234',
    });
    // TKT-0036 (approved TCR): the refresh token arrives as an httpOnly Set-Cookie and
    // is never visible to this code. Only the access token is held, and in memory.
    expect(getAccessToken()).toBe(accessToken);
    expect(window.localStorage.getItem('pulsedesk.refresh')).toBeNull();
  });

  it('single membership: writes the tenant context and redirects per the membership role (no picker)', async () => {
    const user = userEvent.setup();
    const exp = Math.floor(Date.now() / 1000) + 600;
    const accessToken = buildJwt({
      sub: 'u1',
      email: 'coach@demo.local',
      role: 'EMPLOYEE',
      tenantId: 't1',
      exp,
    });
    mockLogin({
      accessToken,
      memberships: [{ tenantId: 't1', tenantName: 'Club One', role: 'EMPLOYEE' }],
    });

    renderLogin();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'coach@demo.local');
    await user.type(screen.getByLabelText(/Password|Парола/), 'pass1234');
    await user.click(screen.getByRole('button', { name: /Sign in|Вход/ }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(window.localStorage.getItem('pulsedesk.tenantContext')).toBe('t1');
    expect(screen.queryByText('Club One')).toBeNull();
  });

  it('multiple memberships: shows the tenant picker; picking writes the context and redirects per that role', async () => {
    const user = userEvent.setup();
    const exp = Math.floor(Date.now() / 1000) + 600;
    const accessToken = buildJwt({
      sub: 'u1',
      email: 'owner@demo.local',
      role: 'ADMIN',
      tenantId: 't1',
      exp,
    });
    mockLogin({
      accessToken,
      memberships: [
        { tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' },
        { tenantId: 't2', tenantName: 'Club Two', role: 'CUSTOMER' },
      ],
    });

    renderLogin();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'owner@demo.local');
    await user.type(screen.getByLabelText(/Password|Парола/), 'pass1234');
    await user.click(screen.getByRole('button', { name: /Sign in|Вход/ }));

    // Picker visible, no redirect yet.
    expect(await screen.findByText('Club One')).toBeInTheDocument();
    expect(screen.getByText('Club Two')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    await user.click(screen.getByText('Club Two'));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/portal/schedule'));
    expect(window.localStorage.getItem('pulsedesk.tenantContext')).toBe('t2');
  });

  it('shows the invalid-credentials message on a 401 response', async () => {
    const user = userEvent.setup();
    mockLogin({ message: 'Invalid credentials' }, 401);

    renderLogin();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'admin@demo.local');
    await user.type(screen.getByLabelText(/Password|Парола/), 'wrong');
    await user.click(screen.getByRole('button', { name: /Sign in|Вход/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Invalid credentials|Невалидни/);
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks submission on client-side validation errors', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    renderLogin();
    await user.click(await screen.findByRole('button', { name: /Sign in|Вход/ }));

    expect(loginCalls(fetchMock)).toHaveLength(0);
  });

  it('renders a "Forgot your password?" link to /forgot-password', async () => {
    renderLogin();
    const link = await screen.findByRole('link', { name: /Forgot your password|Забравена парола/ });
    expect(link).toHaveAttribute('href', '/forgot-password');
  });

  it('shows the reset-success banner when ?reset=ok is present', async () => {
    searchParamsValue = 'reset=ok';
    renderLogin();
    const banner = await screen.findByRole('status');
    expect(banner.textContent).toMatch(/Password updated|Паролата е обновена/);
  });

  it('hides the reset-success banner when ?reset is absent', async () => {
    renderLogin();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the theme toggle in the corner', async () => {
    renderLogin();
    const themeBtn = await screen.findByRole('button', { name: /Theme|Тема/i });
    expect(themeBtn).toBeInTheDocument();
  });
});
