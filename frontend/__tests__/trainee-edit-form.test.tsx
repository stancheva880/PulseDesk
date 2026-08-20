import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditTraineePage from '@/app/(dashboard)/trainees/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 't-1' }),
  usePathname: () => '/trainees/t-1/edit',
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

const users = [
  { id: 'cust-1', email: 'petya@x.com', firstName: 'Petya', lastName: 'Parent', role: 'CUSTOMER' },
  { id: 'cust-2', email: 'georgi@x.com', firstName: 'Georgi', lastName: 'Guardian', role: 'CUSTOMER' },
  { id: 'adm-1', email: 'ana@x.com', firstName: 'Ana', lastName: 'Admin', role: 'ADMIN' },
];

const detail = {
  id: 't-1',
  tenantId: 't',
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-01-01T00:00:00.000Z',
  phone: null,
  email: null,
  notes: null,
  isActive: true,
  userId: 'cust-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  contacts: [],
  locations: [],
  classes: [],
  guardians: [{ id: 'cust-2', firstName: 'Georgi', lastName: 'Guardian', email: 'georgi@x.com' }],
  user: { id: 'cust-1', email: 'petya@x.com' },
};

describe('EditTraineePage — customer linking (TKT-0009)', () => {
  let patchedBody: Record<string, unknown> | null = null;
  let usersUrl: string | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    patchedBody = null;
    usersUrl = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/users')) {
        usersUrl = url;
        // Filters on ?role as the endpoint does (TKT-0070). The edit branch is its own call site,
        // so it gets its own assertion.
        const role = new URL(url, 'http://test.local').searchParams.get('role');
        const rows = role ? users.filter((u) => u.role === role) : users;
        return Promise.resolve(jsonResponse(200, paged(rows)));
      }
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged([])));
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged([])));
      if (url.includes('/trainees/t-1')) {
        if (init?.method === 'PATCH') {
          patchedBody = init.body ? JSON.parse(init.body as string) : null;
          return Promise.resolve(jsonResponse(200, { ...detail, user: null, userId: null }));
        }
        return Promise.resolve(jsonResponse(200, detail));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderForm() {
    return render(
      <I18nProvider>
        <AuthProvider>
          <EditTraineePage />
        </AuthProvider>
      </I18nProvider>,
    );
  }

  it('prefills linked account and guardians from the trainee detail', async () => {
    renderForm();
    const select = await screen.findByLabelText<HTMLSelectElement>(
      /Linked customer account|Свързан клиентски акаунт/,
    );
    await vi.waitFor(() => {
      expect(select.value).toBe('cust-1');
    });
    // TKT-0080: guardians are a chips field now. The prefilled guardian arrives as a chip, from
    // the trainee detail rather than from a search; a non-CUSTOMER never appears at all.
    expect(screen.getByRole('button', { name: /Georgi Guardian/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana Admin/ })).not.toBeInTheDocument();
    expect(usersUrl).toContain('role=CUSTOMER');
  });

  it('sends userId null after clearing the linked account', async () => {
    const user = userEvent.setup();
    renderForm();
    const select = await screen.findByLabelText<HTMLSelectElement>(
      /Linked customer account|Свързан клиентски акаунт/,
    );
    await vi.waitFor(() => {
      expect(select.value).toBe('cust-1');
    });
    await user.selectOptions(select, '');
    await user.click(screen.getByRole('button', { name: /^Save$|^Запазване$/ }));
    await vi.waitFor(() => {
      expect(patchedBody).toMatchObject({ userId: null, guardianUserIds: ['cust-2'] });
    });
  });
});
