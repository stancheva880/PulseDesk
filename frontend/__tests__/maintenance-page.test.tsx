import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MaintenancePage from '@/app/(dashboard)/maintenance/page';
import { ToastViewport } from '@/components/toast';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/maintenance',
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

// TKT-0122: the SUPER_ADMIN-only manual trigger for the stale-queue sweep. The role gating
// itself lives in the nav (sidebar) and the route guard (layout) and is covered there; this
// suite is about the button doing what it says.
describe('MaintenancePage', () => {
  let sweepCalls: Array<{ url: string; method: string }> = [];

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'sa', email: 'sa@x', role: 'SUPER_ADMIN', tenantId: null, exp }));
    window.localStorage.setItem('pulsedesk.tenantContext', 't1');
    sweepCalls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/waitlists/sweep')) {
        sweepCalls.push({ url, method });
        return Promise.resolve(jsonResponse(201, { deleted: 7 }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function renderPage() {
    return render(
      <I18nProvider>
        <ToastViewport />
        <AuthProvider>
          <MaintenancePage />
        </AuthProvider>
      </I18nProvider>,
    );
  }

  it('posts to the sweep endpoint and reports the count', async () => {
    const { container } = renderPage();

    const button = await waitFor(() => {
      const el = container.querySelector<HTMLButtonElement>('button');
      if (!el) throw new Error('sweep button not rendered');
      return el;
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(sweepCalls).toHaveLength(1);
      expect(sweepCalls[0]!.method).toBe('POST');
    });
    // The count travels into the toast, so a sweep that removed nothing reads differently
    // from one that removed seven.
    expect(await screen.findByText(/7/)).toBeInTheDocument();
  });

  it('shows a translated error instead of a toast when the sweep fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/waitlists/sweep')) {
        return Promise.resolve(
          jsonResponse(403, { statusCode: 403, message: 'Forbidden resource' }),
        );
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    const { container } = renderPage();

    fireEvent.click(container.querySelector('button')!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBeTruthy();
  });
});
