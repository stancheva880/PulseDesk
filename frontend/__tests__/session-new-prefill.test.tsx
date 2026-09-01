import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewSessionPage from '@/app/(dashboard)/sessions/new/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
// TKT-0091: switchable per test — the page reads ?classId= via useSearchParams.
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sessions/new',
  useSearchParams: () => new URLSearchParams(search),
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

const CLASSES = [
  { id: 'c1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true },
  { id: 'c2', tenantId: 't', name: 'Judo', billingMode: 'PER_SESSION', isActive: true },
];
const LOCATIONS = [
  { id: 'loc-1', tenantId: 't', name: 'Main Hall', address: null, isActive: true },
];
// ClassDetail (GET /classes/:id), distinct from the ClassRow list shape above — the trainer
// picker's create-mode default is fetched per selection via Classes.get(classId).
const CLASS_DETAILS: Record<string, unknown> = {
  c1: {
    ...CLASSES[0],
    description: null,
    monthlyAmount: '80',
    sessionPrice: null,
    capacity: null,
    waitlistMode: 'NONE',
    allowSelfBooking: false,
    bookingCutoffMin: null,
    locations: [],
    trainees: [],
    trainers: [{ id: 'tr-1', firstName: 'Tina', lastName: 'Trainer', email: 'tina@x' }],
  },
  c2: {
    ...CLASSES[1],
    description: null,
    monthlyAmount: null,
    sessionPrice: '10',
    capacity: null,
    waitlistMode: 'NONE',
    allowSelfBooking: false,
    bookingCutoffMin: null,
    locations: [],
    trainees: [],
    trainers: [],
  },
};
const USERS = [
  {
    id: 'tr-1', email: 'tina@x', firstName: 'Tina', lastName: 'Trainer',
    role: 'EMPLOYEE', isActive: true, tenantId: 't', createdAt: '', updatedAt: '', locations: [],
  },
  {
    id: 'tr-2', email: 'sam@x', firstName: 'Sam', lastName: 'Sub',
    role: 'EMPLOYEE', isActive: true, tenantId: 't', createdAt: '', updatedAt: '', locations: [],
  },
];

function renderPage() {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>
        <NewSessionPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('NewSessionPage — ?classId= prefill', () => {
  let postBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    search = '';
    postBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/sessions') && method === 'POST') {
        postBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(201, { id: 's1' }));
      }
      // /classes/:id (ClassDetail, incl. trainers) before the bare list — both contain
      // "/classes", and the id-bearing one is the more specific match.
      const detailId = /\/classes\/([^/?]+)/.exec(url)?.[1];
      if (detailId) {
        const detail = CLASS_DETAILS[detailId];
        return Promise.resolve(detail ? jsonResponse(200, detail) : jsonResponse(404, null));
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      if (url.includes('/users')) return Promise.resolve(jsonResponse(200, paged(USERS)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preselects the class from ?classId= and keeps the field editable', async () => {
    search = 'classId=c1';
    const { container } = renderPage();

    const select = await waitFor(() => {
      const el = container.querySelector<HTMLSelectElement>('#classId');
      if (!el || el.value !== 'c1') throw new Error('not prefilled yet');
      return el;
    });

    // A prefill is a starting point, never a lock.
    fireEvent.change(select, { target: { value: 'c2' } });
    expect(select.value).toBe('c2');
  });

  it('leaves nothing selected for a classId that is not in the list', async () => {
    search = 'classId=bogus';
    const { container } = renderPage();

    await waitFor(() => {
      if (!container.querySelector('option[value="c1"]')) throw new Error('lookups not loaded');
    });
    expect(container.querySelector<HTMLSelectElement>('#classId')!.value).toBe('');
    expect(container.querySelector('.text-destructive')).toBeNull();
  });

  it('submitted unchanged, the created session references the class from the parameter', async () => {
    search = 'classId=c1';
    const { container } = renderPage();

    await waitFor(() => {
      const el = container.querySelector<HTMLSelectElement>('#classId');
      if (!el || el.value !== 'c1') throw new Error('not prefilled yet');
    });
    fireEvent.change(container.querySelector('#locationId')!, { target: { value: 'loc-1' } });
    fireEvent.change(container.querySelector('#startsAt')!, { target: { value: '2026-06-01T18:00' } });
    fireEvent.change(container.querySelector('#endsAt')!, { target: { value: '2026-06-01T19:00' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect(postBody).toMatchObject({ classId: 'c1', locationId: 'loc-1' });
    });

    // TKT-0092: the save stays on the form, confirms with a toast, and the reset preserves the
    // query-parameter parent while clearing everything the user typed.
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector<HTMLSelectElement>('#classId')!.value).toBe('c1');
      expect(container.querySelector<HTMLSelectElement>('#locationId')!.value).toBe('');
      expect(container.querySelector<HTMLInputElement>('#startsAt')!.value).toBe('');
    });
  });

  // The class's own trainer roster is the starting point for a new session — visible before
  // save, not only discoverable by reopening it afterward (sessions.service.ts already applies
  // this default server-side when trainerIds is omitted; this is what makes it visible).
  it('pre-fills the trainer chips with the selected class\'s current trainers', async () => {
    search = 'classId=c1';
    renderPage();

    expect(await screen.findByRole('button', { name: /Tina Trainer/ })).toBeInTheDocument();
  });

  it('clears the trainer chips when the class selection is cleared', async () => {
    search = 'classId=c1';
    const { container } = renderPage();
    await screen.findByRole('button', { name: /Tina Trainer/ });

    fireEvent.change(container.querySelector('#classId')!, { target: { value: '' } });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Tina Trainer/ })).not.toBeInTheDocument();
    });
  });

  // Overriding the default for one session must never touch the class's own roster — this
  // only asserts what gets submitted, which is the whole contract from the session's side.
  it('lets the pre-filled trainer be swapped, and submits the override, not the class default', async () => {
    search = 'classId=c1';
    const { container } = renderPage();
    await screen.findByRole('button', { name: /Tina Trainer/ });

    // Swap: remove the class's default trainer, add a substitute instead.
    fireEvent.click(screen.getByRole('button', { name: /Tina Trainer/ }));
    fireEvent.focus(container.querySelector('#trainerIds')!);
    const sam = await waitFor(() => {
      const el = container.querySelector('#trainerIds-opt-tr-2');
      if (!el) throw new Error('trainer option not rendered');
      return el;
    });
    fireEvent.mouseDown(sam);

    fireEvent.change(container.querySelector('#locationId')!, { target: { value: 'loc-1' } });
    fireEvent.change(container.querySelector('#startsAt')!, { target: { value: '2026-06-01T18:00' } });
    fireEvent.change(container.querySelector('#endsAt')!, { target: { value: '2026-06-01T19:00' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect(postBody!.trainerIds).toEqual(['tr-2']);
    });
  });
});
