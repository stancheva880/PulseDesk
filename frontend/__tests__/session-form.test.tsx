import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditSessionPage from '@/app/(dashboard)/sessions/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

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

function paged<T>(items: T[]): unknown {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
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
      if (url.includes('/sessions/session-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, SESSION_DETAIL));
      }
      if (url.includes('/sessions/session-1')) return Promise.resolve(jsonResponse(200, SESSION_DETAIL));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
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

  // TKT-0082 replaced the trainer checkbox list with the searchable chips combobox, the same
  // control the class form uses. Asserted intent is unchanged: only EMPLOYEE rows are offered,
  // the current trainer is prefilled, and adding a substitute sends both ids.
  it('offers only EMPLOYEE users, prefills current trainers, and sends trainerIds on save', async () => {
    const { container } = renderPage();

    // Prefilled from SessionDetail.trainers, as a chip rather than from a search.
    await waitFor(() => {
      const el = screen.queryByRole('button', { name: /Tina Trainer/ });
      if (!el) throw new Error('trainer chip not rendered');
    });
    expect(screen.queryByRole('button', { name: /Sam Sub/ })).toBeNull();

    fireEvent.focus(container.querySelector('#trainerIds')!);
    const emp2 = await waitFor(() => {
      const el = container.querySelector('#trainerIds-opt-emp-2');
      if (!el) throw new Error('trainer option not rendered');
      return el;
    });
    // ADMIN users are never offered as trainers. The stub honours ?role, so this still fails if
    // the form stops asking the server for one (TKT-0070).
    expect(container.querySelector('#trainerIds-opt-u-admin')).toBeNull();
    expect(usersUrl).toContain('role=EMPLOYEE');
    // The prefilled trainer is not offered a second time.
    expect(container.querySelector('#trainerIds-opt-emp-1')).toBeNull();

    fireEvent.mouseDown(emp2); // add a substitute
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect((patchBody!.trainerIds as string[]).slice().sort()).toEqual(['emp-1', 'emp-2']);
    });
  });

  // TKT-0016: date-time fields are native datetime-local inputs; payload stays ISO.
  it('renders native datetime-local inputs and submits ISO timestamps', async () => {
    const { container } = renderPage();

    const startsAt = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#startsAt');
      if (!el || !el.value) throw new Error('not prefilled yet');
      return el;
    });
    expect(startsAt.type).toBe('datetime-local');
    expect(container.querySelector<HTMLInputElement>('#endsAt')!.type).toBe('datetime-local');

    fireEvent.change(container.querySelector('#endsAt')!, {
      target: { value: '2026-06-01T21:30' },
    });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      // localToIso output — a full ISO-8601 UTC string, not the raw local value.
      expect(patchBody!.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(patchBody!.endsAt as string).getTime()).toBe(
        new Date('2026-06-01T21:30').getTime(),
      );
    });
  });
});
