import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SessionsListPage from '@/app/(dashboard)/sessions/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sessions',
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

const SESSIONS = [
  {
    id: 's1', tenantId: 't', classId: 'c1', locationId: 'loc-1',
    startsAt: '2026-03-02T10:00:00.000Z', endsAt: '2026-03-02T11:00:00.000Z',
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
  },
];
const CLASSES = [{ id: 'c1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true }];
const LOCATIONS = [{ id: 'loc-1', tenantId: 't', name: 'Main Hall', address: null, isActive: true }];

describe('SessionsListPage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) return Promise.resolve(jsonResponse(200, paged(SESSIONS)));
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders session rows with lookups, attendance link and admin edit link', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Yoga')).toBeInTheDocument();
    expect(screen.getByText('Main Hall')).toBeInTheDocument();
    expect(container.querySelector('a[href="/sessions/s1/attendance"]')).not.toBeNull();
    expect(container.querySelector('a[href="/sessions/s1/edit"]')).not.toBeNull();
    expect(container.querySelector('a[href="/sessions/new"]')).not.toBeNull();
  });
});
