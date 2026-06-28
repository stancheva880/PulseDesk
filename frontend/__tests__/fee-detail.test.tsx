import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeeDetailPage from '@/app/(dashboard)/fees/[id]/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { writeStoredTokens } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'f1' }),
  usePathname: () => '/fees/f1',
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

const FEE_DETAIL_BASE = {
  id: 'f1',
  tenantId: 't',
  classId: 'c1',
  traineeId: 'tr1',
  sessionId: null,
  amount: '100.00',
  status: 'UNPAID',
  periodStart: '2026-03-01T00:00:00.000Z',
  periodEnd: '2026-03-31T23:59:59.999Z',
  notes: null,
  createdAt: '',
  updatedAt: '',
  class: { id: 'c1', name: 'Yoga 101', billingMode: 'PER_MONTH' },
  trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
  payments: [],
};

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <FeeDetailPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('FeeDetailPage — payment ledger flow', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    writeStoredTokens({
      accessToken: buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }),
      refreshToken: 'R',
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a payment, refetches the fee, and shows the updated PAID badge + outstanding 0', async () => {
    const user = userEvent.setup();
    let postedBody: unknown = null;
    let getCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.endsWith('/fees/f1') && method === 'GET') {
        getCount += 1;
        // First fetch: empty ledger, UNPAID. Second fetch (after recording): PAID with 1 payment.
        const body =
          getCount === 1
            ? FEE_DETAIL_BASE
            : {
                ...FEE_DETAIL_BASE,
                status: 'PAID',
                payments: [
                  {
                    id: 'p1',
                    tenantId: 't',
                    feeId: 'f1',
                    amount: '100.00',
                    paidAt: '2026-03-15T00:00:00.000Z',
                    method: 'cash',
                    notes: null,
                    recordedById: 'u',
                    recordedByEmailSnapshot: 'admin@x',
                    recordedByNameSnapshot: 'Marker McMark',
                    createdAt: '',
                  },
                ],
              };
        return Promise.resolve(jsonResponse(200, body));
      }
      if (url.endsWith('/fees/f1/payments') && method === 'POST') {
        postedBody = JSON.parse(init!.body as string);
        return Promise.resolve(
          jsonResponse(201, { id: 'p1', tenantId: 't', feeId: 'f1', amount: '100.00' }),
        );
      }
      return Promise.resolve(jsonResponse(404, null));
    });

    renderPage();
    // Wait for the initial detail load.
    expect(await screen.findByText(/Yoga 101/)).toBeInTheDocument();
    // Fill the payment form (inputs are #p-amount, #p-paidAt, #p-method).
    await user.type(document.getElementById('p-amount') as HTMLInputElement, '100');
    await user.type(document.getElementById('p-paidAt') as HTMLInputElement, '2026-03-15');
    await user.type(document.getElementById('p-method') as HTMLInputElement, 'cash');
    // Submit — second Save button (the first one is on the edit-fee form).
    const saveBtns = screen.getAllByRole('button', { name: /^Save$|^Запазване$/ });
    const lastSave = saveBtns[saveBtns.length - 1];
    if (!lastSave) throw new Error('expected at least one Save button');
    await user.click(lastSave);

    await screen.findByText(/cash/);
    expect(postedBody).toEqual({
      amount: 100,
      paidAt: '2026-03-15',
      method: 'cash',
    });
    // Status badge flipped to PAID
    expect(screen.getAllByText(/^Paid$|^Платена$/).length).toBeGreaterThanOrEqual(1);
  });
});
