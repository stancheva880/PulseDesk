import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CardsPage from '@/app/(dashboard)/cards/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/cards',
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
function paginated<T>(items: T[]) {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

const CARD_BASE = {
  id: 'c1',
  tenantId: 't',
  traineeId: 'tr1',
  classId: null,
  feeId: 'fee1',
  totalVisits: 12,
  price: '120',
  expiresAt: null,
  cancelledAt: null,
  visitsUsed: 7,
  visitsRemaining: 5,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const TRAINEE = {
  id: 'tr1',
  tenantId: 't',
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '2000-01-01T00:00:00.000Z',
  notes: null,
  userId: null,
  createdAt: '',
  updatedAt: '',
};

// Stubs the page's three loads; POST hooks record what the flow sends and in which order.
function stubFetch(opts: {
  card?: Partial<typeof CARD_BASE>;
  onRefund?: (body: unknown) => Response;
  onCancel?: (body: unknown) => Response;
  calls: string[];
}) {
  const card = { ...CARD_BASE, ...opts.card };
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.endsWith(`/fees/${card.feeId}/refunds`)) {
      opts.calls.push('refund');
      const body = JSON.parse(init!.body as string) as unknown;
      return Promise.resolve(opts.onRefund?.(body) ?? jsonResponse(201, { id: 'r1' }));
    }
    if (method === 'POST' && url.endsWith(`/cards/${card.id}/cancel`)) {
      opts.calls.push('cancel');
      return Promise.resolve(
        opts.onCancel?.(init) ??
          jsonResponse(201, { ...card, cancelledAt: '2026-08-22T00:00:00.000Z' }),
      );
    }
    if (url.includes('/cards')) {
      opts.calls.push('list');
      return Promise.resolve(jsonResponse(200, paginated([card])));
    }
    if (url.includes('/trainees')) return Promise.resolve(jsonResponse(200, paginated([TRAINEE])));
    if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paginated([])));
    return Promise.resolve(jsonResponse(404, null));
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <CardsPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/Ada Lovelace/);
  await user.click(screen.getByRole('button', { name: /Анулиране|Cancel card/ }));
  const box = document.getElementById('cancel-amount') as HTMLInputElement | null;
  if (!box) throw new Error('cancel amount input not found');
  return box;
}

function confirmButton() {
  // The dialog's destructive action carries the same label as the row button — take the last.
  const buttons = screen.getAllByRole('button', { name: /Анулиране|Cancel card/ });
  const last = buttons[buttons.length - 1];
  if (!last) throw new Error('expected the confirm button');
  return last;
}

describe('CardsPage — cancel with prorated refund (TKT-0115)', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pre-fills price / totalVisits × visitsRemaining: 120 / 12 × 5 = 50.00', async () => {
    const user = userEvent.setup();
    stubFetch({ calls: [] });
    renderPage();
    const box = await openDialog(user);
    expect(box.value).toBe('50.00');
  });

  it('rounds the suggestion to 2 decimals: 100 / 3 × 1 = 33.33', async () => {
    const user = userEvent.setup();
    stubFetch({ card: { totalVisits: 3, price: '100', visitsUsed: 2, visitsRemaining: 1 }, calls: [] });
    renderPage();
    const box = await openDialog(user);
    expect(box.value).toBe('33.33');
  });

  it('records the (edited) refund through the refunds endpoint first, then cancels', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let refundBody: unknown = null;
    stubFetch({
      calls,
      onRefund: (body) => {
        refundBody = body;
        return jsonResponse(201, { id: 'r1' });
      },
    });
    renderPage();
    const box = await openDialog(user);
    await user.clear(box);
    await user.type(box, '30');
    await user.click(confirmButton());

    expect(await screen.findByText(/Картата е анулирана|Card cancelled/)).toBeInTheDocument();
    const today = new Date().toISOString().slice(0, 10);
    expect(refundBody).toEqual({ amount: 30, refundedAt: today });
    expect(calls.indexOf('refund')).toBeLessThan(calls.indexOf('cancel'));
    // The list refetches after the cancel lands.
    expect(calls.filter((c) => c === 'list').length).toBeGreaterThanOrEqual(2);
  });

  it('amount 0 skips the refund call and only cancels', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    stubFetch({ calls });
    renderPage();
    const box = await openDialog(user);
    await user.clear(box);
    await user.type(box, '0');
    await user.click(confirmButton());

    await screen.findByText(/Картата е анулирана|Card cancelled/);
    expect(calls).not.toContain('refund');
    expect(calls).toContain('cancel');
  });

  it('shows the translated over-refund reason and does not cancel the card', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    stubFetch({
      calls,
      onRefund: () =>
        jsonResponse(400, {
          statusCode: 400,
          message: 'Refund of 50 exceeds the net paid 0 on this fee',
          error: 'BadRequest',
          code: 'REFUND_EXCEEDS_NET_PAID',
          params: { amount: 50, netPaid: '0' },
        }),
    });
    renderPage();
    await openDialog(user);
    await user.click(confirmButton());

    expect(await screen.findByText(/надвишава нетно платените 0/)).toBeInTheDocument();
    expect(calls).not.toContain('cancel');
  });
});
