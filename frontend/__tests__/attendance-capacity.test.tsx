import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AttendancePage from '@/app/(dashboard)/sessions/[id]/attendance/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'session-1' }),
  usePathname: () => '/sessions/session-1/attendance',
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

function sessionDetail(capacity: number | null) {
  return {
    id: 'session-1', tenantId: 't', classId: 'c', locationId: 'l',
    startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-01T19:00:00.000Z',
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
    class: { id: 'c', name: 'Yoga 101', billingMode: 'PER_SESSION', capacity },
    location: { id: 'l', name: 'Studio A' },
    trainers: [],
  };
}
const ROWS = [
  {
    id: 'a1', tenantId: 't', sessionId: 'session-1', traineeId: 'tr1',
    trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
    status: 'PENDING', traineeRsvp: null, notes: null,
    markedAt: null, markedById: null, markedByEmailSnapshot: null, markedByNameSnapshot: null,
    createdAt: '', updatedAt: '',
  },
];
const CANDIDATE = { id: 'tr9', tenantId: 't', firstName: 'Cara', lastName: 'Drop', isActive: true };

function candidatesPage(spotsLeft: number | null) {
  return {
    items: [CANDIDATE],
    page: 1,
    pageSize: 100,
    total: 1,
    totalPages: 1,
    spotsLeft,
  };
}

function mockApi(capacity: number | null, spotsLeft: number | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    // TKT-0112: the page loads the session's waitlist too; these cases don't exercise it.
    if (url.includes('/waitlist')) return Promise.resolve(jsonResponse(200, []));
    if (url.includes('/attendance-candidates')) {
      return Promise.resolve(jsonResponse(200, candidatesPage(spotsLeft)));
    }
    if (url.includes('/attendances')) return Promise.resolve(jsonResponse(200, ROWS));
    if (url.includes('/sessions/session-1')) {
      return Promise.resolve(jsonResponse(200, sessionDetail(capacity)));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <AttendancePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('AttendancePage capacity (TKT-0103)', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC #6 — occupied = capacity − spotsLeft, shown when the class has a capacity.
  it('shows occupied spots out of capacity', async () => {
    mockApi(8, 6);
    renderPage();

    expect(await screen.findByText('Заети 2 от 8')).toBeInTheDocument();
    // Spots remain — the picker stays usable.
    expect(screen.getByRole('combobox', { name: /Добавяне/ })).toBeEnabled();
  });

  // AC #6 — at zero spots the add control is disabled and says why.
  it('disables the add control when no spots are left', async () => {
    mockApi(1, 0);
    renderPage();

    expect(await screen.findByText('Заети 1 от 1')).toBeInTheDocument();
    expect(screen.getByText('Няма свободни места.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Добавяне/ })).toBeNull();
  });

  // Unlimited class — no occupancy line, picker as before.
  it('shows no occupancy line when the class is unlimited', async () => {
    mockApi(null, null);
    renderPage();

    expect(await screen.findByRole('combobox', { name: /Добавяне/ })).toBeEnabled();
    expect(screen.queryByText(/Заети/)).toBeNull();
  });
});
