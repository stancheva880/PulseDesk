import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttendancePage from '@/app/(dashboard)/sessions/[id]/attendance/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { writeStoredTokens } from '@/lib/auth-storage';

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

const ATTENDANCE_ROWS = [
  {
    id: 'a1',
    tenantId: 't',
    sessionId: 'session-1',
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
  },
  {
    id: 'a2',
    tenantId: 't',
    sessionId: 'session-1',
    traineeId: 'tr2',
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
    writeStoredTokens({
      accessToken: buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }),
      refreshToken: 'R',
    });
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

  it('renders one row per attendance with the trainee name resolved from /trainees', async () => {
    mockFetch((url) => {
      if (url.endsWith('/sessions/session-1')) return jsonResponse(200, SESSION_DETAIL);
      if (url.endsWith('/sessions/session-1/attendances')) return jsonResponse(200, ATTENDANCE_ROWS);
      if (url.endsWith('/trainees')) return jsonResponse(200, TRAINEES);
      return jsonResponse(404, null);
    });
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
  });

  it('PENDING rows default to PRESENT and toggling switches aria-pressed', async () => {
    const user = userEvent.setup();
    mockFetch((url) => {
      if (url.endsWith('/sessions/session-1')) return jsonResponse(200, SESSION_DETAIL);
      if (url.endsWith('/sessions/session-1/attendances')) return jsonResponse(200, ATTENDANCE_ROWS);
      if (url.endsWith('/trainees')) return jsonResponse(200, TRAINEES);
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
      if (url.endsWith('/trainees')) return jsonResponse(200, TRAINEES);
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
    const newRow = { ...ATTENDANCE_ROWS[0], id: 'a3', traineeId: 'tr3', traineeRsvp: null };
    let postBody: unknown = null;
    let added = false;
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
      if (url.endsWith('/trainees')) return jsonResponse(200, [...TRAINEES, tr3]);
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');

    // tr1/tr2 are already on the session; only tr3 is offered as a candidate.
    const select = screen.getByRole('combobox', {
      name: /Add a trainee|Добавяне на трениращ/,
    });
    await user.selectOptions(select, 'tr3');
    await user.click(screen.getByRole('button', { name: /^Add$|^Добавяне$/ }));

    expect(await screen.findByText('Cleo Newton')).toBeInTheDocument();
    expect(postBody).toEqual({ traineeId: 'tr3' });
  });
});
