import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TraineesListPage from '@/app/(dashboard)/trainees/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push, back: vi.fn() }),
  usePathname: () => '/trainees',
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
function paged<T>(items: T[]): unknown {
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 };
}

const TRAINEES = [
  {
    id: 'tr-1', tenantId: 't', firstName: 'Ada', lastName: 'Lovelace',
    dateOfBirth: '1990-01-01', phone: null, email: null, notes: null,
    isActive: true, userId: null, createdAt: '', updatedAt: '',
  },
];

describe('TraineesListPage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/trainees')) return Promise.resolve(jsonResponse(200, paged(TRAINEES)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders trainee rows with names and admin links', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <TraineesListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(container.querySelector('a[href="/trainees/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/trainees/tr-1/edit"]')).not.toBeNull();
    expect(container.querySelector('a[href="/trainees/tr-1"]')).not.toBeNull();
  });

  it('gives a trainer the read-only row link and nothing that writes', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'EMPLOYEE', tenantId: 't', exp }));

    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <TraineesListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Lovelace')).toBeInTheDocument();
    expect(container.querySelector('a[href="/trainees/tr-1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/trainees/new"]')).toBeNull();
    expect(container.querySelector('a[href="/trainees/tr-1/edit"]')).toBeNull();
  });

  // TKT-0088: the row itself opens the record — the detail page for trainees.
  it('opens the trainee detail when the row is activated', async () => {
    push.mockReset();
    render(
      <I18nProvider>
        <AuthProvider>
          <TraineesListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByText('Lovelace'));

    expect(push).toHaveBeenCalledWith('/trainees/tr-1');
  });
});

// TKT-0093: the search box sends the DTO's `search` parameter; the server filters, the
// pagination envelope carries the filtered total, and clearing returns the unfiltered first page.
describe('TraineesListPage search', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const paramOf = (url: string, key: string) =>
    new URL(url, 'http://test.local').searchParams.get(key);

  // Unfiltered: 100 rows over 4 pages. Filtered: 30 rows over 2 pages.
  function renderWithCapture() {
    const urls: string[] = [];
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/trainees')) {
        urls.push(url);
        const filtered = paramOf(url, 'search') !== null;
        return Promise.resolve(
          jsonResponse(200, {
            items: TRAINEES,
            page: Number(paramOf(url, 'page') ?? '1'),
            pageSize: 25,
            total: filtered ? 30 : 100,
            totalPages: filtered ? 2 : 4,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    render(
      <I18nProvider>
        <AuthProvider>
          <TraineesListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    return urls;
  }

  const lastTraineesUrl = (urls: string[]) => urls.filter((u) => u.includes('/trainees')).pop()!;

  it('sends the query as the search parameter and resets to page 1', async () => {
    const urls = renderWithCapture();
    await screen.findByText('Lovelace');

    // Move off page 1 first, so the reset is observable.
    fireEvent.click(screen.getByRole('button', { name: /Next|Напред/ }));
    await waitFor(() => expect(paramOf(lastTraineesUrl(urls), 'page')).toBe('2'));

    fireEvent.change(screen.getByPlaceholderText(/Search|Търсене/), {
      target: { value: 'iva' },
    });

    await waitFor(() => {
      const last = lastTraineesUrl(urls);
      expect(paramOf(last, 'search')).toBe('iva');
      expect(paramOf(last, 'page')).toBe('1');
    });
  });

  it('paginates within the filtered set', async () => {
    const urls = renderWithCapture();
    await screen.findByText('Lovelace');

    fireEvent.change(screen.getByPlaceholderText(/Search|Търсене/), {
      target: { value: 'iva' },
    });
    await waitFor(() => expect(paramOf(lastTraineesUrl(urls), 'search')).toBe('iva'));

    // The summary shows the filtered total from the envelope, not the unfiltered 100.
    expect(await screen.findByText(/30/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next|Напред/ }));

    await waitFor(() => {
      const last = lastTraineesUrl(urls);
      expect(paramOf(last, 'page')).toBe('2');
      expect(paramOf(last, 'search')).toBe('iva');
    });
  });

  it('clearing the search returns the unfiltered first page', async () => {
    const urls = renderWithCapture();
    await screen.findByText('Lovelace');

    const box = screen.getByPlaceholderText(/Search|Търсене/);
    fireEvent.change(box, { target: { value: 'iva' } });
    await waitFor(() => expect(paramOf(lastTraineesUrl(urls), 'search')).toBe('iva'));

    fireEvent.change(box, { target: { value: '' } });

    await waitFor(() => {
      const last = lastTraineesUrl(urls);
      expect(paramOf(last, 'search')).toBeNull();
      expect(paramOf(last, 'page')).toBe('1');
    });
  });
});
