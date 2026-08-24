import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserForm } from '@/app/(dashboard)/users/user-form';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

// TKT-0092: create no longer navigates, so the ?attached=1 banner on the users list is gone —
// the attach outcome (and every plain save) is confirmed by a toast at the moment of creation.
// Replaces users-attach-banner.test.tsx (approved TEST CHANGE REQUEST).

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
  items: [],
  page: 1,
  pageSize: 100,
  total: 0,
  totalPages: 0,
};

function mockApi(attachedExisting: boolean) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, LOCATIONS));
    if (method === 'POST') {
      return Promise.resolve(jsonResponse(201, { id: 'new', attachedExisting }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
}

function renderForm() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <UserForm mode="create" />
      </AuthProvider>
    </I18nProvider>,
  );
}

async function createCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Имейл|Email/), 'new@example.com');
  await user.selectOptions(screen.getByLabelText(/Роля|Role/), 'CUSTOMER');
  await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));
}

describe('UserForm — save confirmations (TKT-0092)', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
  });

  it('confirms a plain create with a toast, stays put, and resets the form', async () => {
    mockApi(false);
    const user = userEvent.setup();
    renderForm();

    await createCustomer(user);

    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(/Имейл|Email/).value).toBe('');
    });
  });

  it('reports an attached existing account as a toast, in place of the old banner', async () => {
    mockApi(true);
    const user = userEvent.setup();
    renderForm();

    await createCustomer(user);

    expect(
      await screen.findByText(/password is unchanged|паролата им остава/i),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
