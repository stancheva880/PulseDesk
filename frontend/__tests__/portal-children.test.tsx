import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PortalChildrenPage from '@/app/(portal)/portal/children/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/children',
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

// A calendar day well in the past, so age math is stable regardless of when this runs.
const CHILD = {
  id: 'tr1',
  firstName: 'Kid',
  lastName: 'X',
  dateOfBirth: '2015-06-15T00:00:00.000Z',
  classes: [{ id: 'c1', name: 'Ballet', description: null }],
};
const UNENROLLED = {
  id: 'tr2',
  firstName: 'Other',
  lastName: 'Kid',
  dateOfBirth: '2017-01-01T00:00:00.000Z',
  classes: [],
};

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <PortalChildrenPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('PortalChildrenPage', () => {
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

  // The question this tab answers: is the family link actually there? Both children show up
  // by name — one with its class, one confirmed-linked but not enrolled anywhere yet.
  it('lists every linked trainee by name, with classes or a not-enrolled note', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/trainees')) return jsonResponse(200, [CHILD, UNENROLLED]);
      return jsonResponse(404, null);
    });

    renderPage();

    expect(await screen.findByText('Kid X')).toBeInTheDocument();
    expect(screen.getByText('Ballet')).toBeInTheDocument();
    expect(screen.getByText('Other Kid')).toBeInTheDocument();
    expect(
      screen.getByText(/Not enrolled in a class yet|Все още не е записан/),
    ).toBeInTheDocument();
  });

  it('shows the empty message when no trainee is linked', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/trainees')) return jsonResponse(200, []);
      return jsonResponse(404, null);
    });

    renderPage();

    expect(
      await screen.findByText(/No trainees are linked|нямате трениращи, свързани/),
    ).toBeInTheDocument();
  });
});
