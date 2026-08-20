import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditClassPage from '@/app/(dashboard)/classes/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

// TKT-0079 criterion 3. An ADMIN scoped to Location A edits a class whose roster includes a trainee
// who only belongs to Location B. That trainee is in ClassDetail.trainees but can never appear in
// the location-scoped candidate list — and PATCH feeds the form's array into a full-replace
// `setMany`. Saving without touching the roster must leave the roster identical.

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/classes/class-1/edit',
  useParams: () => ({ id: 'class-1' }),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const paged = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  totalPages: 1,
});

// In the roster, in Location B — the scoped list below never returns them.
const HIDDEN = { id: 'tr-hidden', firstName: 'Скрита', lastName: 'Трениращa' };
const VISIBLE = { id: 'tr-1', firstName: 'Ada', lastName: 'Lovelace' };

const CLASS_DETAIL = {
  id: 'class-1',
  tenantId: 't',
  name: 'Beginners',
  description: null,
  billingMode: 'PER_MONTH',
  monthlyAmount: '50.00',
  sessionPrice: null,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  locations: [],
  trainers: [],
  trainees: [VISIBLE, HIDDEN],
};

describe('EditClassPage — a roster member outside the actor location scope', () => {
  let patchBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    patchBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/classes/class-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
      }
      if (url.includes('/classes/class-1')) return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
      // The scoped candidate list: it returns the visible trainee and never the hidden one.
      if (url.includes('/trainees')) return Promise.resolve(jsonResponse(200, paged([VISIBLE])));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged([])));
      if (url.includes('/users')) return Promise.resolve(jsonResponse(200, paged([])));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    replace.mockClear();
  });

  it('keeps the roster byte-identical when the form is saved untouched', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <EditClassPage />
        </AuthProvider>
      </I18nProvider>,
    );

    await waitFor(() => {
      if (!container.querySelector('button[type="submit"]')) throw new Error('form not rendered');
    });
    // Wait for the detail to hydrate the form, so the save is not racing the fetch.
    await waitFor(() => {
      expect(screen.getByDisplayValue('Beginners')).toBeInTheDocument();
    });

    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect((patchBody!.traineeIds as string[]).slice().sort()).toEqual(
      ['tr-1', 'tr-hidden'].sort(),
    );
  });

  it('shows the out-of-scope member rather than silently hiding them', async () => {
    render(
      <I18nProvider>
        <AuthProvider>
          <EditClassPage />
        </AuthProvider>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Beginners')).toBeInTheDocument();
    });
    expect(await screen.findByText(/Скрита Трениращa/)).toBeInTheDocument();
  });
});
