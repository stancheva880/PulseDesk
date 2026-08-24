import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeesListPage from '@/app/(dashboard)/fees/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const push = vi.fn();
// TKT-0096: the page reads ?month= — switchable per test.
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push, back: vi.fn() }),
  usePathname: () => '/fees',
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
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

const FEES = [
  {
    id: 'f1',
    tenantId: 't',
    classId: 'c1',
    traineeId: 'tr1',
    sessionId: null,
    amount: '100.00',
    paid: '40.00',
    status: 'PARTIAL',
    periodStart: '2026-03-01T00:00:00.000Z',
    periodEnd: '2026-03-31T23:59:59.999Z',
    notes: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'f2',
    tenantId: 't',
    classId: 'c1',
    traineeId: 'tr2',
    sessionId: null,
    amount: '100.00',
    paid: '100.00',
    status: 'PAID',
    periodStart: '2026-03-01T00:00:00.000Z',
    periodEnd: '2026-03-31T23:59:59.999Z',
    notes: null,
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

const CLASSES = [
  {
    id: 'c1',
    tenantId: 't',
    name: 'Yoga 101',
    description: null,
    billingMode: 'PER_MONTH',
    monthlyAmount: '100',
    sessionPrice: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <FeesListPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('FeesListPage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    search = '';
  });

  function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return Promise.resolve(handler(url, init));
    });
  }

  // TKT-0096: the fees chart links here with ?month= — it must land in the visible month
  // filter and bound the request, so indication and clearing come with the existing input.
  it('seeds the month filter from ?month= and bounds the request', async () => {
    search = 'month=2026-03';
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      if (url.includes('/fees?') || url.endsWith('/fees')) return jsonResponse(200, paged(FEES));
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
      if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');

    const feesRequest = urls.find((u) => u.includes('/fees?'));
    expect(feesRequest).toContain('periodStartFrom=2026-03-01');
    expect(feesRequest).toContain('periodStartTo=2026-03-31');
    expect(screen.getByLabelText(/Month|Месец/)).toHaveValue('2026-03');
  });

  it('ignores a malformed ?month=', async () => {
    search = 'month=garbage';
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      if (url.includes('/fees?') || url.endsWith('/fees')) return jsonResponse(200, paged(FEES));
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
      if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');

    const feesRequest = urls.find((u) => u.includes('/fees'));
    expect(feesRequest).not.toContain('periodStartFrom');
    expect(screen.getByLabelText(/Month|Месец/)).toHaveValue('');
  });

  it('renders one row per fee with trainee + class joined client-side AND outstanding column', async () => {
    mockFetch((url) => {
      if (url.includes('/fees?') || url.endsWith('/fees')) return jsonResponse(200, paged(FEES));
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
      if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
      return jsonResponse(404, null);
    });
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
    expect(screen.getAllByText('Yoga 101').length).toBeGreaterThanOrEqual(2);
    // Status badges (also appear in the filter dropdown options — assert "at least one").
    expect(screen.getAllByText(/Partial|Частично/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^Paid$|^Платена$/).length).toBeGreaterThanOrEqual(1);
    // Outstanding column: f1 amount 100 paid 40 → 60.00; f2 amount 100 paid 100 → 0.00
    expect(screen.getByText(/60\.00 EUR/)).toBeInTheDocument();
    expect(screen.getByText(/^0\.00 EUR$/)).toBeInTheDocument();
  });

  // TKT-0095: the free-text box asks the server — the old client-side filter over the 25
  // loaded rows made a miss on page 2 look like an answer. Replaced per the TEST CHANGE
  // REQUEST in .workflow/tech-plans/TKT-0095.md.
  it('sends the query as the search parameter and resets to page 1', async () => {
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
      if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
      if (url.includes('/fees')) return jsonResponse(200, paged(FEES));
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');

    fireEvent.change(screen.getByPlaceholderText(/Search|Търсене/), {
      target: { value: 'Bob' },
    });

    await waitFor(() => {
      const last = urls.filter((u) => u.includes('/fees?')).pop()!;
      const params = new URL(last, 'http://test.local').searchParams;
      expect(params.get('search')).toBe('Bob');
      expect(params.get('page')).toBe('1');
    });
  });

  it('sorts by periodStart desc by default and toggles asc/desc on Amount header click', async () => {
    const user = userEvent.setup();
    const FEES3 = [
      ...FEES,
      {
        id: 'f3',
        tenantId: 't',
        classId: 'c1',
        traineeId: 'tr3',
        sessionId: null,
        amount: '150.00',
        paid: '0.00',
        status: 'UNPAID',
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-04-30T23:59:59.999Z',
        notes: null,
        createdAt: '',
        updatedAt: '',
      },
    ];
    const TRAINEES3 = [
      ...TRAINEES,
      {
        id: 'tr3',
        tenantId: 't',
        firstName: 'Cara',
        lastName: 'Chase',
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
    mockFetch((url) => {
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES3));
      if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
      if (url.includes('/fees')) return jsonResponse(200, paged(FEES3));
      return jsonResponse(404, null);
    });
    const { container } = renderPage();
    await screen.findByText('Cara Chase');

    const rowTexts = () =>
      Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');

    // Default sort: periodStart desc → the April fee (Cara) comes first.
    expect(rowTexts()[0]).toContain('Cara Chase');

    const amountHeader = screen.getByText(/^Amount$|^Сума$/).closest('th')!;
    await user.click(amountHeader);
    // Numeric columns sort desc first: 150 on top.
    expect(rowTexts()[0]).toContain('Cara Chase');

    await user.click(amountHeader);
    // Second click flips to asc: 100, 100, 150 → Cara (150) last.
    expect(rowTexts()[2]).toContain('Cara Chase');
  });

  it('Generate-monthly form posts to /fees/generate-monthly and reports created/skipped', async () => {
    const user = userEvent.setup();
    let postedTo: string | null = null;
    let postedBody: unknown = null;
    mockFetch((url, init) => {
      if (url.endsWith('/fees/generate-monthly') && init?.method === 'POST') {
        postedTo = url;
        postedBody = JSON.parse(init.body as string);
        return jsonResponse(200, { created: 3, skipped: 1 });
      }
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
      if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
      if (url.includes('/fees')) return jsonResponse(200, paged(FEES));
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');

    const monthlyCard = screen
      .getByText(/Generate monthly fees|Генериране на месечни/)
      .closest('div')!.parentElement!.parentElement! as HTMLElement;
    const startInput = within(monthlyCard).getByLabelText(/Period start|Начало/);
    const endInput = within(monthlyCard).getByLabelText(/Period end|Край/);
    await user.type(startInput, '2026-03-01');
    await user.type(endInput, '2026-03-31');
    const submitBtn = within(monthlyCard).getByRole('button', { name: /Generate|Генериране/ });
    await user.click(submitBtn);

    await screen.findByText(/Created 3 fee\(s\); skipped 1 duplicate\(s\)|Създадени 3 такси; пропуснати дубликати: 1/);
    expect(postedTo).toContain('/fees/generate-monthly');
    expect(postedBody).toEqual({
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
    });
  });

  // TKT-0110 — the third generator: no dates, the course class carries its own period.
  it('Generate-course form posts the chosen classId to /fees/generate-course', async () => {
    const user = userEvent.setup();
    const courseClass = {
      id: 'course-1',
      tenantId: 't',
      name: 'English Spring',
      description: null,
      billingMode: 'PER_COURSE',
      monthlyAmount: null,
      sessionPrice: null,
      courseStart: '2026-03-01T00:00:00.000Z',
      courseEnd: '2026-08-31T00:00:00.000Z',
      coursePrice: '300',
      capacity: null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    };
    let postedTo: string | null = null;
    let postedBody: unknown = null;
    mockFetch((url, init) => {
      if (url.endsWith('/fees/generate-course') && init?.method === 'POST') {
        postedTo = url;
        postedBody = JSON.parse(init.body as string);
        return jsonResponse(200, { created: 2, skipped: 0 });
      }
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
      if (url.includes('/classes')) return jsonResponse(200, paged([...CLASSES, courseClass]));
      if (url.includes('/fees')) return jsonResponse(200, paged(FEES));
      return jsonResponse(404, null);
    });
    renderPage();
    await screen.findByText('Ada Lovelace');

    const courseCard = screen
      .getByText(/Generate course fees|Генериране на курсови/)
      .closest('div')!.parentElement!.parentElement! as HTMLElement;
    // Only PER_COURSE classes are offered.
    const select = within(courseCard).getByLabelText(/Class|Клас/) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain('English Spring');
    expect(optionLabels).not.toContain(CLASSES[0]!.name);

    await user.selectOptions(select, 'course-1');
    const submitBtn = within(courseCard).getByRole('button', { name: /Generate|Генериране/ });
    await user.click(submitBtn);

    await screen.findByText(/Created 2 fee\(s\)|Създадени 2 такси/);
    expect(postedTo).toContain('/fees/generate-course');
    expect(postedBody).toEqual({ classId: 'course-1' });
  });
  // The API always accepted classId and a period window; until now the page never sent them,
  // so "who still owes for this class this month" could not be asked from the UI at all.
  describe('class + month + outstanding filters', () => {
    it('sends classId, the month bounds and status=OUTSTANDING', async () => {
      const user = userEvent.setup();
      const urls: string[] = [];
      mockFetch((url) => {
        urls.push(url);
        if (url.includes('/fees/unbilled')) return jsonResponse(200, []);
        if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
        if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
        if (url.includes('/fees')) return jsonResponse(200, paged(FEES));
        return jsonResponse(404, null);
      });
      renderPage();
      await screen.findByText('Ada Lovelace');

      await user.selectOptions(document.getElementById('classFilter') as HTMLSelectElement, 'c1');
      fireEvent.change(document.getElementById('month') as HTMLInputElement, {
        target: { value: '2026-03' },
      });
      await user.selectOptions(
        document.getElementById('status') as HTMLSelectElement,
        'OUTSTANDING',
      );

      await waitFor(() => {
        expect(
          urls.some(
            (u) =>
              u.includes('status=OUTSTANDING') &&
              u.includes('classId=c1') &&
              // The month expands to inclusive day bounds; March has 31 days.
              u.includes('periodStartFrom=2026-03-01') &&
              u.includes('periodStartTo=2026-03-31'),
          ),
        ).toBe(true);
      });
    });

    it('shows enrolled trainees who have no fee at all for the chosen month', async () => {
      const user = userEvent.setup();
      mockFetch((url) => {
        if (url.includes('/fees/unbilled')) {
          return jsonResponse(200, [
            {
              classId: 'c1',
              className: 'Yoga 101',
              traineeId: 'tr9',
              traineeFirstName: 'Grace',
              traineeLastName: 'Hopper',
              amount: '100',
            },
          ]);
        }
        if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
        if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
        if (url.includes('/fees')) return jsonResponse(200, paged(FEES));
        return jsonResponse(404, null);
      });
      renderPage();
      await screen.findByText('Ada Lovelace');

      // Nothing is asked for, and nothing is shown, until both a class and a month are picked.
      expect(screen.queryByText(/Grace Hopper/)).not.toBeInTheDocument();

      await user.selectOptions(document.getElementById('classFilter') as HTMLSelectElement, 'c1');
      fireEvent.change(document.getElementById('month') as HTMLInputElement, {
        target: { value: '2026-03' },
      });

      expect(await screen.findByText(/Grace Hopper · Yoga 101/)).toBeInTheDocument();
    });
  });
});

// TKT-0088 AC #5: fees passes `actions: undefined` for non-admins — no actions column at all —
// and a non-admin must still open a fee by activating its row.
describe('FeesListPage — row navigation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    push.mockReset();
  });

  function signInAndMock(role: string) {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/trainees')) return jsonResponse(200, paged(TRAINEES));
      if (url.includes('/classes')) return jsonResponse(200, paged(CLASSES));
      if (url.includes('/fees')) return jsonResponse(200, paged(FEES));
      return jsonResponse(200, {});
    });
  }

  it('a non-admin opens the fee detail by activating the row', async () => {
    signInAndMock('EMPLOYEE');
    renderPage();

    fireEvent.click(await screen.findByText('Ada Lovelace'));

    expect(push).toHaveBeenCalledWith('/fees/f1');
  });

  it('an admin opens the fee detail by activating the row too', async () => {
    signInAndMock('ADMIN');
    renderPage();

    fireEvent.click(await screen.findByText('Ada Lovelace'));

    expect(push).toHaveBeenCalledWith('/fees/f1');
  });
});
