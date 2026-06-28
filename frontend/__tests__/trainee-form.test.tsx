import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTraineePage from '@/app/(dashboard)/trainees/new/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { writeStoredTokens } from '@/lib/auth-storage';

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

function renderForm() {
  return render(
    <I18nProvider>
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
    writeStoredTokens({
      accessToken: buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }),
      refreshToken: 'R',
    });
    replace.mockClear();
    createdBody = null;
    // The page fetches /locations and /classes on mount; capture the create POST body.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, []));
      if (url.includes('/classes')) {
        return Promise.resolve(jsonResponse(200, [{ id: 'cls-1', name: 'Yoga' }]));
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

  it('enrolls the trainee in the selected class on submit', async () => {
    const user = userEvent.setup();
    renderForm();

    // The Classes field is populated from GET /classes; ticking a class sends its id.
    const classBox = await screen.findByLabelText('Yoga');
    await user.type(await screen.findByLabelText(/First name|^Име$/), 'Ada');
    await user.type(screen.getByLabelText(/Last name|Фамилия/), 'Lovelace');
    // Adult DOB so the under-18 contact rule does not block submission.
    await user.type(screen.getByLabelText(/Date of birth|Дата на раждане/), '1990-01-01');
    await user.click(classBox);
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));

    await vi.waitFor(() => {
      expect(createdBody).toMatchObject({ classIds: ['cls-1'] });
    });
  });
});
