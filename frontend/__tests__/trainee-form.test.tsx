import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTraineePage from '@/app/(dashboard)/trainees/new/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/trainees/new',
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

function renderForm() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <NewTraineePage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('NewTraineePage — dynamic guardian-contacts section (PRD)', () => {
  let createdBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    // Authenticate so the form mounts — the dashboard layout normally enforces this.
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    createdBody = null;
    // The page fetches /locations and /classes on mount; capture the create POST body.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged([])));
      if (url.includes('/classes')) {
        return Promise.resolve(jsonResponse(200, paged([{ id: 'cls-1', name: 'Yoga' }])));
      }
      if (url.includes('/trainees')) {
        createdBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(201, { id: 't-1' }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the contacts section when DOB is empty', async () => {
    renderForm();
    await screen.findByLabelText(/Date of birth|Дата на раждане/);
    expect(screen.queryByText(/Guardian contacts|настойника/)).not.toBeInTheDocument();
  });

  it('hides the contacts section when DOB is for an adult', async () => {
    const user = userEvent.setup();
    renderForm();
    const dob = await screen.findByLabelText(/Date of birth|Дата на раждане/);
    await user.type(dob, '2000-01-01');
    expect(screen.queryByText(/Guardian contacts|настойника/)).not.toBeInTheDocument();
  });

  it('shows the contacts section the moment DOB makes the trainee a minor', async () => {
    const user = userEvent.setup();
    renderForm();
    const dob = await screen.findByLabelText(/Date of birth|Дата на раждане/);
    const future = new Date();
    future.setFullYear(future.getFullYear() - 10);
    await user.type(dob, future.toISOString().slice(0, 10));
    expect(await screen.findByText(/Guardian contacts|настойника/)).toBeInTheDocument();
  });

  // TKT-0090: a future date of birth is rejected — the input caps at today and the schema
  // refuses a typed future date before any request is sent.
  it('rejects a future date of birth and caps the input at today', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(await screen.findByLabelText(/First name|^Име$/), 'Kid');
    await user.type(screen.getByLabelText(/Last name|Фамилия/), 'Smith');
    const dob = screen.getByLabelText(/Date of birth|Дата на раждане/);
    // Local date, computed as the component computes it — UTC would flake near midnight.
    const now = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    expect(dob).toHaveAttribute(
      'max',
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    );

    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    // fireEvent, not user.type — a real date input blocks typing past max, jsdom does not.
    fireEvent.change(dob, { target: { value: future.toISOString().slice(0, 10) } });
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));

    const message = await screen.findByText(
      /Датата на раждане не може да е в бъдещето|cannot be in the future/,
    );
    expect(message).toHaveAttribute('role', 'alert');
    expect(message).toHaveAttribute('id', 'dateOfBirth-error');
    expect(dob).toHaveAttribute('aria-invalid', 'true');
    expect(dob).toHaveAttribute('aria-describedby', 'dateOfBirth-error');
    expect(createdBody).toBeNull();
  });

  // TKT-0090: a failed field says what is wrong in words, wired for assistive tech.
  it('says what is wrong and wires the a11y attributes when submitted empty', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByLabelText(/First name|^Име$/);

    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));

    const messages = await screen.findAllByText('Това поле е задължително.');
    expect(messages.length).toBeGreaterThanOrEqual(3); // first name, last name, DOB
    const firstName = screen.getByLabelText(/First name|^Име$/);
    expect(firstName).toHaveAttribute('aria-invalid', 'true');
    expect(firstName).toHaveAttribute('aria-describedby', 'firstName-error');
    const firstNameError = messages.find((m) => m.id === 'firstName-error');
    expect(firstNameError).toBeDefined();
    expect(firstNameError).toHaveAttribute('role', 'alert');
    expect(createdBody).toBeNull();
  });

  it('blocks submission for a minor with no contacts and surfaces the inline error', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(await screen.findByLabelText(/First name|^Име$/), 'Kid');
    await user.type(screen.getByLabelText(/Last name|Фамилия/), 'Smith');
    const dob = screen.getByLabelText(/Date of birth|Дата на раждане/);
    const minor = new Date();
    minor.setFullYear(minor.getFullYear() - 12);
    await user.type(dob, minor.toISOString().slice(0, 10));
    // The Save button is the first one (header has the New trainee button only on list page).
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));
    // Zod refinement triggers the alert with the "minor requires contact" message.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // TKT-0080 replaced the class checkbox list with the searchable chips combobox. Same intent:
  // the field is populated from GET /classes and selecting a class sends its id.
  it('enrolls the trainee in the selected class on submit', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();

    await user.type(await screen.findByLabelText(/First name|^Име$/), 'Ada');
    await user.type(screen.getByLabelText(/Last name|Фамилия/), 'Lovelace');
    // Adult DOB so the under-18 contact rule does not block submission.
    await user.type(screen.getByLabelText(/Date of birth|Дата на раждане/), '1990-01-01');
    fireEvent.focus(container.querySelector('#classIds')!);
    const classOption = await vi.waitFor(() => {
      const el = container.querySelector('#classIds-opt-cls-1');
      if (!el) throw new Error('class option not rendered');
      return el;
    });
    fireEvent.mouseDown(classOption);
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));

    await vi.waitFor(() => {
      expect(createdBody).toMatchObject({ classIds: ['cls-1'] });
    });
    // TKT-0092: create stays on the form, confirms with a toast, and resets.
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(/First name|^Име$/).value).toBe('');
    });
  });
});

