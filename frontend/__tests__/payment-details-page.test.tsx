import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentDetailsPage from '@/app/(dashboard)/payment-details/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/payment-details',
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

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <PaymentDetailsPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    return Promise.resolve(handler(url, init));
  });
}

// TKT-0131: moved off /profile — a club-wide setting belongs in the menu, not an admin's
// personal settings page. Role gating (ADMIN/SUPER_ADMIN only, EMPLOYEE bounced) lives in the
// nav (sidebar.tsx) and the route guard (layout.tsx DENY_RULES), covered in
// dashboard-layout.test.tsx; this suite is about the form itself.
describe('PaymentDetailsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function signIn(role: 'ADMIN' | 'SUPER_ADMIN'): void {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u1', email: 'a@x.com', role, tenantId: 't', exp }));
  }

  const DETAILS = {
    bankIban: 'BG80BNBG96611020345678',
    bankAccountHolder: 'Club EOOD',
    revolutHandle: null,
    myposLink: null,
    cashNote: null,
  };

  it('loads and lets an ADMIN save the active club default', async () => {
    const user = userEvent.setup();
    signIn('ADMIN');
    let patchBody: unknown = null;
    mockFetch((url, init) => {
      if (url.endsWith('/tenants/payment-details') && init?.method === 'PATCH') {
        patchBody = JSON.parse(init.body as string);
        return jsonResponse(200, { ...DETAILS, revolutHandle: '@club' });
      }
      if (url.endsWith('/tenants/payment-details')) return jsonResponse(200, DETAILS);
      return jsonResponse(404, null);
    });
    renderPage();

    const iban = await screen.findByLabelText('IBAN');
    expect(iban).toHaveValue('BG80BNBG96611020345678');

    await user.type(screen.getByLabelText(/Revolut/), '@club');
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));

    await vi.waitFor(() => expect(patchBody).not.toBeNull());
    expect((patchBody as { revolutHandle: string }).revolutHandle).toBe('@club');
  });

  it('loads for SUPER_ADMIN too', async () => {
    signIn('SUPER_ADMIN');
    mockFetch((url) => {
      if (url.endsWith('/tenants/payment-details')) return jsonResponse(200, DETAILS);
      return jsonResponse(404, null);
    });
    renderPage();

    expect(await screen.findByLabelText('IBAN')).toHaveValue('BG80BNBG96611020345678');
  });
});
