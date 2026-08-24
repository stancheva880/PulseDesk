import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UsersListPage from '@/app/(dashboard)/users/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/users',
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

const USERS = [
  {
    id: 'u1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: null,
    role: 'EMPLOYEE',
    locations: [],
    status: 'ACTIVE',
  },
];

// TKT-0093: the users list gets a search box wired to the DTO's existing `search` parameter.
describe('UsersListPage search', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const paramOf = (url: string, key: string) =>
    new URL(url, 'http://test.local').searchParams.get(key);

  it('sends the query as the search parameter and resets to page 1', async () => {
    const urls: string[] = [];
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/users')) {
        urls.push(url);
        return Promise.resolve(
          jsonResponse(200, {
            items: USERS,
            page: Number(paramOf(url, 'page') ?? '1'),
            pageSize: 25,
            total: 1,
            totalPages: 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    render(
      <I18nProvider>
        <AuthProvider>
          <UsersListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByText('ada@example.com');

    fireEvent.change(screen.getByPlaceholderText(/Search|Търсене/), {
      target: { value: 'ada' },
    });

    await waitFor(() => {
      const last = urls.filter((u) => u.includes('/users')).pop()!;
      expect(paramOf(last, 'search')).toBe('ada');
      expect(paramOf(last, 'page')).toBe('1');
    });
  });
});
