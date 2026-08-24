import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalSchedulePage from '@/app/(portal)/portal/schedule/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/schedule',
  // TKT-0102 (mechanical): the page now reads ?view/?mode/?date; bare URL = the list these
  // tests exercise. No assertion changes.
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

const FIRST_ATTENDANCE = {
  id: 'a1',
  tenantId: 't',
  sessionId: 's1',
  traineeId: 'tr1',
  status: 'PENDING',
  traineeRsvp: null,
  notes: null,
  markedAt: null,
  markedById: null,
  markedByEmailSnapshot: null,
  markedByNameSnapshot: null,
  createdAt: '',
  updatedAt: '',
  trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
};

const ENTRIES = [
  {
    id: 's1',
    tenantId: 't',
    classId: 'c',
    locationId: 'l',
    startsAt: '2026-06-01T18:00:00.000Z',
    endsAt: '2026-06-01T19:00:00.000Z',
    status: 'SCHEDULED',
    notes: null,
    createdAt: '',
    updatedAt: '',
    class: { id: 'c', name: 'Yoga 101' },
    location: { id: 'l', name: 'Studio A' },
    attendances: [FIRST_ATTENDANCE],
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <PortalSchedulePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('PortalSchedulePage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'cust@x', role: 'CUSTOMER', tenantId: 't', exp }));
    replace.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return Promise.resolve(handler(url, init));
    });
  }

  it('renders one card per session with the trainee name and RSVP buttons', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/sessions')) return jsonResponse(200, ENTRIES);
      return jsonResponse(404, null);
    });
    renderPage();
    expect(await screen.findByText(/Yoga 101/)).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmed|Потвърждавам/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Decline|Отказвам/ })).toBeInTheDocument();
  });

  it('clicking an RSVP button sends a PATCH and reflects the choice as aria-pressed', async () => {
    const user = userEvent.setup();
    let patchBody: unknown = null;
    mockFetch((url, init) => {
      if (url.endsWith('/me/sessions')) return jsonResponse(200, ENTRIES);
      if (url.endsWith('/sessions/s1/rsvp') && init?.method === 'PATCH') {
        patchBody = JSON.parse(init.body as string);
        return jsonResponse(200, { ...FIRST_ATTENDANCE, traineeRsvp: 'CONFIRMED' });
      }
      return jsonResponse(404, null);
    });
    renderPage();
    const confirmBtn = await screen.findByRole('button', { name: /Confirmed|Потвърждавам/ });
    await user.click(confirmBtn);

    await screen.findByText(/RSVP saved|Потвърждението е запазено/);
    expect(patchBody).toEqual({ traineeId: 'tr1', traineeRsvp: 'CONFIRMED' });

    // After the click, the chosen button reflects aria-pressed=true.
    const updatedConfirm = await screen.findByRole('button', { name: /Confirmed|Потвърждавам/ });
    expect(updatedConfirm).toHaveAttribute('aria-pressed', 'true');
    const declineBtn = screen.getByRole('button', { name: /Decline|Отказвам/ });
    expect(declineBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the empty message when there are no upcoming sessions', async () => {
    mockFetch((url) => {
      if (url.endsWith('/me/sessions')) return jsonResponse(200, []);
      return jsonResponse(404, null);
    });
    renderPage();
    expect(
      await screen.findByText(/No upcoming sessions yet|Все още няма предстоящи/),
    ).toBeInTheDocument();
  });

  it('shows two trainees in the same session as separate RSVP groups (parent with two children)', async () => {
    const twoKids = [
      {
        ...ENTRIES[0],
        attendances: [
          FIRST_ATTENDANCE,
          {
            ...FIRST_ATTENDANCE,
            id: 'a2',
            traineeId: 'tr2',
            trainee: { id: 'tr2', firstName: 'Bob', lastName: 'Builder' },
          },
        ],
      },
    ];
    mockFetch((url) => {
      if (url.endsWith('/me/sessions')) return jsonResponse(200, twoKids);
      return jsonResponse(404, null);
    });
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
    const adaGroup = screen.getByRole('group', { name: /RSVP for Ada Lovelace|Потвърждение за Ada Lovelace/ });
    const bobGroup = screen.getByRole('group', { name: /RSVP for Bob Builder|Потвърждение за Bob Builder/ });
    expect(within(adaGroup).getAllByRole('button')).toHaveLength(3);
    expect(within(bobGroup).getAllByRole('button')).toHaveLength(3);
  });
});
