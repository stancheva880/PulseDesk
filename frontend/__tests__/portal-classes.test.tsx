import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PortalClassesPage from '@/app/(portal)/portal/classes/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/classes',
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

const CHILD = {
  id: 'tr1',
  firstName: 'Kid',
  lastName: 'X',
  dateOfBirth: '2015-06-15T00:00:00.000Z',
  classes: [{ id: 'c1', name: 'Ballet', description: 'Ages 4-6' }],
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
        <PortalClassesPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('PortalClassesPage', () => {
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

  // Grouped by trainee, like the fees/cards tabs — a parent with two kids sees both names,
  // even the one with nothing enrolled.
  it('groups classes by trainee, and names the trainee with none enrolled', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/trainees')) return jsonResponse(200, [CHILD, UNENROLLED]);
      return jsonResponse(404, null);
    });

    renderPage();

    expect(await screen.findByText('Kid X')).toBeInTheDocument();
    expect(screen.getByText('Ballet')).toBeInTheDocument();
    expect(screen.getByText('Ages 4-6')).toBeInTheDocument();
    expect(screen.getByText('Other Kid')).toBeInTheDocument();
    expect(screen.getByText(/Not enrolled in a class\.|Не е записан/)).toBeInTheDocument();
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
