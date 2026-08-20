import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserForm } from '@/app/(dashboard)/users/user-form';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

// TKT-0083: the phone number is optional and free text. Two things worth a test — an empty
// field must not post an empty string (the backend would store "" rather than null), and an
// existing value must survive the edit round trip.

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

const EXISTING_USER = {
  id: 'u-1',
  email: 'trainer@example.com',
  firstName: 'Иван',
  lastName: 'Георгиев',
  phone: '0888 111 222',
  role: 'EMPLOYEE',
  tenantId: 't',
  isActive: true,
  status: 'ACTIVE',
  locations: [{ id: 'loc-1', name: 'Central Hall' }],
  createdAt: '',
  updatedAt: '',
};

function bodyOf(method: string): string | undefined {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === method);
  return call ? String((call[1] as RequestInit).body) : undefined;
}

describe('UserForm — the phone field', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'SUPER_ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, LOCATIONS));
      if (url.includes('/users/u-1') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, EXISTING_USER));
      }
      if (method === 'PATCH') return Promise.resolve(jsonResponse(200, EXISTING_USER));
      return Promise.resolve(jsonResponse(201, { id: 'new', attachedExisting: false }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
  });

  it('posts a phone number entered on create', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="create" />
        </AuthProvider>
      </I18nProvider>,
    );

    await user.type(await screen.findByLabelText(/Имейл|Email/), 'new@example.com');
    await user.selectOptions(screen.getByLabelText(/Роля|Role/), 'CUSTOMER');
    await user.type(screen.getByLabelText(/Телефон|Phone/), '+359 88 123 4567');
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const body = await vi.waitFor(() => {
      const b = bodyOf('POST');
      expect(b).toBeDefined();
      return b!;
    });
    expect(JSON.parse(body).phone).toBe('+359 88 123 4567');
  });

  it('omits the key entirely when the field is left empty', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="create" />
        </AuthProvider>
      </I18nProvider>,
    );

    await user.type(await screen.findByLabelText(/Имейл|Email/), 'new@example.com');
    await user.selectOptions(screen.getByLabelText(/Роля|Role/), 'CUSTOMER');
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const body = await vi.waitFor(() => {
      const b = bodyOf('POST');
      expect(b).toBeDefined();
      return b!;
    });
    expect(Object.keys(JSON.parse(body))).not.toContain('phone');
  });

  it('loads an existing phone into the edit form and sends it back unchanged', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="edit" id="u-1" />
        </AuthProvider>
      </I18nProvider>,
    );

    const field = await screen.findByLabelText(/Телефон|Phone/);
    expect(field).toHaveValue('0888 111 222');

    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const body = await vi.waitFor(() => {
      const b = bodyOf('PATCH');
      expect(b).toBeDefined();
      return b!;
    });
    expect(JSON.parse(body).phone).toBe('0888 111 222');
  });

  it('clears a phone number with null when the field is emptied', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <AuthProvider>
          <UserForm mode="edit" id="u-1" />
        </AuthProvider>
      </I18nProvider>,
    );

    const field = await screen.findByLabelText(/Телефон|Phone/);
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const body = await vi.waitFor(() => {
      const b = bodyOf('PATCH');
      expect(b).toBeDefined();
      return b!;
    });
    expect(JSON.parse(body).phone).toBeNull();
  });
});
