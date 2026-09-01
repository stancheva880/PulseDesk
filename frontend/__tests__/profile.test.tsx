import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilePage from '@/app/profile/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { clearStoredTokens, setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/profile',
  useSearchParams: () => new URLSearchParams(),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  // 204 No Content disallows a body in the Fetch spec.
  const noBody = status === 204 || body == null;
  return new Response(noBody ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <ProfilePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    return Promise.resolve(handler(url, init));
  });
}

// Reachable by any signed-in role — EMPLOYEE stands in for "not an admin", which is the
// case @Roles(ADMIN) on the rest of UsersController would otherwise block.
describe('ProfilePage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u1', email: 'employee@x', role: 'EMPLOYEE', tenantId: 't', exp }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearStoredTokens();
    replace.mockClear();
  });

  it('renders the current/new/confirm password fields', async () => {
    mockFetch(() => jsonResponse(404, null));
    renderPage();
    expect(await screen.findByLabelText(/Current password|Текуща парола/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^New password$|^Нова парола$/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Confirm new password|Потвърдете новата парола/),
    ).toBeInTheDocument();
  });

  it('submits current + new password to PATCH /users/me/password, then signs out to /login?reset=ok', async () => {
    const user = userEvent.setup();
    let postedTo: string | null = null;
    let postedBody: unknown = null;
    mockFetch((url, init) => {
      if (url.endsWith('/users/me/password') && init?.method === 'PATCH') {
        postedTo = url;
        postedBody = JSON.parse(init.body as string);
        return jsonResponse(204, null);
      }
      return jsonResponse(204, null); // /auth/logout — best-effort, any answer is fine
    });
    renderPage();

    await user.type(await screen.findByLabelText(/Current password|Текуща парола/), 'OldPass123!');
    await user.type(screen.getByLabelText(/^New password$|^Нова парола$/), 'BrandNew123!');
    await user.type(
      screen.getByLabelText(/Confirm new password|Потвърдете новата парола/),
      'BrandNew123!',
    );
    await user.click(screen.getByRole('button', { name: /Change password|Смяна на парола/ }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reset=ok'));
    expect(postedTo).toContain('/users/me/password');
    expect(postedBody).toEqual({ currentPassword: 'OldPass123!', newPassword: 'BrandNew123!' });
  });

  it('shows the server message on a wrong current password (400) and does not sign out', async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (url.endsWith('/users/me/password') && init?.method === 'PATCH') {
        return jsonResponse(400, {
          message: 'Current password is incorrect',
          code: 'AUTH_CURRENT_PASSWORD_INVALID',
        });
      }
      return jsonResponse(404, null);
    });
    renderPage();

    await user.type(await screen.findByLabelText(/Current password|Текуща парола/), 'WrongPass!');
    await user.type(screen.getByLabelText(/^New password$|^Нова парола$/), 'BrandNew123!');
    await user.type(
      screen.getByLabelText(/Confirm new password|Потвърдете новата парола/),
      'BrandNew123!',
    );
    await user.click(screen.getByRole('button', { name: /Change password|Смяна на парола/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/incorrect|не е вярна/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks submission when the new passwords do not match', async () => {
    const user = userEvent.setup();
    // Background auth calls (session bootstrap, membership sync) still need answers —
    // only /users/me/password itself must never be reached.
    const fetchSpy = mockFetch(() => jsonResponse(404, null));
    renderPage();

    await user.type(await screen.findByLabelText(/Current password|Текуща парола/), 'OldPass123!');
    await user.type(screen.getByLabelText(/^New password$|^Нова парола$/), 'BrandNew123!');
    await user.type(
      screen.getByLabelText(/Confirm new password|Потвърдете новата парола/),
      'Mismatched1!',
    );
    await user.click(screen.getByRole('button', { name: /Change password|Смяна на парола/ }));

    expect(await screen.findByText(/do not match|не съвпадат/i)).toBeInTheDocument();
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(typeof input === 'string' ? input : (input as Request).url).includes(
          '/users/me/password',
        ),
      ),
    ).toBe(false);
  });
});
