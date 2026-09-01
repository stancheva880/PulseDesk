import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SessionsListPage from '@/app/(dashboard)/sessions/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const push = vi.fn();
// TKT-0094: the page reads ?startsAtFrom=/?startsAtBefore= — switchable per test.
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push, back: vi.fn() }),
  usePathname: () => '/sessions',
  useSearchParams: () => new URLSearchParams(search),
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
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 };
}

const SESSIONS = [
  {
    id: 's1', tenantId: 't', classId: 'c1', locationId: 'loc-1',
    startsAt: '2026-03-02T10:00:00.000Z', endsAt: '2026-03-02T11:00:00.000Z',
    status: 'SCHEDULED', notes: null, createdAt: '', updatedAt: '',
  },
];
const CLASSES = [{ id: 'c1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true }];
const LOCATIONS = [{ id: 'loc-1', tenantId: 't', name: 'Main Hall', address: null, isActive: true }];

// TKT-0094: the same local-midnight expression the page uses, so assertions hold in any timezone.
function dayStartIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toISOString();
}
function todayLocalDate(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}
function paramOf(url: string, key: string): string | null {
  return new URL(url, 'http://test.local').searchParams.get(key);
}

describe('SessionsListPage', () => {
  // Every GET /sessions list request, in order — the filter assertions read these.
  let sessionUrls: string[] = [];

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    // TKT-0099 (approved TEST CHANGE REQUEST): the calendar is now the default view, so these
    // table-behaviour cases enter through ?view=table. Assertions are unchanged; the default
    // view itself is covered by sessions-page-calendar.test.tsx.
    search = 'view=table';
    sessionUrls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) {
        sessionUrls.push(url);
        return Promise.resolve(jsonResponse(200, paged(SESSIONS)));
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders session rows with lookups, attendance link and admin edit link', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    // TKT-0100 (approved TCR #2): role-scoped — the admin filter bar's <option>s repeat these names.
    expect(await screen.findByRole('cell', { name: 'Yoga' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Main Hall' })).toBeInTheDocument();
    expect(container.querySelector('a[href="/sessions/s1/attendance"]')).not.toBeNull();
    expect(container.querySelector('a[href="/sessions/s1/edit"]')).not.toBeNull();
    expect(container.querySelector('a[href="/sessions/new"]')).not.toBeNull();
  });

  // TKT-0088: row activation opens the record — the edit form for an admin.
  it('opens the edit form when an admin activates the row', async () => {
    push.mockReset();
    render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('cell', { name: 'Yoga' }));

    expect(push).toHaveBeenCalledWith('/sessions/s1/edit');
  });

  // A trainer's record view is the attendance ledger — the edit form's save can only 403.
  it('opens the attendance page when a trainer activates the row', async () => {
    push.mockReset();
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'EMPLOYEE', tenantId: 't', exp }));
    render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('cell', { name: 'Yoga' }));

    expect(push).toHaveBeenCalledWith('/sessions/s1/attendance');
  });

  // TKT-0094 AC #1 — the default is start of today in the viewer's timezone, not "now": a class
  // that finished this morning must still be listed.
  it('requests startsAtFrom = start of today by default, with no upper bound', async () => {
    render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByRole('cell', { name: 'Yoga' });

    const last = sessionUrls[sessionUrls.length - 1]!;
    expect(paramOf(last, 'startsAtFrom')).toBe(dayStartIso(todayLocalDate()));
    expect(paramOf(last, 'startsAtBefore')).toBeNull();
  });

  // TKT-0094 AC #2 — the default is visible and clearable; cleared, past sessions are reachable.
  it('shows the active default in the From input and clears to an unbounded request', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByRole('cell', { name: 'Yoga' });

    const from = container.querySelector<HTMLInputElement>('#filter-from')!;
    expect(from.value).toBe(todayLocalDate());

    fireEvent.click(
      screen.getByRole('button', { name: /Clear start date|Изчистване на началната дата/ }),
    );

    await waitFor(() => {
      const last = sessionUrls[sessionUrls.length - 1]!;
      expect(paramOf(last, 'startsAtFrom')).toBeNull();
      expect(paramOf(last, 'startsAtBefore')).toBeNull();
    });
  });

  // TKT-0094 AC #3 — half-open: both bounds travel as local-midnight instants; the exclusive
  // upper-bound behaviour itself is the server's documented contract.
  it('sends an entered range as inclusive-from / exclusive-before instants', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByRole('cell', { name: 'Yoga' });

    fireEvent.change(container.querySelector('#filter-from')!, { target: { value: '2026-03-02' } });
    fireEvent.change(container.querySelector('#filter-before')!, { target: { value: '2026-03-09' } });

    await waitFor(() => {
      const last = sessionUrls[sessionUrls.length - 1]!;
      expect(paramOf(last, 'startsAtFrom')).toBe(dayStartIso('2026-03-02'));
      expect(paramOf(last, 'startsAtBefore')).toBe(dayStartIso('2026-03-09'));
    });
  });

  // TKT-0094 AC #4 — an inverted range is rejected before any request is sent.
  it('rejects an inverted range without sending a request', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByRole('cell', { name: 'Yoga' });

    fireEvent.change(container.querySelector('#filter-from')!, { target: { value: '2026-03-09' } });
    await waitFor(() => {
      expect(paramOf(sessionUrls[sessionUrls.length - 1]!, 'startsAtFrom')).toBe(
        dayStartIso('2026-03-09'),
      );
    });
    const countBefore = sessionUrls.length;

    fireEvent.change(container.querySelector('#filter-before')!, { target: { value: '2026-03-02' } });

    expect(
      await screen.findByText(/upper bound must be after|Крайната дата трябва да е след/),
    ).toBeInTheDocument();
    expect(sessionUrls.length).toBe(countBefore);
  });

  // TKT-0094 AC #5 — pagination reflects the filtered total, and a page change keeps the filter.
  it('paginates within the filtered set', async () => {
    vi.restoreAllMocks();
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) {
        sessionUrls.push(url);
        const page = Number(paramOf(url, 'page') ?? '1');
        return Promise.resolve(
          jsonResponse(200, { items: SESSIONS, page, pageSize: 25, total: 30, totalPages: 2 }),
        );
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });

    render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByRole('cell', { name: 'Yoga' });
    // The summary shows the filtered total from the envelope.
    expect(await screen.findByText(/30/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next|Напред/ }));

    await waitFor(() => {
      const last = sessionUrls[sessionUrls.length - 1]!;
      expect(paramOf(last, 'page')).toBe('2');
      expect(paramOf(last, 'startsAtFrom')).toBe(dayStartIso(todayLocalDate()));
    });
  });

  // TKT-0094 — the URL seam TKT-0096's dashboard tile links through: full ISO instants in,
  // the same bounds out, and the inputs show the corresponding local dates.
  it('reads both bounds from the URL and reflects them in the inputs', async () => {
    const fromIso = dayStartIso('2026-03-02');
    const beforeIso = dayStartIso('2026-03-09');
    search = new URLSearchParams({ startsAtFrom: fromIso, startsAtBefore: beforeIso }).toString();

    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByRole('cell', { name: 'Yoga' });

    const first = sessionUrls[0]!;
    expect(paramOf(first, 'startsAtFrom')).toBe(fromIso);
    expect(paramOf(first, 'startsAtBefore')).toBe(beforeIso);
    expect(container.querySelector<HTMLInputElement>('#filter-from')!.value).toBe('2026-03-02');
    expect(container.querySelector<HTMLInputElement>('#filter-before')!.value).toBe('2026-03-09');
  });

  // The table shows who's teaching each row, not just the detail/edit page.
  it('shows the trainer(s) for each row, and a dash when none are assigned', async () => {
    vi.restoreAllMocks();
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    const sessionsWithTrainers = [
      { ...SESSIONS[0], trainers: [{ id: 'tr-1', firstName: 'Tina', lastName: 'Trainer', email: 'tina@x' }] },
      { ...SESSIONS[0], id: 's2', trainers: [] },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/sessions')) return Promise.resolve(jsonResponse(200, paged(sessionsWithTrainers)));
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });

    render(
      <I18nProvider>
        <AuthProvider>
          <SessionsListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    expect(await screen.findByRole('cell', { name: 'Tina Trainer' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '—' }).length).toBeGreaterThanOrEqual(1);
  });
});
