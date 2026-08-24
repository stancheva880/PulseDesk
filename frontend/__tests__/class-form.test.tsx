import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditClassPage from '@/app/(dashboard)/classes/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'class-1' }),
  usePathname: () => '/classes/class-1/edit',
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

const CLASS_DETAIL = {
  id: 'class-1',
  tenantId: 't',
  name: 'Yoga',
  description: null,
  billingMode: 'PER_SESSION',
  monthlyAmount: null,
  sessionPrice: '10',
  isActive: true,
  createdAt: '',
  updatedAt: '',
  locations: [],
  trainers: [{ id: 'emp-1', firstName: 'Tina', lastName: 'Trainer', email: 'tina@x' }],
  trainees: [{ id: 'tr-1', firstName: 'Ada', lastName: 'Lovelace' }],
};
const TRAINEES = [
  { id: 'tr-1', firstName: 'Ada', lastName: 'Lovelace' },
  { id: 'tr-2', firstName: 'Bob', lastName: 'Builder' },
];
// The roster of the whole tenant. The stub below filters it on ?role the way the endpoint does
// (TKT-0070), so the trainer checkboxes hold only EMPLOYEE rows if the form asked for them.
const USERS = [
  {
    id: 'u-admin', email: 'admin@x', firstName: 'Adam', lastName: 'Admin',
    role: 'ADMIN', isActive: true, tenantId: 't', createdAt: '', updatedAt: '', locations: [],
  },
  {
    id: 'emp-1', email: 'tina@x', firstName: 'Tina', lastName: 'Trainer',
    role: 'EMPLOYEE', isActive: true, tenantId: 't', createdAt: '', updatedAt: '', locations: [],
  },
  {
    id: 'emp-2', email: 'sam@x', firstName: 'Sam', lastName: 'Sub',
    role: 'EMPLOYEE', isActive: true, tenantId: 't', createdAt: '', updatedAt: '', locations: [],
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <EditClassPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('EditClassPage — roster management', () => {
  let patchBody: Record<string, unknown> | null = null;
let usersUrl: string | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    patchBody = null;
    usersUrl = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/classes/class-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
      }
      if (url.includes('/classes/class-1')) return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
      if (url.includes('/trainees')) return Promise.resolve(jsonResponse(200, paged(TRAINEES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged([])));
      if (url.includes('/users')) {
        usersUrl = url;
        const role = new URL(url, 'http://test.local').searchParams.get('role');
        const rows = role ? USERS.filter((u) => u.role === role) : USERS;
        return Promise.resolve(jsonResponse(200, paged(rows)));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TKT-0079 replaced the roster checkbox list with the searchable chips combobox. Intent is
  // unchanged: the enrolled trainee arrives selected, the other does not, and adding them sends
  // both ids. Only the control being driven is different.
  it('shows enrolled trainees and sends traineeIds on save', async () => {
    const { container } = renderPage();

    await waitFor(() => {
      const el = screen.queryByRole('button', { name: /Ada Lovelace/ });
      if (!el) throw new Error('roster chip not rendered');
    });
    // Enrolled per ClassDetail.trainees; the other trainee is not selected.
    expect(screen.queryByRole('button', { name: /Bob Builder/ })).toBeNull();

    fireEvent.focus(container.querySelector('#traineeIds')!);
    const tr2 = await waitFor(() => {
      const el = container.querySelector('#traineeIds-opt-tr-2');
      if (!el) throw new Error('candidate option not rendered');
      return el;
    });
    // Already-selected trainees are not offered again.
    expect(container.querySelector('#traineeIds-opt-tr-1')).toBeNull();

    fireEvent.mouseDown(tr2);
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect((patchBody!.traineeIds as string[]).slice().sort()).toEqual(['tr-1', 'tr-2']);
    });
  });

  // TKT-0112: the waitlist mode is an ordinary editable class field.
  it('shows the waitlist mode and sends the switched value', async () => {
    const { container } = renderPage();

    const select = await waitFor(() => {
      const el = container.querySelector<HTMLSelectElement>('#waitlistMode');
      if (!el) throw new Error('waitlistMode select not rendered');
      return el;
    });
    expect(select.value).toBe('NONE');

    fireEvent.change(select, { target: { value: 'CLAIM' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect(patchBody!.waitlistMode).toBe('CLAIM');
    });
  });

  // TKT-0113 interview decision: the form must say FIFO_AUTO can consume a card visit.
  it('states the consumes-a-visit contract only for FIFO_AUTO', async () => {
    const { container } = renderPage();
    const select = await waitFor(() => {
      const el = container.querySelector<HTMLSelectElement>('#waitlistMode');
      if (!el) throw new Error('waitlistMode select not rendered');
      return el;
    });

    expect(screen.queryByText(/посещение от карта/)).toBeNull();
    fireEvent.change(select, { target: { value: 'FIFO_AUTO' } });
    expect(screen.getByText(/посещение от карта/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'CLAIM' } });
    expect(screen.queryByText(/посещение от карта/)).toBeNull();
  });

  // TKT-0078 replaced the trainer checkbox list with the searchable chips combobox. The asserted
  // intent is unchanged — only EMPLOYEE rows are offered, current trainers arrive selected, and
  // adding one sends both ids — so only the control being driven is different.
  it('offers only EMPLOYEE users as trainers, shows current ones, and sends trainerIds', async () => {
    const { container } = renderPage();

    // Current trainer arrives as a chip, from ClassDetail.trainers rather than from a search.
    const chip = await waitFor(() => {
      const el = screen.queryByRole('button', { name: /Tina Trainer/ });
      if (!el) throw new Error('trainer chip not rendered');
      return el;
    });
    expect(chip).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sam Sub/ })).toBeNull();

    fireEvent.focus(container.querySelector('#trainerIds')!);

    const sam = await waitFor(() => {
      const el = container.querySelector('#trainerIds-opt-emp-2');
      if (!el) throw new Error('trainer option not rendered');
      return el;
    });
    // ADMIN-role users must not be offered as trainers. The stub honours ?role, so this still
    // fails if the form stops asking the server and filters in the browser instead.
    expect(container.querySelector('#trainerIds-opt-u-admin')).toBeNull();
    expect(usersUrl).toContain('role=EMPLOYEE');
    // Already-selected trainers are not offered a second time.
    expect(container.querySelector('#trainerIds-opt-emp-1')).toBeNull();

    fireEvent.mouseDown(sam);
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect((patchBody!.trainerIds as string[]).slice().sort()).toEqual(['emp-1', 'emp-2']);
    });
  });

  // New in TKT-0078: the picker asks the server for one small page instead of paging the table.
  it('asks the server for a bounded page of trainers, and passes the typed query through', async () => {
    const { container } = renderPage();
    await waitFor(() => {
      const el = screen.queryByRole('button', { name: /Tina Trainer/ });
      if (!el) throw new Error('trainer chip not rendered');
    });

    fireEvent.focus(container.querySelector('#trainerIds')!);
    await waitFor(() => {
      if (!container.querySelector('#trainerIds-opt-emp-2')) throw new Error('no options');
    });
    expect(usersUrl).toContain('pageSize=10');
    expect(usersUrl).not.toContain('search=');

    fireEvent.change(container.querySelector('#trainerIds')!, { target: { value: 'Сам' } });
    await waitFor(() => expect(usersUrl).toContain('search=%D0%A1%D0%B0%D0%BC'), { timeout: 2000 });
  });

  // The class price was the amount rule's last divergent copy: it accepted a third decimal place
  // and any magnitude — both 400s at the API — and turned unparseable input into an omitted field,
  // so a cleared price saved as "leave it alone" instead of reporting anything.
  async function priceInput(): Promise<HTMLInputElement> {
    const { container } = renderPage();
    return waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#sessionPrice');
      if (!el) throw new Error('price input not rendered');
      return el;
    });
  }

  it.each(['', '0', '-5', '1.234', '2000000'])('blocks save for sessionPrice %s', async (raw) => {
    const price = await priceInput();
    fireEvent.change(price, { target: { value: raw } });
    fireEvent.click(document.querySelector('button[type="submit"]')!);

    expect(await screen.findByText(/Сумата трябва|Amount must/)).toBeInTheDocument();
    expect(patchBody).toBeNull();
  });

  it('saves a sub-1 price as a number', async () => {
    const price = await priceInput();
    fireEvent.change(price, { target: { value: '0.5' } });
    fireEvent.click(document.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect(patchBody!.sessionPrice).toBe(0.5);
    });
    // TKT-0092: edit stays put and confirms with a toast.
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  // TKT-0090: a failed field says what is wrong in words, wired for assistive tech.
  it('says what is wrong and wires the a11y attributes when the name is cleared', async () => {
    renderPage();
    const name = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('#name');
      if (!el || !el.value) throw new Error('not prefilled yet');
      return el;
    });

    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(document.querySelector('button[type="submit"]')!);

    const message = await screen.findByText('Това поле е задължително.');
    expect(message).toHaveAttribute('role', 'alert');
    expect(message).toHaveAttribute('id', 'name-error');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'name-error');
    expect(patchBody).toBeNull();
  });

  // TKT-0109 — the third billing mode. The mode select renders on edit too (the switch is
  // allowed since PRD-0015), and choosing PER_COURSE swaps in its date + price inputs.
  describe('course mode (TKT-0109)', () => {
    async function switchToCourse(container: HTMLElement) {
      const select = await waitFor(() => {
        const el = container.querySelector<HTMLSelectElement>('#billingMode');
        if (!el) throw new Error('billing mode select not rendered on edit');
        return el;
      });
      fireEvent.change(select, { target: { value: 'PER_COURSE' } });
      return waitFor(() => {
        const price = container.querySelector<HTMLInputElement>('#coursePrice');
        const start = container.querySelector<HTMLInputElement>('#courseStart');
        const end = container.querySelector<HTMLInputElement>('#courseEnd');
        if (!price || !start || !end) throw new Error('course inputs not rendered');
        return { price, start, end };
      });
    }

    it('switches to PER_COURSE and submits the mode with its three fields', async () => {
      const { container } = renderPage();
      const { price, start, end } = await switchToCourse(container);

      fireEvent.change(price, { target: { value: '300' } });
      fireEvent.change(start, { target: { value: '2026-03-01' } });
      fireEvent.change(end, { target: { value: '2026-08-31' } });
      fireEvent.click(container.querySelector('button[type="submit"]')!);

      await waitFor(() => {
        expect(patchBody).not.toBeNull();
        expect(patchBody).toMatchObject({
          billingMode: 'PER_COURSE',
          coursePrice: 300,
          courseStart: '2026-03-01',
          courseEnd: '2026-08-31',
        });
        // Only the active mode's price fields travel; the server clears the rest.
        expect(patchBody!.sessionPrice).toBeUndefined();
        expect(patchBody!.monthlyAmount).toBeUndefined();
      });
    });

    it('blocks save when the course end is not after its start', async () => {
      const { container } = renderPage();
      const { price, start, end } = await switchToCourse(container);

      fireEvent.change(price, { target: { value: '300' } });
      fireEvent.change(start, { target: { value: '2026-08-31' } });
      fireEvent.change(end, { target: { value: '2026-03-01' } });
      fireEvent.click(container.querySelector('button[type="submit"]')!);

      expect(await screen.findByText(/Краят на курса|Course end/)).toBeInTheDocument();
      expect(patchBody).toBeNull();
    });

    it('blocks save when the course price is missing', async () => {
      const { container } = renderPage();
      const { start, end } = await switchToCourse(container);

      fireEvent.change(start, { target: { value: '2026-03-01' } });
      fireEvent.change(end, { target: { value: '2026-08-31' } });
      fireEvent.click(container.querySelector('button[type="submit"]')!);

      expect(await screen.findByText(/Сумата трябва|Amount must/)).toBeInTheDocument();
      expect(patchBody).toBeNull();
    });
  });
});
