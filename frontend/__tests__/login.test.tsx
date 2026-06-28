import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/login/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { clearStoredTokens, readStoredTokens } from '@/lib/auth-storage';

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
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { accessToken, refreshToken: 'R' }));

    renderLogin();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'admin@demo.local');
    await user.type(screen.getByLabelText(/Password|Парола/), 'pass1234');
    await user.click(screen.getByRole('button', { name: /Sign in|Вход/ }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: 'admin@demo.local',
      password: 'pass1234',
    });
    expect(readStoredTokens()).toEqual({ accessToken, refreshToken: 'R' });
  });

  it('shows the invalid-credentials message on a 401 response', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(401, { message: 'Invalid credentials' }),
    );

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

    expect(fetchMock).not.toHaveBeenCalled();
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
