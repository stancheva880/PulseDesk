import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttendancePage from '@/app/(dashboard)/sessions/[id]/attendance/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'session-1' }),
  usePathname: () => '/sessions/session-1/attendance',
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

function sessionDetail(waitlistMode: string) {
  return {
    id: 'session-1', tenantId: 't', classId: 'c', locationId: 'l',
    startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-01T19:00:00.000Z',
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
    class: { id: 'c', name: 'Yoga 101', billingMode: 'PER_SESSION', capacity: 1, waitlistMode },
    location: { id: 'l', name: 'Studio A' },
    trainers: [],
  };
}
const ROWS = [
  {
    id: 'a1', tenantId: 't', sessionId: 'session-1', traineeId: 'tr1',
    trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
    status: 'PENDING', traineeRsvp: null, notes: null,
    markedAt: null, markedById: null, markedByEmailSnapshot: null, markedByNameSnapshot: null,
    createdAt: '', updatedAt: '',
  },
];
const CANDIDATES = [
  { id: 'tr8', tenantId: 't', firstName: 'Bo', lastName: 'Queue', isActive: true },
  { id: 'tr9', tenantId: 't', firstName: 'Cara', lastName: 'Drop', isActive: true },
];
// Full session everywhere here: capacity 1, spotsLeft 0.
const CANDIDATES_PAGE = {
  items: CANDIDATES, page: 1, pageSize: 100, total: 2, totalPages: 1, spotsLeft: 0,
};

const entry = (id: string, traineeId: string, name: [string, string], createdAt: string) => ({
  id, tenantId: 't', sessionId: 'session-1', traineeId, createdAt,
  trainee: { id: traineeId, firstName: name[0], lastName: name[1] },
});

describe('AttendancePage waitlist (TKT-0112)', () => {
  let posted: { url: string; body: Record<string, unknown> } | null = null;
  let deleted: string | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    posted = null;
    deleted = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockApi(waitlistMode: string, queue: unknown[]) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/waitlist')) {
        if (init?.method === 'POST') {
          posted = { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
          return jsonResponse(201, {
            id: 'w-new', tenantId: 't', sessionId: 'session-1',
            traineeId: (posted.body as { traineeId: string }).traineeId, createdAt: '',
          });
        }
        if (init?.method === 'DELETE') {
          deleted = url;
          return jsonResponse(204, null);
        }
        return jsonResponse(200, queue);
      }
      if (url.includes('/attendance-candidates')) return jsonResponse(200, CANDIDATES_PAGE);
      if (url.includes('/attendances')) return jsonResponse(200, ROWS);
      if (url.includes('/sessions/session-1')) {
        return jsonResponse(200, sessionDetail(waitlistMode));
      }
      return jsonResponse(200, {});
    });
  }

  function renderPage() {
    return render(
      <I18nProvider>
        <AuthProvider>
          <AttendancePage />
        </AuthProvider>
      </I18nProvider>,
    );
  }

  it('offers add-to-waitlist on a full session and posts the choice', async () => {
    mockApi('FIFO_AUTO', []);
    renderPage();

    const select = await screen.findByRole('combobox', { name: 'Добавяне в чакащи' });
    fireEvent.change(select, { target: { value: 'tr9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добави в чакащи' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.url).toContain('/sessions/session-1/waitlist');
    expect(posted!.body).toEqual({ traineeId: 'tr9' });
  });

  it('renders the queue in order, hides queued candidates, and removes an entry', async () => {
    mockApi('FIFO_AUTO', [
      entry('w1', 'tr9', ['Cara', 'Drop'], '2026-06-01T08:00:00.000Z'),
      entry('w2', 'tr7', ['Zed', 'Last'], '2026-06-01T09:00:00.000Z'),
    ]);
    renderPage();

    const queueItems = await screen.findAllByTestId('waitlist-entry');
    expect(queueItems).toHaveLength(2);
    expect(queueItems[0]!.textContent).toContain('Cara Drop');
    expect(queueItems[1]!.textContent).toContain('Zed Last');

    // Cara (tr9) is queued — she must not be offered again in the add select.
    const select = screen.getByRole('combobox', { name: 'Добавяне в чакащи' });
    expect(select.textContent).not.toContain('Cara Drop');
    expect(select.textContent).toContain('Bo Queue');

    const removeButtons = screen.getAllByRole('button', { name: 'Премахване' });
    fireEvent.click(removeButtons[0]!);
    await waitFor(() => expect(deleted).not.toBeNull());
    expect(deleted).toContain('/sessions/session-1/waitlist/w1');
  });

  // TKT-0113: the unbooking door — every row can be removed; the refetch shows a promotion.
  it('removes an attendance row and refetches', async () => {
    mockApi('FIFO_AUTO', []);
    let rowDeleted: string | null = null;
    const base = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/attendances/a1') && init?.method === 'DELETE') {
        rowDeleted = url;
        return jsonResponse(204, null);
      }
      return base(input, init);
    });

    renderPage();
    const remove = await screen.findByRole('button', { name: 'Премахване от тренировката' });
    fireEvent.click(remove);

    await waitFor(() => expect(rowDeleted).not.toBeNull());
    expect(rowDeleted).toContain('/sessions/session-1/attendances/a1');
  });

  it('keeps the bare full note when the class waitlist mode is NONE', async () => {
    mockApi('NONE', []);
    renderPage();

    expect(await screen.findByText('Няма свободни места.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Добавяне в чакащи' })).toBeNull();
  });
});