describe('NewTraineePage — customer linking (TKT-0009)', () => {
  let createdBody: Record<string, unknown> | null = null;
  let createResponse: Response | null = null;
  let usersUrl: string | null = null;

  const users = [
    { id: 'cust-1', email: 'petya@x.com', firstName: 'Petya', lastName: 'Parent', role: 'CUSTOMER' },
    { id: 'cust-2', email: 'georgi@x.com', firstName: 'Georgi', lastName: 'Guardian', role: 'CUSTOMER' },
    { id: 'adm-1', email: 'ana@x.com', firstName: 'Ana', lastName: 'Admin', role: 'ADMIN' },
    { id: 'adm-1', email: 'ana@x.com', firstName: 'Ana', lastName: 'Admin', role: 'ADMIN' },
  ];

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    createdBody = null;
    createResponse = null;
    usersUrl = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/users')) {
        usersUrl = url;
        // Filters on ?role as the endpoint does (TKT-0070): an unfiltered request gets the admin.
        const role = new URL(url, 'http://test.local').searchParams.get('role');
        const rows = role ? users.filter((u) => u.role === role) : users;
        return Promise.resolve(jsonResponse(200, paged(rows)));
      }
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged([])));
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged([])));
      if (url.includes('/trainees')) {
        createdBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(createResponse ?? jsonResponse(201, { id: 't-1' }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fillRequired = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(await screen.findByLabelText(/First name|^Име$/), 'Ada');
    await user.type(screen.getByLabelText(/Last name|Фамилия/), 'Lovelace');
    await user.type(screen.getByLabelText(/Date of birth|Дата на раждане/), '1990-01-01');
  };

  it('shows linked-account select and guardians picker with only CUSTOMER users', async () => {
    const { container } = renderForm();
    const select = await screen.findByLabelText(/Linked customer account|Свързан клиентски акаунт/);
    expect(within(select).getByRole('option', { name: 'Petya Parent' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /Ana Admin/ })).not.toBeInTheDocument();

    // Guardians are now a searchable chips field (TKT-0080); the CUSTOMER-only rule is unchanged.
    fireEvent.focus(container.querySelector('#guardianUserIds')!);
    await vi.waitFor(() => {
      if (!container.querySelector('#guardianUserIds-opt-cust-2')) throw new Error('no options');
    });
    expect(container.querySelector('#guardianUserIds-opt-adm-1')).toBeNull();
    expect(usersUrl).toContain('role=CUSTOMER');
  });

  it('sends userId and guardianUserIds on create', async () => {
    const user = userEvent.setup();
    const { container } = renderForm();
    const select = await screen.findByLabelText(/Linked customer account|Свързан клиентски акаунт/);
    await fillRequired(user);
    await user.selectOptions(select, 'cust-1');
    fireEvent.focus(container.querySelector('#guardianUserIds')!);
    const guardian = await vi.waitFor(() => {
      const el = container.querySelector('#guardianUserIds-opt-cust-2');
      if (!el) throw new Error('guardian option not rendered');
      return el;
    });
    fireEvent.mouseDown(guardian);
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));
    await vi.waitFor(() => {
      expect(createdBody).toMatchObject({ userId: 'cust-1', guardianUserIds: ['cust-2'] });
    });
  });

  it('shows the conflict message when the API returns 409', async () => {
    createResponse = jsonResponse(409, {
      statusCode: 409,
      message: 'That user is already linked to another trainee',
    });
    const user = userEvent.setup();
    renderForm();
    const select = await screen.findByLabelText(/Linked customer account|Свързан клиентски акаунт/);
    await fillRequired(user);
    await user.selectOptions(select, 'cust-1');
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));
    expect(await screen.findByText(/already linked|вече е свързан/)).toBeInTheDocument();
    // Form stays editable — the save button is re-enabled after the failure.
    expect(screen.getByRole('button', { name: /^Save$|^Запазване$/ })).toBeEnabled();
  });
});
