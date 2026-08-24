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

// TKT-0121: a full, queueable session — no spots, self-booking on, FIFO_AUTO, Ada not queued yet.
function mkFullEntry(overrides: Record<string, unknown> = {}) {
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
    class: {
      id: 'c',
      name: 'Yoga 101',
      allowSelfBooking: true,
      bookingCutoffMin: null,
      waitlistMode: 'FIFO_AUTO',
    },
    location: { id: 'l', name: 'Studio A' },
    attendances: [],
    spotsLeft: 0,
    myTrainees: [{ id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' }],
    myWaitlist: [],
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

describe('Portal waitlist self-service (TKT-0121)', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'cust@x', role: 'CUSTOMER', tenantId: 't', exp }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(opts: {
    entries: () => unknown[];
    onJoin?: (url: string, body: Record<string, unknown>) => Response;
    onLeave?: (url: string) => Response;
  }) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/waitlist') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return opts.onJoin ? opts.onJoin(url, body) : jsonResponse(201, {});
      }
      if (url.includes('/waitlist') && init?.method === 'DELETE') {
        return opts.onLeave ? opts.onLeave(url) : jsonResponse(204, null);
      }
      if (url.includes('/me/cards')) return jsonResponse(200, []);
      if (url.includes('/me/sessions')) return jsonResponse(200, opts.entries());
      return jsonResponse(404, null);
    });
  }

  it('offers the queue instead of Book on a full session, and the refetch shows the queued row', async () => {
    const user = userEvent.setup();
    let queued = false;
    let joinUrl = '';
    let joinBody: Record<string, unknown> | null = null;
    mockFetch({
      entries: () => [mkFullEntry(queued ? { myWaitlist: ['tr1'] } : {})],
      onJoin: (url, body) => {
        queued = true;
        joinUrl = url;
        joinBody = body;
        return jsonResponse(201, {});
      },
    });
    renderPage();

    // Full session: the Book button is not offered at all.
    const joinButton = await screen.findByRole('button', { name: 'Записване в чакащи' });
    expect(screen.queryByRole('button', { name: 'Записване' })).toBeNull();

    await user.click(joinButton);

    await waitFor(() => expect(joinBody).not.toBeNull());
    expect(joinUrl).toContain('/me/sessions/s1/waitlist');
    expect(joinBody!.traineeId).toBe('tr1');
    // The refetch turns the row into a queued one.
    await screen.findByText('В чакащи');
    expect(screen.queryByRole('button', { name: 'Записване в чакащи' })).toBeNull();
  });

  it('leaves the queue by trainee and the refetch drops the badge', async () => {
    const user = userEvent.setup();
    let left = false;
    let leaveUrl = '';
    mockFetch({
      entries: () => [mkFullEntry(left ? { myWaitlist: [] } : { myWaitlist: ['tr1'] })],
      onLeave: (url) => {
        left = true;
        leaveUrl = url;
        return jsonResponse(204, null);
      },
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Отказ от чакащи' }));

    await waitFor(() => expect(leaveUrl).not.toBe(''));
    expect(leaveUrl).toContain('/me/sessions/s1/waitlist/tr1');
    await waitFor(() => expect(screen.queryByText('В чакащи')).toBeNull());
  });

  it('a full class with no waitlist says so and offers nothing', async () => {
    mockFetch({
      entries: () => [
        mkFullEntry({
          class: {
            id: 'c',
            name: 'No queue',
            allowSelfBooking: true,
            bookingCutoffMin: null,
            waitlistMode: 'NONE',
          },
        }),
      ],
    });
    renderPage();

    await screen.findByText('Няма свободни места.');
    expect(screen.queryByRole('button', { name: 'Записване в чакащи' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Записване' })).toBeNull();
  });

  // AC #2: leaving is always safe, so the cutoff must not hide the button.
  it('keeps Leave waitlist past the cutoff, but not Join', async () => {
    mockFetch({
      entries: () => [
        mkFullEntry({
          startsAt: new Date(Date.now() + HOUR / 2).toISOString(),
          class: {
            id: 'c',
            name: 'Late',
            allowSelfBooking: true,
            bookingCutoffMin: 60,
            waitlistMode: 'FIFO_AUTO',
          },
          myWaitlist: ['tr1'],
        }),
      ],
    });
    renderPage();

    await screen.findByRole('button', { name: 'Отказ от чакащи' });
    expect(screen.queryByRole('button', { name: 'Записване в чакащи' })).toBeNull();
  });
});
