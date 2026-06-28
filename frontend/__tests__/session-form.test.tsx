import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import EditSessionPage from '@/app/(dashboard)/sessions/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { writeStoredTokens } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'session-1' }),
  usePathname: () => '/sessions/session-1/edit',
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

const SESSION_DETAIL = {
  id: 'session-1',
  tenantId: 't',
  classId: 'c',
  locationId: 'loc-1',
  startsAt: '2026-06-01T18:00:00.000Z',
  endsAt: '2026-06-01T19:00:00.000Z',
  status: 'SCHEDULED',
  notes: null,
  createdAt: '',
  updatedAt: '',
  class: { id: 'c', name: 'Yoga 101', billingMode: 'PER_SESSION' },
  location: { id: 'loc-1', name: 'Studio A' },
  // emp-1 is the session's current trainer; emp-2 is a substitute we'll add.
  trainers: [{ id: 'emp-1', firstName: 'Tina', lastName: 'Trainer', email: 'tina@x' }],
};

const LOCATIONS = [
  { id: 'loc-1', tenantId: 't', name: 'Studio A', address: null, isActive: true, createdAt: '', updatedAt: '' },
];

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
      <AuthProvider>
        <EditSessionPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('EditSessionPage — trainer assignment', () => {
  let patchBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    writeStoredTokens({
      accessToken: buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }),
      refreshToken: 'R',
    });
    replace.mockClear();
    patchBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/sessions/session-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, SESSION_DETAIL));
      }
      if (url.includes('/sessions/session-1')) return Promise.resolve(jsonResponse(200, SESSION_DETAIL));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, LOCATIONS));
      if (url.includes('/users')) return Promise.resolve(jsonResponse(200, USERS));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists only EMPLOYEE users, pre-checks current trainers, and sends trainerIds on save', async () => {
    const { container } = renderPage();

    const emp1 = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('input[value="emp-1"]');
      if (!el) throw new Error('trainer checkbox not rendered');
      return el;
    });
    const emp2 = container.querySelector<HTMLInputElement>('input[value="emp-2"]')!;
    // ADMIN users are never offered as trainers.
    expect(container.querySelector('input[value="u-admin"]')).toBeNull();
    expect(emp1.checked).toBe(true); // prefilled from SessionDetail.trainers
    expect(emp2.checked).toBe(false);

    fireEvent.click(emp2); // add a substitute
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect((patchBody!.trainerIds as string[]).slice().sort()).toEqual(['emp-1', 'emp-2']);
    });
  });
});
