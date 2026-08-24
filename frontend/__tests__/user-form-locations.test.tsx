import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserForm } from '@/app/(dashboard)/users/user-form';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

// TKT-0054: ADMIN and EMPLOYEE reads are filtered by their assigned locations, so the form
// refuses to submit either role without one — the backend rejects it too, and this saves the
// round trip.

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/users/new',
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const LOCATIONS = {
  items: [
    {
      id: 'loc-1',
      tenantId: 't',
      name: 'Central Hall',
      address: null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    },
  ],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};

describe('UserForm — the location requirement', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'SUPER_ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, LOCATIONS));
      return Promise.resolve(jsonResponse(201, { id: 'new', attachedExisting: false }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
  });

  async function fillAndSubmit(role: string) {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="create" />
        </AuthProvider>
      </I18nProvider>,
    );

    await user.type(await screen.findByLabelText(/Имейл|Email/), 'new@example.com');
    await user.selectOptions(screen.getByLabelText(/Роля|Role/), role);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));
    return user;
  }

  it('blocks an EMPLOYEE with no location and says why', async () => {
    await fillAndSubmit('EMPLOYEE');

    expect(await screen.findByText(/поне една локация|at least one location/i)).toBeInTheDocument();
    // Nothing was posted: the only calls are the location lookups.
    const posted = vi
      .mocked(globalThis.fetch)
      .mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posted).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('submits an EMPLOYEE once a location is picked', async () => {
    const user = await fillAndSubmit('EMPLOYEE');

    // TKT-0081: the same choice, made in the chips field instead of a native multi-select.
    fireEvent.focus(document.querySelector('#locationIds')!);
    const option = await vi.waitFor(() => {
      const el = document.querySelector('#locationIds-opt-loc-1');
      if (!el) throw new Error('location option not rendered');
      return el;
    });
    fireEvent.mouseDown(option);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const posted = await vi.waitFor(() =>
      vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    );
    expect(posted).toBeDefined();
    expect(String((posted![1] as RequestInit).body)).toContain('loc-1');
  });

  // TKT-0081: the native multi-select became the chips combobox. Locations are bounded, so the
  // list still arrives from one listAll — the component runs with no search endpoint behind it.
  it('renders locations as chips options and posts the picked id', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="create" />
        </AuthProvider>
      </I18nProvider>,
    );

    await user.type(await screen.findByLabelText(/Имейл|Email/), 'new@example.com');
    await user.selectOptions(screen.getByLabelText(/Роля|Role/), 'EMPLOYEE');

    expect(container.querySelector('select[multiple]')).toBeNull();
    fireEvent.focus(container.querySelector('#locationIds')!);
    const option = await vi.waitFor(() => {
      const el = container.querySelector('#locationIds-opt-loc-1');
      if (!el) throw new Error('location option not rendered');
      return el;
    });
    fireEvent.mouseDown(option);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const posted = await vi.waitFor(() => {
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      if (!call) throw new Error('nothing posted');
      return call;
    });
    expect(String((posted[1] as RequestInit).body)).toContain('loc-1');
  });

  // TKT-0090: a failed field says what is wrong in words, wired for assistive tech.
  it('says what is wrong on the email field with the a11y attributes wired', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="create" />
        </AuthProvider>
      </I18nProvider>,
    );

    await user.type(await screen.findByLabelText(/Имейл|Email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const message = await screen.findByText('Въведете валиден имейл адрес.');
    expect(message).toHaveAttribute('role', 'alert');
    expect(message).toHaveAttribute('id', 'email-error');
    const email = screen.getByLabelText(/Имейл|Email/);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', 'email-error');
  });

  it('adds no request: locations are still fetched once and nothing is searched', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="create" />
        </AuthProvider>
      </I18nProvider>,
    );

    await screen.findByLabelText(/Имейл|Email/);
    // Wait for the locations page to have landed before counting.
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(globalThis.fetch)
          .mock.calls.some(([input]) =>
            String(typeof input === 'string' ? input : (input as Request).url).includes('/locations'),
          ),
      ).toBe(true),
    );
    const before = vi.mocked(globalThis.fetch).mock.calls.length;

    fireEvent.focus(container.querySelector('#locationIds')!);
    await vi.waitFor(() => {
      if (!container.querySelector('#locationIds-opt-loc-1')) throw new Error('no options');
    });
    await user.type(container.querySelector('#locationIds')! as HTMLElement, 'Cent');
    await new Promise((r) => setTimeout(r, 500));

    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);
    const searched = vi
      .mocked(globalThis.fetch)
      .mock.calls.some(([input]) =>
        String(typeof input === 'string' ? input : (input as Request).url).includes('search='),
      );
    expect(searched).toBe(false);
  });

  it('lets a CUSTOMER through with no location', async () => {
    await fillAndSubmit('CUSTOMER');

    const posted = await vi.waitFor(() =>
      vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    );
    expect(posted).toBeDefined();
  });
});
