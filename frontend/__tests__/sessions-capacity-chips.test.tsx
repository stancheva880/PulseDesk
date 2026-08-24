import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import SessionsListPage from '@/app/(dashboard)/sessions/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sessions',
  useSearchParams: () => new URLSearchParams(''),
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
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

// Two sessions today at 10:00/12:00 local — inside the default week view anywhere.
const now = new Date();
const at = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0);
const SESSIONS = [
  {
    id: 's-capped', tenantId: 't', classId: 'c-capped', locationId: 'l',
    startsAt: at(10).toISOString(), endsAt: at(11).toISOString(),
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
    _count: { attendances: 3 },
  },
  {
    id: 's-open', tenantId: 't', classId: 'c-open', locationId: 'l',
    startsAt: at(12).toISOString(), endsAt: at(13).toISOString(),
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
    _count: { attendances: 5 },
  },
];
const CLASSES = [
  { id: 'c-capped', tenantId: 't', name: 'Yoga', billingMode: 'PER_SESSION', capacity: 8, isActive: true },
  { id: 'c-open', tenantId: 't', name: 'Pilates', billingMode: 'PER_SESSION', capacity: null, isActive: true },
];
const LOCATIONS = [{ id: 'l', tenantId: 't', name: 'Main', address: null, isActive: true }];

describe('staff calendar occupancy chips (TKT-0103)', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) return Promise.resolve(jsonResponse(200, paged(SESSIONS)));
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      if (url.includes('/users')) return Promise.resolve(jsonResponse(200, paged([])));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC #7 — X/Y on chips of capped classes, nothing on unlimited ones.
  it('shows n/cap on capped chips and omits it on unlimited ones', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    await waitFor(() => {
      const capped = container.querySelector('a[href="/sessions/s-capped/attendance"]');
      expect(capped).not.toBeNull();
      expect(capped!.textContent).toContain('3/8');
    });

    const open = container.querySelector('a[href="/sessions/s-open/attendance"]')!;
    expect(open.textContent).toContain('Pilates');
    expect(open.textContent).not.toMatch(/\d+\/\d+/);
  });
});
