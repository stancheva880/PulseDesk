import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/auth-storage';
import { render, screen } from '@testing-library/react';
import UsersListPage from '@/app/(dashboard)/users/page';
import NewUserPage from '@/app/(dashboard)/users/new/page';
import EditUserPage from '@/app/(dashboard)/users/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import bg from '@/locales/bg/common.json';
import en from '@/locales/en/common.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'u2' }),
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(''),
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

const EMPLOYEE_ROW = {
  id: 'u2',
  email: 'emp@demo.local',
  firstName: 'Emma',
  lastName: 'Petrova',
  role: 'EMPLOYEE',
  isActive: true,
  status: 'ACTIVE',
  tenantId: 't1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  locations: [],
};

const EMPTY_PAGE = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };

function seedAdminSession() {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(
    buildJwt({ sub: 'u1', email: 'admin@demo.local', role: 'ADMIN', tenantId: 't1', exp }),
  );
  window.localStorage.setItem(
    'pulsedesk.memberships',
    JSON.stringify([{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]),
  );
  window.localStorage.setItem('pulsedesk.tenantContext', 't1');
}

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/auth/memberships')) {
      return jsonResponse(200, [{ tenantId: 't1', tenantName: 'Club One', role: 'ADMIN' }]);
    }
    if (u.includes('/users/u2')) return jsonResponse(200, EMPLOYEE_ROW);
    if (u.includes('/locations')) return jsonResponse(200, EMPTY_PAGE);
    return jsonResponse(200, { ...EMPTY_PAGE, items: [EMPLOYEE_ROW], total: 1, totalPages: 1 });
  });
}

function renderWithProviders(page: React.ReactNode) {
  return render(
    <I18nProvider>
      <AuthProvider>{page}</AuthProvider>
    </I18nProvider>,
  );
}

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? collectKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('Users pages — Bulgarian locale', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bg and en users sections have identical, complete key sets', () => {
    const bgKeys = collectKeys(bg.users).sort();
    const enKeys = collectKeys(en.users).sort();
    expect(bgKeys).toEqual(enKeys);
    for (const key of [
      'title',
      'subtitle',
      'new',
      'empty',
      'edit',
      'formTitle',
      'attachedExisting',
      'deleteConfirm',
      'removeConfirm.title',
      'removeConfirm.description',
      'removeConfirm.confirm',
      'fields.email',
      'fields.name',
      'fields.passwordOptional',
      'fields.firstName',
      'fields.lastName',
      'fields.role',
      'fields.locations',
      'fields.status',
      'fields.active',
    ]) {
      expect(bgKeys, `missing users.${key}`).toContain(key);
    }
    // TKT-0081 (approved TEST CHANGE REQUEST): the Ctrl/Cmd hint went with the native
    // multi-select it explained. Asserting its absence in BOTH bundles is stricter than the
    // presence check it replaces — a hint returning in one language only now fails here.
    expect(collectKeys(bg.users)).not.toContain('fields.locationsHint');
    expect(collectKeys(en.users)).not.toContain('fields.locationsHint');
    // TKT-0123 (approved TEST CHANGE REQUEST): `fields.password` was the admin-typed password on
    // the create form, which TKT-0058's invite flow removed — `fields.passwordOptional` above is
    // the surviving key and the only one any screen reads. Same pattern as the hint: asserting
    // absence in BOTH bundles is stricter than the presence row it replaces, so a key returning in
    // one language only fails here.
    expect(collectKeys(bg.users)).not.toContain('fields.password');
    expect(collectKeys(en.users)).not.toContain('fields.password');
  });

  it('list page renders in Bulgarian with no English fallbacks', async () => {
    seedAdminSession();
    mockApi();

    renderWithProviders(<UsersListPage />);
    expect(await screen.findByText('Потребители')).toBeInTheDocument();
    expect(screen.getByText(/Управлявайте членовете/)).toBeInTheDocument();
    expect(await screen.findByText('Имейл')).toBeInTheDocument();
    // Role badge translated, not the raw enum.
    expect(await screen.findByText('Служител')).toBeInTheDocument();
    expect(screen.queryByText('EMPLOYEE')).toBeNull();
    expect(screen.queryByText(/Manage members|No users yet|New user/)).toBeNull();
  });

  it('new-user form renders in Bulgarian', async () => {
    seedAdminSession();
    mockApi();

    renderWithProviders(<NewUserPage />);
    expect(await screen.findByText('Данни за потребителя')).toBeInTheDocument();
    // TKT-0058 (approved TEST CHANGE REQUEST): create no longer takes a password — the
    // invited person sets their own. Asserting the inverse guards the field creeping back.
    expect(screen.queryByText('Парола')).toBeNull();
    // TKT-0081 (approved TEST CHANGE REQUEST): the chips picker needs no Ctrl/Cmd instruction.
    // Asserting the inverse guards the hint creeping back, as the password case above does.
    expect(screen.queryByText(/Задръжте Ctrl\/Cmd/)).toBeNull();
    expect(screen.queryByText(/User details|Hold Ctrl/)).toBeNull();
  });

  it('edit form renders in Bulgarian', async () => {
    seedAdminSession();
    mockApi();

    renderWithProviders(<EditUserPage />);
    expect(await screen.findByText('Редактиране на потребител')).toBeInTheDocument();
    expect(await screen.findByText(/Нова парола/)).toBeInTheDocument();
    expect(screen.getByText('Собствено име')).toBeInTheDocument();
    expect(screen.queryByText(/Edit user|leave blank to keep/)).toBeNull();
  });
});
