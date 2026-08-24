import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PortalCardsPage from '@/app/(portal)/portal/cards/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/cards',
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

const CARD_BASE = {
  traineeId: 'tr1',
  totalVisits: 12,
  visitsUsed: 2,
  visitsRemaining: 10,
  expiresAt: '2027-01-01T00:00:00.000Z',
  cancelledAt: null,
  class: { id: 'c1', name: 'Yoga 101' },
  trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
};

describe('Portal cards page (TKT-0116)', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'CUSTOMER', tenantId: 't', exp }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockApi(cards: unknown[]) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/me/cards')) return jsonResponse(200, cards);
      return jsonResponse(200, []);
    });
  }

  function renderPage() {
    return render(
      <I18nProvider>
        <AuthProvider>
          <PortalCardsPage />
        </AuthProvider>
      </I18nProvider>,
    );
  }

  it('groups cards under the trainee and shows scope + visit counters', async () => {
    mockApi([
      { ...CARD_BASE, id: 'card-1' },
      {
        ...CARD_BASE,
        id: 'card-2',
        traineeId: 'tr2',
        class: null,
        trainee: { id: 'tr2', firstName: 'Bob', lastName: 'Builder' },
      },
    ]);
    renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
    expect(screen.getByText('Yoga 101')).toBeInTheDocument();
    // Tenant-wide card shows the whole-club label instead of a class name.
    expect(screen.getByText('Цял клуб')).toBeInTheDocument();
    // Counter: remaining of total.
    expect(screen.getAllByText('10 / 12')).toHaveLength(2);
  });

  it('marks exhausted and expired cards, leaves a healthy one unmarked, offers no buttons (AC #2, #3)', async () => {
    mockApi([
      { ...CARD_BASE, id: 'healthy' },
      { ...CARD_BASE, id: 'empty', visitsUsed: 12, visitsRemaining: 0 },
      { ...CARD_BASE, id: 'old', expiresAt: '2020-01-01T00:00:00.000Z' },
      { ...CARD_BASE, id: 'dead', cancelledAt: '2026-08-01T00:00:00.000Z' },
    ]);
    const { container } = renderPage();

    expect(await screen.findByText('Изчерпана')).toBeInTheDocument();
    expect(screen.getByText('Изтекла')).toBeInTheDocument();
    expect(screen.getByText('Анулирана')).toBeInTheDocument();
    // Exactly the three marked cards carry a badge — the healthy one does not.
    expect(screen.getAllByTestId('card-badge')).toHaveLength(3);
    // Read-only: no write controls anywhere on the page (AC #3).
    expect(within(container).queryAllByRole('button')).toHaveLength(0);
  });

  it('shows the empty state', async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText('Все още няма карти.')).toBeInTheDocument();
  });
});
