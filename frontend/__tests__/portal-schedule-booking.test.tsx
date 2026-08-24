import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalSchedulePage from '@/app/(portal)/portal/schedule/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/schedule',
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

const HOUR = 3_600_000;
const soon = new Date(Date.now() + 6 * HOUR).toISOString();

const ATTENDANCE_ROW = {
  id: 'a1',
  tenantId: 't',
  sessionId: 's1',
  traineeId: 'tr1',
  status: 'PENDING',
  traineeRsvp: 'CONFIRMED',
  notes: null,
  markedAt: null,
  markedById: null,
  markedByEmailSnapshot: null,
  markedByNameSnapshot: null,
  createdAt: '',
  updatedAt: '',
  trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
};

// TKT-0118: an eligible entry — self-bookable class, spots left, Ada not yet booked.
function mkEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't',
    classId: 'c',
    locationId: 'l',
    startsAt: soon,
    endsAt: new Date(Date.parse(soon) + HOUR).toISOString(),
    status: 'SCHEDULED',
    notes: null,
    createdAt: '',
    updatedAt: '',
    class: { id: 'c', name: 'Yoga 101', allowSelfBooking: true, bookingCutoffMin: null },
    location: { id: 'l', name: 'Studio A' },
    attendances: [],
    spotsLeft: 3,
    myTrainees: [{ id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' }],
    ...overrides,
  };
}

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

describe('Portal self-booking (TKT-0118)', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'cust@x', role: 'CUSTOMER', tenantId: 't', exp }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(opts: {
    entries: () => unknown[];
    cards?: unknown[];
    onBook?: (url: string, body: Record<string, unknown>) => Response;
    onCancel?: (url: string) => Response;
  }) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/bookings') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return opts.onBook ? opts.onBook(url, body) : jsonResponse(201, ATTENDANCE_ROW);
      }
      if (url.includes('/bookings') && init?.method === 'DELETE') {
        return opts.onCancel ? opts.onCancel(url) : jsonResponse(204, null);
      }
      if (url.includes('/me/cards')) return jsonResponse(200, opts.cards ?? []);
      if (url.includes('/me/sessions')) return jsonResponse(200, opts.entries());
      return jsonResponse(404, null);
    });
  }

  it('books an eligible trainee and the refetched row shows RSVP controls', async () => {
    const user = userEvent.setup();
    let booked = false;
    let bookUrl = '';
    let bookBody: Record<string, unknown> | null = null;
    mockFetch({
      entries: () => [mkEntry(booked ? { attendances: [ATTENDANCE_ROW], spotsLeft: 2 } : {})],
      onBook: (url, body) => {
        booked = true;
        bookUrl = url;
        bookBody = body;
        return jsonResponse(201, ATTENDANCE_ROW);
      },
    });
    renderPage();

    const bookButton = await screen.findByRole('button', { name: 'Записване' });
    await user.click(bookButton);

    await waitFor(() => expect(bookBody).not.toBeNull());
    expect(bookUrl).toContain('/me/sessions/s1/bookings');
    expect(bookBody!.traineeId).toBe('tr1');
    // The refetch replaced the Book button with the trainee's normal RSVP controls.
    await screen.findByRole('button', { name: /Потвърждавам/ });
    expect(screen.queryByRole('button', { name: 'Записване' })).toBeNull();
  });

  it('renders no Book button when the flag is off, the session is full, or the cutoff has passed', async () => {
    const closed = [
      mkEntry({ id: 's1', class: { id: 'c', name: 'Off', allowSelfBooking: false, bookingCutoffMin: null } }),
      mkEntry({ id: 's2', spotsLeft: 0 }),
      mkEntry({
        id: 's3',
        startsAt: new Date(Date.now() + HOUR / 2).toISOString(),
        class: { id: 'c', name: 'Late', allowSelfBooking: true, bookingCutoffMin: 60 },
      }),
    ];
    mockFetch({ entries: () => closed });
    renderPage();

    await screen.findByText(/Off/);
    expect(screen.queryByRole('button', { name: 'Записване' })).toBeNull();
  });

  it('warns an ex-card-holder without visits, but not a card-less trainee', async () => {
    const entries = [
      mkEntry(),
      mkEntry({
        id: 's2',
        myTrainees: [{ id: 'tr2', firstName: 'Grace', lastName: 'Hopper' }],
      }),
    ];
    mockFetch({
      entries: () => entries,
      // Ada owns one exhausted card; Grace owns none.
      cards: [
        {
          id: 'card1',
          traineeId: 'tr1',
          totalVisits: 5,
          visitsUsed: 5,
          visitsRemaining: 0,
          expiresAt: null,
          cancelledAt: null,
          class: null,
          trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
        },
      ],
    });
    renderPage();

    await screen.findAllByRole('button', { name: 'Записване' });
    const notes = screen.getAllByText(/Няма оставащи посещения/);
    expect(notes).toHaveLength(1);
  });

  // TKT-0119: the other half of self-service — cancelling a booking before the cutoff.
  it('cancels a booked row and the refetch drops it', async () => {
    const user = userEvent.setup();
    let cancelled = false;
    let cancelUrl = '';
    mockFetch({
      entries: () => [
        mkEntry(
          cancelled
            ? { attendances: [], spotsLeft: 3 }
            : { attendances: [ATTENDANCE_ROW], spotsLeft: 2 },
        ),
      ],
      onCancel: (url) => {
        cancelled = true;
        cancelUrl = url;
        return jsonResponse(204, null);
      },
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Отказ на записването' }));

    await waitFor(() => expect(cancelUrl).toContain('/me/sessions/s1/bookings/tr1'));
    // The row is gone; the trainee is bookable again.
    await screen.findByRole('button', { name: 'Записване' });
    expect(screen.queryByRole('button', { name: 'Отказ на записването' })).toBeNull();
  });

  it('past the cutoff shows the contact-the-club hint instead of Cancel', async () => {
    mockFetch({
      entries: () => [
        mkEntry({
          attendances: [ATTENDANCE_ROW],
          spotsLeft: 2,
          startsAt: new Date(Date.now() + HOUR / 2).toISOString(),
          class: { id: 'c', name: 'Late', allowSelfBooking: true, bookingCutoffMin: 60 },
        }),
      ],
    });
    renderPage();

    await screen.findByText(/Late/);
    expect(screen.queryByRole('button', { name: 'Отказ на записването' })).toBeNull();
    expect(screen.getByText(/свържете се с клуба/i)).toBeInTheDocument();
  });

  it('shows neither Cancel nor the hint on a class that is not self-bookable', async () => {
    mockFetch({
      entries: () => [
        mkEntry({
          attendances: [ATTENDANCE_ROW],
          class: { id: 'c', name: 'Staff only', allowSelfBooking: false, bookingCutoffMin: null },
        }),
      ],
    });
    renderPage();

    await screen.findByText(/Staff only/);
    expect(screen.queryByRole('button', { name: 'Отказ на записването' })).toBeNull();
    expect(screen.queryByText(/свържете се с клуба/i)).toBeNull();
    // The RSVP controls are untouched for staff-managed classes.
    expect(screen.getByRole('button', { name: /Потвърждавам/ })).toBeInTheDocument();
  });
});
