import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsersListPage from '@/app/(dashboard)/users/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';

let searchParamsValue = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EMPTY_PAGE = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <UsersListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('Users list — attached-existing banner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    searchParamsValue = '';
  });

  it('shows the attached-existing banner when ?attached=1', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, EMPTY_PAGE));
    searchParamsValue = 'attached=1';

    renderPage();
    const banner = await screen.findByRole('status');
    expect(banner.textContent).toMatch(/password is unchanged|паролата им остава/i);
  });

  it('hides the banner without the query param', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, EMPTY_PAGE));

    renderPage();
    expect(await screen.findByText(/Users|Потребители/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
