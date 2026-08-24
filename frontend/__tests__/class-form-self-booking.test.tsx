import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditClassPage from '@/app/(dashboard)/classes/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'class-1' }),
  usePathname: () => '/classes/class-1/edit',
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
function paged<T>(items: T[]): unknown {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

const CLASS_DETAIL = {
  id: 'class-1', tenantId: 't', name: 'Yoga', description: null,
  billingMode: 'PER_SESSION', monthlyAmount: null, sessionPrice: '10',
  capacity: null, waitlistMode: 'NONE', allowSelfBooking: false,
  bookingCutoffMin: null as number | null,
  isActive: true, createdAt: '', updatedAt: '',
  locations: [], trainers: [], trainees: [],
};

// TKT-0117: the flag pair on the class form — toggle, conditional cutoff, payload shape.
describe('ClassForm self-booking (TKT-0117)', () => {
  let patchBody: Record<string, unknown> | null = null;

  function mockApi(detail: typeof CLASS_DETAIL) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/classes/class-1')) {
        if (init?.method === 'PATCH') {
          patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse(200, { ...detail, ...patchBody });
        }
        return jsonResponse(200, detail);
      }
      return jsonResponse(200, paged([]));
    });
  }

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    patchBody = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage() {
    return render(
      <I18nProvider>
        <AuthProvider>
          <EditClassPage />
        </AuthProvider>
      </I18nProvider>,
    );
  }

  it('hides the cutoff field while the toggle is off, shows it when switched on', async () => {
    mockApi(CLASS_DETAIL);
    const { container } = renderPage();

    const toggle = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#allowSelfBooking');
      expect(el).not.toBeNull();
      expect(el!.checked).toBe(false);
      return el!;
    });
    expect(container.querySelector('#bookingCutoffMin')).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(container.querySelector('#bookingCutoffMin')).not.toBeNull(),
    );
  });

  it('shows the stored cutoff and sends the edited pair', async () => {
    mockApi({ ...CLASS_DETAIL, allowSelfBooking: true, bookingCutoffMin: 30 });
    const { container } = renderPage();

    const input = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#bookingCutoffMin');
      expect(el).not.toBeNull();
      expect(el!.value).toBe('30');
      return el!;
    });

    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запазване' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody!.allowSelfBooking).toBe(true);
    expect(patchBody!.bookingCutoffMin).toBe(60);
  });

  it('sends null when the cutoff is cleared with the flag on', async () => {
    mockApi({ ...CLASS_DETAIL, allowSelfBooking: true, bookingCutoffMin: 30 });
    const { container } = renderPage();

    const input = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#bookingCutoffMin');
      expect(el).not.toBeNull();
      return el!;
    });

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запазване' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody!.allowSelfBooking).toBe(true);
    expect(patchBody!.bookingCutoffMin).toBeNull();
  });

  it('rejects a fractional cutoff with the field error and sends nothing', async () => {
    mockApi({ ...CLASS_DETAIL, allowSelfBooking: true, bookingCutoffMin: null });
    const { container } = renderPage();

    const input = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#bookingCutoffMin');
      expect(el).not.toBeNull();
      return el!;
    });

    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запазване' }));

    await waitFor(() =>
      expect(screen.getByText('Крайният срок трябва да е цяло число, поне 0.')).toBeTruthy(),
    );
    expect(patchBody).toBeNull();
  });
});
