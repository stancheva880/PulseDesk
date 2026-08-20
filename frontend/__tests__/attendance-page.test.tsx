import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttendancePage from '@/app/(dashboard)/sessions/[id]/attendance/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const back = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back }),
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

function paged<T>(items: T[]): unknown {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

const SESSION_DETAIL = {
  id: 'session-1',
  tenantId: 't',
  classId: 'c',
  locationId: 'l',
  startsAt: '2026-06-01T18:00:00.000Z',
  endsAt: '2026-06-01T19:00:00.000Z',
  status: 'SCHEDULED',
  notes: null,
  createdAt: '',
  updatedAt: '',
  class: { id: 'c', name: 'Yoga 101', billingMode: 'PER_SESSION' },
  location: { id: 'l', name: 'Studio A' },
  trainers: [],
};

// Mirrors the endpoint: GET /sessions/:id/attendances includes the trainee on each row.
const ATTENDANCE_ROWS = [
  {
    id: 'a1',
    tenantId: 't',
    sessionId: 'session-1',
    traineeId: 'tr1',
    trainee: { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace' },
    status: 'PENDING',
    traineeRsvp: null,
    notes: null,
    markedAt: null,
    markedById: null,
    markedByEmailSnapshot: null,
    markedByNameSnapshot: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'a2',
    tenantId: 't',
    sessionId: 'session-1',
    traineeId: 'tr2',
    trainee: { id: 'tr2', firstName: 'Bob', lastName: 'Builder' },
    status: 'PENDING',
    traineeRsvp: 'CONFIRMED',
    notes: null,
    markedAt: null,
    markedById: null,
    markedByEmailSnapshot: null,
    markedByNameSnapshot: null,
    createdAt: '',
    updatedAt: '',
  },
];

const TRAINEES = [
  {
    id: 'tr1',
    tenantId: 't',
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '1990-01-01',
    phone: null,
    email: null,
    notes: null,
    isActive: true,
    userId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'tr2',
    tenantId: 't',
    firstName: 'Bob',
    lastName: 'Builder',
    dateOfBirth: '1990-01-01',
    phone: null,
    email: null,
    notes: null,
    isActive: true,
    userId: null,
    createdAt: '',
    updatedAt: '',
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <AttendancePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('AttendancePage — toggle group + Save All', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }));
    back.mockClear();
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

  it('renders one row per attendance with the trainee name', async () => {
    mockFetch((url) => {
      if (url.endsWith('/sessions/session-1')) return jsonResponse(200, SESSION_DETAIL);
      if (url.endsWith('/sessions/session-1/attendances')) return jsonResponse(200, ATTENDANCE_ROWS);
      if (url.includes('/attendance-candidates')) return jsonResponse(200, paged([]));
      return jsonResponse(404, null);
    });
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
  });

  // TKT-0068: the endpoint is unpaginated and stops at 100 rows, and Save All submits a snapshot
  // of what was rendered. A full page therefore means "there may be attendees you cannot see and
  // are about to leave unmarked", and saying so is the whole fix — the silence was the bug.
  const fullPage = Array.from({ length: 100 }, (_, i) => ({
    ...ATTENDANCE_ROWS[0],
    id: `full-${i}`,
    traineeId: `tr-full-${i}`,
    trainee: { id: `tr-full-${i}`, firstName: 'Crowd', lastName: String(i) },
  }));

  it('warns that the list may be incomplete when the response fills the cap', async () => {
    mockFetch((url) => {
      if (url.endsWith('/sessions/session-1')) return jsonResponse(200, SESSION_DETAIL);
      if (url.endsWith('/sessions/session-1/attendances')) return jsonResponse(200, fullPage);
      if (url.includes('/attendance-candidates')) return jsonResponse(200, paged([]));
      return jsonResponse(404, null);
    });
    renderPage();

    expect(await screen.findByText(/непълен|incomplete/i)).toBeInTheDocument();
    // The rows that did arrive are still markable — a warning, not a blocked screen.
    expect(
      screen.getByRole('button', { name: /Save all|Запазване на всички/ }),
    ).toBeEnabled();
  });

  it('says nothing when the response is short of the cap', async () => {
    mockFetch((url) => {
      if (url.endsWith('/sessions/session-1')) return jsonResponse(200, SESSION_DETAIL);
      if (url.endsWith('/sessions/session-1/attendances')) return jsonResponse(200, ATTENDANCE_ROWS);
      if (url.includes('/attendance-candidates')) return jsonResponse(200, paged([]));
      return jsonResponse(404, null);
    });
    renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText(/непълен|incomplete/i)).not.toBeInTheDocument();
  });

  // A trainee on the session whom the picker would never mention — the candidates endpoint
  // excludes anyone already attending. The name has to come off the attendance row itself.
  const OVERFLOW_ROW = {
    ...ATTENDANCE_ROWS[0],
    id: 'a9',
    traineeId: 'tr101',
    trainee: { id: 'tr101', firstName: 'Zoe', lastName: 'Overflow' },
  };

  it('names a trainee the candidates endpoint would never return', async () => {
    mockFetch((url) => {
      if (url.endsWith('/sessions/session-1')) return jsonResponse(200, SESSION_DETAIL);
      if (url.endsWith('/sessions/session-1/attendances')) {
        return jsonResponse(200, [OVERFLOW_ROW]);
      }
      // tr101 is deliberately absent from this page.
      if (url.includes('/attendance-candidates')) return jsonResponse(200, paged([]));
      return jsonResponse(404, null);
    });
    renderPage();

    expect(await screen.findByText('Zoe Overflow')).toBeInTheDocument();
    expect(screen.queryByText('tr101')).not.toBeInTheDocument();
  });

  it('keeps trainee names after Save All refetches the rows', async () => {
    const user = userEvent.setup();
    let saved = false;
    mockFetch((url, init) => {
      if (url.endsWith('/sessions/session-1') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse(200, SESSION_DETAIL);
      }
      if (url.endsWith('/sessions/session-1/attendances')) {
        if (init?.method === 'PUT') {
          saved = true;
          return jsonResponse(200, { updated: 1 });
        }
        return jsonResponse(200, [OVERFLOW_ROW]);
      }
      if (url.includes('/attendance-candidates')) return jsonResponse(200, paged([]));
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Zoe Overflow');

    await user.click(screen.getByRole('button', { name: /Save all|Запазване на всички/ }));

    await waitFor(() => expect(saved).toBe(true));
    expect(await screen.findByText('Zoe Overflow')).toBeInTheDocument();
  });

  it('PENDING rows default to PRESENT and toggling switches aria-pressed', async () => {
    const user = userEvent.setup();
    mockFetch((url) => {
      if (url.endsWith('/sessions/session-1')) return jsonResponse(200, SESSION_DETAIL);
      if (url.endsWith('/sessions/session-1/attendances')) return jsonResponse(200, ATTENDANCE_ROWS);
      if (url.includes('/attendance-candidates')) return jsonResponse(200, paged([]));
      return jsonResponse(404, null);
    });
    renderPage();
    const adaRow = (await screen.findByText('Ada Lovelace')).closest('tr')!;
    const adaButtons = within(adaRow as HTMLElement).getAllByRole('button');
    const present = adaButtons.find((b) => /Present|Присъства/.test(b.textContent ?? ''))!;
    const absent = adaButtons.find((b) => /Absent|Отсъства/.test(b.textContent ?? ''))!;
    expect(present).toHaveAttribute('aria-pressed', 'true');
    expect(absent).toHaveAttribute('aria-pressed', 'false');
    await user.click(absent);
    expect(present).toHaveAttribute('aria-pressed', 'false');
    expect(absent).toHaveAttribute('aria-pressed', 'true');
  });

  it('Save All sends a single PUT with all current drafts', async () => {
    const user = userEvent.setup();
    let putBody: unknown = null;
    mockFetch((url, init) => {
      if (url.endsWith('/sessions/session-1') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse(200, SESSION_DETAIL);
      }
      if (url.endsWith('/sessions/session-1/attendances')) {
        if (init?.method === 'PUT') {
          putBody = JSON.parse(init.body as string);
          return jsonResponse(200, { updated: 2 });
        }
        return jsonResponse(200, ATTENDANCE_ROWS);
      }
      if (url.includes('/attendance-candidates')) return jsonResponse(200, paged([]));
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /Save all|Запазване на всички/ }));
    await screen.findByText(/Saved 2 row|Запазени са 2 реда/);
    expect(putBody).toEqual({
      items: [
        { traineeId: 'tr1', status: 'PRESENT' },
        { traineeId: 'tr2', status: 'PRESENT' },
      ],
    });
  });

  it('adds a trainee not yet on the session via POST and shows the new row', async () => {
    const user = userEvent.setup();
    const tr3 = { ...TRAINEES[0], id: 'tr3', firstName: 'Cleo', lastName: 'Newton' };
    const newRow = {
      ...ATTENDANCE_ROWS[0],
      id: 'a3',
      traineeId: 'tr3',
      trainee: { id: 'tr3', firstName: 'Cleo', lastName: 'Newton' },
      traineeRsvp: null,
    };
    let postBody: unknown = null;
    let added = false;
    let candidatesUrl: string | null = null;
    mockFetch((url, init) => {
      if (url.endsWith('/sessions/session-1') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse(200, SESSION_DETAIL);
      }
      if (url.endsWith('/sessions/session-1/attendances')) {
        if (init?.method === 'POST') {
          postBody = JSON.parse(init.body as string);
          added = true;
          return jsonResponse(201, newRow);
        }
        return jsonResponse(200, added ? [...ATTENDANCE_ROWS, newRow] : ATTENDANCE_ROWS);
      }
      if (url.includes('/attendance-candidates')) {
        candidatesUrl = url;
        // Modelled on the endpoint: tr1/tr2 are on the session, so only tr3 is ever a candidate,
        // and once tr3 is added nobody is left.
        return jsonResponse(200, paged(added ? [] : [tr3]));
      }
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');

    // The candidate set comes from the server now — the page no longer pages /trainees to work it
    // out, so it must have asked the session's own endpoint for it.
    expect(candidatesUrl).toContain('/sessions/session-1/attendance-candidates');
    const select = screen.getByRole('combobox', {
      name: /Add a trainee|Добавяне на трениращ/,
    });
    expect(within(select).queryByRole('option', { name: 'Ada Lovelace' })).toBeNull();
    await user.selectOptions(select, 'tr3');
    await user.click(screen.getByRole('button', { name: /^Add$|^Добавяне$/ }));

    expect(await screen.findByText('Cleo Newton')).toBeInTheDocument();
    expect(postBody).toEqual({ traineeId: 'tr3' });
  });
});
