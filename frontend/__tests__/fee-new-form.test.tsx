import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewFeePage from '@/app/(dashboard)/fees/new/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
// TKT-0091: switchable per test — the page reads ?classId=/?traineeId= via useSearchParams.
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/fees/new',
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

// Only the fields the form reads. A PER_MONTH class prices by monthlyAmount and a PER_SESSION one by
// sessionPrice — the same pairing FeesService's two generators use.
const CLASSES = [
  {
    id: 'c-month',
    tenantId: 't',
    name: 'Judo monthly',
    description: null,
    billingMode: 'PER_MONTH',
    monthlyAmount: '80.00',
    sessionPrice: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'c-session',
    tenantId: 't',
    name: 'Conditioning per session',
    description: null,
    billingMode: 'PER_SESSION',
    monthlyAmount: null,
    sessionPrice: '15',
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'c-unpriced',
    tenantId: 't',
    name: 'Free trial',
    description: null,
    billingMode: 'PER_MONTH',
    monthlyAmount: null,
    sessionPrice: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
];

const TRAINEES = [
  { id: 'tr1', firstName: 'Ada', lastName: 'Lovelace', isActive: true },
  { id: 'tr2', firstName: 'Bob', lastName: 'Builder', isActive: true },
];

function renderForm() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <NewFeePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

const classLabel = /^Клас$|^Class$/;
const amountLabel = /Сума \(EUR\)|Amount \(EUR\)/;

describe('NewFeePage — amount', () => {
  let postedBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    search = '';
    postedBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/trainees')) return Promise.resolve(jsonResponse(200, paged(TRAINEES)));
      if (url.includes('/fees') && init?.method === 'POST') {
        postedBody = init.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(201, { id: 'f1' }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function selectClass(user: ReturnType<typeof userEvent.setup>, id: string) {
    const select = await screen.findByLabelText(classLabel);
    await user.selectOptions(select, id);
    return select;
  }

  // The complaint that started this: the price was already in the browser and the field stayed blank.
  it('fills the amount from a PER_MONTH class monthlyAmount', async () => {
    const user = userEvent.setup();
    renderForm();
    await selectClass(user, 'c-month');

    expect(await screen.findByDisplayValue('80')).toBeInTheDocument();
  });

  it('fills the amount from a PER_SESSION class sessionPrice', async () => {
    const user = userEvent.setup();
    renderForm();
    await selectClass(user, 'c-session');

    expect(await screen.findByDisplayValue('15')).toBeInTheDocument();
  });

  it('replaces the amount when the class changes, including one typed by hand', async () => {
    const user = userEvent.setup();
    renderForm();
    const amount = await screen.findByLabelText(amountLabel);

    await selectClass(user, 'c-month');
    await user.clear(amount);
    await user.type(amount, '55');
    await selectClass(user, 'c-session');

    expect(amount).toHaveValue(15);
  });

  it('leaves a hand-typed amount alone for a class that has no price', async () => {
    const user = userEvent.setup();
    renderForm();
    const amount = await screen.findByLabelText(amountLabel);
    await user.type(amount, '33');

    await selectClass(user, 'c-unpriced');

    expect(amount).toHaveValue(33);
  });

  it.each(['', 'abc', '0', '-5', '1.234', '2000000'])(
    'refuses to submit the amount %j and says so on the field',
    async (value) => {
      const user = userEvent.setup();
      renderForm();
      await selectClass(user, 'c-month');
      const amount = await screen.findByLabelText(amountLabel);
      await user.clear(amount);
      if (value !== '') await user.type(amount, value);
      await user.selectOptions(await screen.findByLabelText(/^Трениращ$|^Trainee$/), 'tr1');
      await user.type(screen.getByLabelText(/Начало на периода|Period start/), '2026-03-01');
      await user.type(screen.getByLabelText(/Край на периода|Period end/), '2026-03-31');

      await user.click(screen.getByRole('button', { name: /Запазване|^Save$/ }));

      expect(await screen.findByText(/Сумата трябва|Amount must/)).toBeInTheDocument();
      expect(postedBody).toBeNull();
    },
  );

  // TKT-0091: contextual create — query parameters preselect class/trainee, membership-checked.
  it('preselects the class from ?classId= and lets it drive the amount', async () => {
    search = 'classId=c-month';
    renderForm();

    const select = await screen.findByLabelText(classLabel);
    await vi.waitFor(() => expect(select).toHaveValue('c-month'));
    // AC #3: the TKT-0073 amount prefill runs off the prefilled class.
    expect(await screen.findByDisplayValue('80')).toBeInTheDocument();
  });

  it('preselects the trainee from ?traineeId=', async () => {
    search = 'traineeId=tr1';
    renderForm();

    const select = await screen.findByLabelText(/^Трениращ$|^Trainee$/);
    await vi.waitFor(() => expect(select).toHaveValue('tr1'));
  });

  it('leaves nothing selected for ids that are not in the lists', async () => {
    search = 'classId=bogus&traineeId=also-bogus';
    renderForm();

    expect(await screen.findByRole('option', { name: 'Judo monthly' })).toBeInTheDocument();
    expect(screen.getByLabelText(classLabel)).toHaveValue('');
    expect(screen.getByLabelText(/^Трениращ$|^Trainee$/)).toHaveValue('');
  });

  it('submitted unchanged, the created fee references both parents from the parameters', async () => {
    search = 'classId=c-month&traineeId=tr1';
    const user = userEvent.setup();
    renderForm();

    const select = await screen.findByLabelText(classLabel);
    await vi.waitFor(() => expect(select).toHaveValue('c-month'));
    await user.type(screen.getByLabelText(/Начало на периода|Period start/), '2026-03-01');
    await user.type(screen.getByLabelText(/Край на периода|Period end/), '2026-03-31');

    await user.click(screen.getByRole('button', { name: /Запазване|^Save$/ }));

    await vi.waitFor(() => expect(postedBody).not.toBeNull());
    expect(postedBody).toMatchObject({ classId: 'c-month', traineeId: 'tr1', amount: 80 });

    // TKT-0092: stays on the form, confirms with a toast; the reset preserves both
    // query-parameter parents, clears the period, and the amount re-primes off the class.
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(screen.getByLabelText(classLabel)).toHaveValue('c-month');
      expect(screen.getByLabelText(/^Трениращ$|^Trainee$/)).toHaveValue('tr1');
      expect(screen.getByLabelText(/Начало на периода|Period start/)).toHaveValue('');
      expect(screen.getByLabelText(amountLabel)).toHaveValue(80);
    });
  });

  it('posts the amount as a number once the form is valid', async () => {
    const user = userEvent.setup();
    renderForm();
    await selectClass(user, 'c-month');
    await user.selectOptions(await screen.findByLabelText(/^Трениращ$|^Trainee$/), 'tr1');
    await user.type(screen.getByLabelText(/Начало на периода|Period start/), '2026-03-01');
    await user.type(screen.getByLabelText(/Край на периода|Period end/), '2026-03-31');

    await user.click(screen.getByRole('button', { name: /Запазване|^Save$/ }));

    await vi.waitFor(() => expect(postedBody).not.toBeNull());
    // Requests carry numbers, responses carry strings (api-response-aliases.test.ts pins both).
    expect(postedBody).toMatchObject({ classId: 'c-month', traineeId: 'tr1', amount: 80 });
    expect(typeof postedBody!.amount).toBe('number');
  });

  // TKT-0090: a failed field says what is wrong in words, wired for assistive tech.
  it('says what is wrong and wires the a11y attributes when submitted empty', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(await screen.findByRole('button', { name: /Запазване|^Save$/ }));

    const messages = await screen.findAllByText('Това поле е задължително.');
    expect(messages.length).toBeGreaterThanOrEqual(3); // class, trainee, both period bounds
    const classSelect = screen.getByLabelText(classLabel);
    expect(classSelect).toHaveAttribute('aria-invalid', 'true');
    expect(classSelect).toHaveAttribute('aria-describedby', 'classId-error');
    const classError = messages.find((m) => m.id === 'classId-error');
    expect(classError).toBeDefined();
    expect(classError).toHaveAttribute('role', 'alert');
    // The amount refine carries its own message.
    expect(screen.getByText(/Сумата трябва|Amount must/)).toHaveAttribute('id', 'amount-error');
  });
});
