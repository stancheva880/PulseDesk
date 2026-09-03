import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalFeesPage from '@/app/(portal)/portal/fees/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/fees',
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

const FEE_BASE = {
  id: 'f1',
  tenantId: 't',
  classId: 'c1',
  traineeId: 'tr1',
  sessionId: null,
  amount: '100.00',
  status: 'PARTIAL',
  periodStart: '2026-03-01T00:00:00.000Z',
  periodEnd: '2026-03-31T23:59:59.999Z',
  notes: null,
  createdAt: '',
  updatedAt: '',
  class: { id: 'c1', name: 'Yoga 101' },
  trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
  payments: [
    {
      id: 'p1',
      tenantId: 't',
      feeId: 'f1',
      amount: '40.00',
      paidAt: '2026-03-15T00:00:00.000Z',
      method: 'cash',
      notes: null,
      recordedById: null,
      recordedByEmailSnapshot: null,
      recordedByNameSnapshot: null,
      createdAt: '',
    },
  ],
};

const FEE_KID = {
  ...FEE_BASE,
  id: 'f2',
  traineeId: 'tr2',
  amount: '50.00',
  status: 'UNPAID',
  payments: [],
  trainee: { id: 'tr2', firstName: 'Bob', lastName: 'Builder' },
};

const ONE_LOCATION = [
  {
    id: 'loc-1',
    name: 'Studio',
    bankIban: 'BG80BNBG96611020345678',
    bankAccountHolder: 'Studio EOOD',
    revolutHandle: null,
    myposLink: null,
    cashNote: null,
  },
];

const TWO_LOCATIONS = [
  ...ONE_LOCATION,
  {
    id: 'loc-2',
    name: 'Annex',
    bankIban: null,
    bankAccountHolder: null,
    revolutHandle: '@annex',
    myposLink: 'https://www.mypos.com/pay/annex',
    cashNote: 'Pay at reception',
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <PortalFeesPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('PortalFeesPage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'cust@x', role: 'CUSTOMER', tenantId: 't', exp }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(handler: (url: string) => Response | Promise<Response>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return Promise.resolve(handler(url));
    });
  }

  it('renders fees grouped by trainee with paid + outstanding computed client-side', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/fees')) return jsonResponse(200, [FEE_BASE, FEE_KID]);
      return jsonResponse(404, null);
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bob Builder' })).toBeInTheDocument();

    // Ada: amount 100, paid 40, outstanding 60. The 40.00 figure appears both in the
    // "paid" summary cell and in the (collapsed) ledger row — assert "at least one".
    const adaSection = screen
      .getByRole('heading', { name: 'Ada Lovelace' })
      .closest('section')! as HTMLElement;
    expect(within(adaSection).getByText(/100\.00 EUR/)).toBeInTheDocument();
    expect(within(adaSection).getAllByText(/40\.00 EUR/).length).toBeGreaterThanOrEqual(1);
    expect(within(adaSection).getByText(/60\.00 EUR/)).toBeInTheDocument();

    // Bob: amount 50, paid 0, outstanding 50. Both Amount and Outstanding cells render 50.00.
    const bobSection = screen
      .getByRole('heading', { name: 'Bob Builder' })
      .closest('section')! as HTMLElement;
    expect(within(bobSection).getAllByText(/50\.00 EUR/).length).toBeGreaterThanOrEqual(2);
    expect(
      within(bobSection).getByText(/No payments recorded yet|Все още няма записани плащания/),
    ).toBeInTheDocument();
  });

  it('expanding the payment ledger reveals individual payments', async () => {
    const user = userEvent.setup();
    mockFetch((url) => {
      if (url.endsWith('/me/fees')) return jsonResponse(200, [FEE_BASE]);
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    const summary = screen.getByText(/ledger|Регистър/i);
    await user.click(summary);
    // Method "cash" appears inside the expanded list.
    expect(await screen.findByText(/cash/)).toBeInTheDocument();
  });

  it('renders the empty message when there are no fees', async () => {
    mockFetch(() => jsonResponse(200, []));
    renderPage();
    expect(await screen.findByText(/No fees yet|Все още няма такси/)).toBeInTheDocument();
  });
});

// TKT-0130: bank/Revolut/mypos/cash details used to live on their own portal page
// (/portal/payment-details); they are now the "Pay fees" tab next to "My fees" here.
describe('PortalFeesPage — pay fees tab', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'cust@x', role: 'CUSTOMER', tenantId: 't', exp }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(handler: (url: string) => Response | Promise<Response>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return Promise.resolve(handler(url));
    });
  }

  async function switchToPayFeesTab() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Pay fees|Плащане на такси/ }));
    return user;
  }

  it('single location: no location tabs, shows the IBAN method by default', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) return jsonResponse(200, ONE_LOCATION);
      return jsonResponse(404, null);
    });

    await switchToPayFeesTab();

    expect(await screen.findByText('BG80BNBG96611020345678')).toBeInTheDocument();
    expect(screen.getByText('Studio EOOD')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Studio' })).not.toBeInTheDocument();
  });

  it('multiple locations: switching the location tab switches the available methods', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) return jsonResponse(200, TWO_LOCATIONS);
      return jsonResponse(404, null);
    });

    const user = await switchToPayFeesTab();

    expect(await screen.findByText('BG80BNBG96611020345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annex' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Annex' }));

    expect(await screen.findByText('@annex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revolut/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mypos\.com/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cash on-site|В брой на място/ })).toBeInTheDocument();
    expect(screen.queryByText('BG80BNBG96611020345678')).not.toBeInTheDocument();
  });

  it('renders the mypos.com method as a clickable link', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) return jsonResponse(200, TWO_LOCATIONS);
      return jsonResponse(404, null);
    });

    const user = await switchToPayFeesTab();
    await user.click(await screen.findByRole('button', { name: 'Annex' }));
    await user.click(screen.getByRole('button', { name: /mypos\.com/ }));

    const link = await screen.findByRole('link', { name: 'https://www.mypos.com/pay/annex' });
    expect(link).toHaveAttribute('href', 'https://www.mypos.com/pay/annex');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the empty message when no trainee is linked', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) return jsonResponse(200, []);
      return jsonResponse(404, null);
    });

    await switchToPayFeesTab();

    expect(
      await screen.findByText(/No trainees are linked|нямате трениращи, свързани/),
    ).toBeInTheDocument();
  });

  it('shows the no-methods note when a location has nothing set', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) {
        return jsonResponse(200, [
          { id: 'loc-3', name: 'Bare', bankIban: null, bankAccountHolder: null, revolutHandle: null, myposLink: null, cashNote: null },
        ]);
      }
      return jsonResponse(404, null);
    });

    await switchToPayFeesTab();

    expect(
      await screen.findByText(/No payment details are set|Все още няма зададени данни/),
    ).toBeInTheDocument();
  });
});
