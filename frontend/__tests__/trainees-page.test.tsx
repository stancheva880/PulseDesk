import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TraineesListPage from '@/app/(dashboard)/trainees/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
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
});
