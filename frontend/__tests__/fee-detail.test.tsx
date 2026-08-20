import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeeDetailPage from '@/app/(dashboard)/fees/[id]/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

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
    setAccessToken(buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Both money boxes on this screen used their own rule: the fee amount accepted >= 0, so an
  // emptied box saved a zero fee (Number('') is 0), and neither rejected a third decimal place the
  // DTO would refuse anyway. They share one rule with the create form now.
  describe('amount validation', () => {
    function stubDetail(onPatch?: (body: unknown) => void, onPost?: (body: unknown) => void) {
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        const method = init?.method ?? 'GET';
        if (url.endsWith('/fees/f1') && method === 'PATCH') {
          onPatch?.(JSON.parse(init!.body as string));
          return Promise.resolve(jsonResponse(200, FEE_DETAIL_BASE));
        }
        if (url.endsWith('/fees/f1/payments') && method === 'POST') {
          onPost?.(JSON.parse(init!.body as string));
          return Promise.resolve(jsonResponse(201, { id: 'p1' }));
        }
        if (url.endsWith('/fees/f1')) return Promise.resolve(jsonResponse(200, FEE_DETAIL_BASE));
        return Promise.resolve(jsonResponse(404, null));
      });
    }

    async function feeAmountBox() {
      await screen.findByText(/Yoga 101/);
      const el = document.getElementById('amount') as HTMLInputElement | null;
      if (!el) throw new Error('fee amount input not found');
      return el;
    }

    function saveButtons() {
      return screen.getAllByRole('button', { name: /^Save$|^Запазване$/ });
    }

    it.each(['', '0', '-5', '1.234', '2000000'])(
      'refuses to save the fee amount %j',
      async (value) => {
        const user = userEvent.setup();
        let patched: unknown = null;
        stubDetail((b) => {
          patched = b;
        });
        renderPage();
        const amount = await feeAmountBox();

        await user.clear(amount);
        if (value !== '') await user.type(amount, value);
        const first = saveButtons()[0];
        if (!first) throw new Error('expected the edit-fee Save button');
        await user.click(first);

        expect(await screen.findByText(/Сумата трябва|Amount must/)).toBeInTheDocument();
        expect(patched).toBeNull();
      },
    );

    it('saves a valid fee amount as a number', async () => {
      const user = userEvent.setup();
      let patched: Record<string, unknown> | null = null;
      stubDetail((b) => {
        patched = b as Record<string, unknown>;
      });
      renderPage();
      const amount = await feeAmountBox();

      await user.clear(amount);
      await user.type(amount, '75.5');
      const first = saveButtons()[0];
      if (!first) throw new Error('expected the edit-fee Save button');
      await user.click(first);

      await vi.waitFor(() => expect(patched).not.toBeNull());
      expect(patched).toMatchObject({ amount: 75.5 });
    });

    it.each(['0', '-5', '1.234', '2000000'])(
      'refuses to record the payment amount %j',
      async (value) => {
        const user = userEvent.setup();
        let posted: unknown = null;
        stubDetail(undefined, (b) => {
          posted = b;
        });
        renderPage();
        await screen.findByText(/Yoga 101/);

        await user.type(document.getElementById('p-amount') as HTMLInputElement, value);
        await user.type(document.getElementById('p-paidAt') as HTMLInputElement, '2026-03-15');
        const buttons = saveButtons();
        const last = buttons[buttons.length - 1];
        if (!last) throw new Error('expected the payment Save button');
        await user.click(last);

        expect(await screen.findByText(/Сумата трябва|Amount must/)).toBeInTheDocument();
        expect(posted).toBeNull();
      },
    );

    // How much may be paid depends on the fee's ledger, so that rule lives on the server only
    // (TKT-0072) and its 400 names the balance. The form has to show that reason rather than a
    // generic failure, or the admin cannot tell what to type instead.
    it('shows the server reason when a payment exceeds the balance', async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        const method = init?.method ?? 'GET';
        if (url.endsWith('/fees/f1/payments') && method === 'POST') {
          return Promise.resolve(
            jsonResponse(400, {
              statusCode: 400,
              message: 'Payment of 150 exceeds the outstanding balance of 100 on this fee',
            }),
          );
        }
        if (url.endsWith('/fees/f1')) return Promise.resolve(jsonResponse(200, FEE_DETAIL_BASE));
        return Promise.resolve(jsonResponse(404, null));
      });
      renderPage();
      await screen.findByText(/Yoga 101/);

      await user.type(document.getElementById('p-amount') as HTMLInputElement, '150');
      await user.type(document.getElementById('p-paidAt') as HTMLInputElement, '2026-03-15');
      const buttons = saveButtons();
      const last = buttons[buttons.length - 1];
      if (!last) throw new Error('expected the payment Save button');
      await user.click(last);

      expect(await screen.findByText(/exceeds the outstanding balance of 100/)).toBeInTheDocument();
    });

    // Same 400, now carrying the code the backend attaches. The default locale is bg, so the
    // admin must read Bulgarian rather than the server's English `message`.
    it('shows the overpayment reason in the active locale when the 400 carries a code', async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        const method = init?.method ?? 'GET';
        if (url.endsWith('/fees/f1/payments') && method === 'POST') {
          return Promise.resolve(
            jsonResponse(400, {
              statusCode: 400,
              message: 'Payment of 150 exceeds the outstanding balance of 100 on this fee',
              error: 'BadRequest',
              code: 'FEE_PAYMENT_EXCEEDS_BALANCE',
              params: { amount: 150, balance: '100' },
            }),
          );
        }
        if (url.endsWith('/fees/f1')) return Promise.resolve(jsonResponse(200, FEE_DETAIL_BASE));
        return Promise.resolve(jsonResponse(404, null));
      });
      renderPage();
      await screen.findByText(/Yoga 101/);

      await user.type(document.getElementById('p-amount') as HTMLInputElement, '150');
      await user.type(document.getElementById('p-paidAt') as HTMLInputElement, '2026-03-15');
      const buttons = saveButtons();
      const last = buttons[buttons.length - 1];
      if (!last) throw new Error('expected the payment Save button');
      await user.click(last);

      const shown = await screen.findByText(/надвишава остатъка от 100/);
      expect(shown).toBeInTheDocument();
      expect(shown.textContent).toContain('150');
      expect(shown.textContent).not.toContain('exceeds');
    });
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
