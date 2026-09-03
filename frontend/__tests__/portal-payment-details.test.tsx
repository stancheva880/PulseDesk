import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PortalPaymentDetailsPage from '@/app/(portal)/portal/payment-details/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/payment-details',
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

const ONE_LOCATION = [
  {
    id: 'loc-1',
    name: 'Studio',
    bankIban: 'BG80BNBG96611020345678',
    bankAccountHolder: 'Studio EOOD',
    revolutHandle: null,
    paypalEmail: null,
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
    paypalEmail: 'annex@x.com',
    cashNote: 'Pay at reception',
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <PortalPaymentDetailsPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('PortalPaymentDetailsPage', () => {
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

  it('single location: no location tabs, shows the IBAN method by default', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) return jsonResponse(200, ONE_LOCATION);
      return jsonResponse(404, null);
    });

    renderPage();

    expect(await screen.findByText('BG80BNBG96611020345678')).toBeInTheDocument();
    expect(screen.getByText('Studio EOOD')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Studio' })).not.toBeInTheDocument();
  });

  it('multiple locations: switching the location tab switches the available methods', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) return jsonResponse(200, TWO_LOCATIONS);
      return jsonResponse(404, null);
    });

    renderPage();

    expect(await screen.findByText('BG80BNBG96611020345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annex' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Annex' }));

    expect(await screen.findByText('@annex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revolut/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PayPal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cash on-site|В брой на място/ })).toBeInTheDocument();
    expect(screen.queryByText('BG80BNBG96611020345678')).not.toBeInTheDocument();
  });

  it('shows the empty message when no trainee is linked', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) return jsonResponse(200, []);
      return jsonResponse(404, null);
    });

    renderPage();

    expect(
      await screen.findByText(/No trainees are linked|нямате трениращи, свързани/),
    ).toBeInTheDocument();
  });

  it('shows the no-methods note when a location has nothing set', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/locations')) {
        return jsonResponse(200, [
          { id: 'loc-3', name: 'Bare', bankIban: null, bankAccountHolder: null, revolutHandle: null, paypalEmail: null, cashNote: null },
        ]);
      }
      return jsonResponse(404, null);
    });

    renderPage();

    expect(
      await screen.findByText(/No payment details are set|Все още няма зададени данни/),
    ).toBeInTheDocument();
  });
});
