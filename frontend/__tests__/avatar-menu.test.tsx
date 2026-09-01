import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AvatarMenu } from '@/components/avatar-menu';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { broadcastAvatarChanged } from '@/lib/avatar-context';
import { clearStoredTokens, setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  const noBody = status === 204 || body == null;
  return new Response(noBody ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    return Promise.resolve(handler(url, init));
  });
}

function renderMenu() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <AvatarMenu />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('AvatarMenu', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u1', email: 'ada@x.com', role: 'ADMIN', tenantId: 't', exp }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearStoredTokens();
    replace.mockClear();
  });

  it('shows the email initial when there is no avatar', async () => {
    mockFetch(() => jsonResponse(404, null));
    renderMenu();
    expect(await screen.findByText('A')).toBeInTheDocument();
  });

  it('shows the fetched avatar image', async () => {
    mockFetch((url) => {
      if (url.endsWith('/users/me')) {
        return jsonResponse(200, {
          id: 'u1',
          email: 'ada@x.com',
          firstName: null,
          lastName: null,
          phone: null,
          avatarUrl: 'data:image/jpeg;base64,AAAA',
        });
      }
      return jsonResponse(404, null);
    });
    const { container } = renderMenu();
    // alt="" is deliberate (decorative — the button already carries the aria-label), which
    // takes it out of the accessibility tree, so this is a DOM query rather than getByRole.
    await vi.waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA'),
    );
  });

  it('opens on click and offers Edit profile + Logout', async () => {
    const user = userEvent.setup();
    mockFetch(() => jsonResponse(404, null));
    renderMenu();

    await user.click(await screen.findByRole('button', { name: /Profile|Профил/ }));

    expect(screen.getByRole('menuitem', { name: /Edit profile|Редактиране на профил/ })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getByRole('menuitem', { name: /Sign out|Изход/ })).toBeInTheDocument();
  });

  it('logs out and redirects to /login when Logout is clicked', async () => {
    const user = userEvent.setup();
    mockFetch(() => jsonResponse(204, null));
    renderMenu();

    await user.click(await screen.findByRole('button', { name: /Profile|Профил/ }));
    await user.click(screen.getByRole('menuitem', { name: /Sign out|Изход/ }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('closes when clicking outside', async () => {
    const user = userEvent.setup();
    mockFetch(() => jsonResponse(404, null));
    renderMenu();

    await user.click(await screen.findByRole('button', { name: /Profile|Профил/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('updates live when the profile page broadcasts a new avatar', async () => {
    mockFetch(() => jsonResponse(404, null));
    const { container } = renderMenu();
    await screen.findByText('A');

    broadcastAvatarChanged('data:image/jpeg;base64,BBBB');

    await vi.waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,BBBB'),
    );
  });
});
