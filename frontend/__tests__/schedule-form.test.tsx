import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import NewSchedulePage from '@/app/(dashboard)/schedules/new/page';
import EditSchedulePage from '@/app/(dashboard)/schedules/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'sch-1' }),
  usePathname: () => '/schedules',
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
  { id: 'class-1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true },
];
const LOCATIONS = [
  { id: 'loc-1', tenantId: 't', name: 'Main Hall', address: null, isActive: true },
  { id: 'loc-2', tenantId: 't', name: 'Annex', address: null, isActive: true },
];
const SCHEDULE = {
  id: 'sch-1',
  tenantId: 't',
  classId: 'class-1',
  locationId: 'loc-1',
  dayOfWeek: 'TUE',
  startTime: '10:00',
  endTime: '11:00',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider>
      <AuthProvider>{ui}</AuthProvider>
    </I18nProvider>,
  );
}

describe('schedule form pages', () => {
  let postBody: Record<string, unknown> | null = null;
  let patchBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    postBody = null;
    patchBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/class-schedules/sch-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, SCHEDULE));
      }
      if (url.includes('/class-schedules/sch-1')) {
        return Promise.resolve(jsonResponse(200, SCHEDULE));
      }
      if (url.includes('/class-schedules') && method === 'POST') {
        postBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(201, SCHEDULE));
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('new: submits classId, locationId, day and times', async () => {
    const { container } = renderWithProviders(<NewSchedulePage />);

    await waitFor(() => {
      if (!container.querySelector('option[value="class-1"]')) throw new Error('lookups not loaded');
    });

    fireEvent.change(container.querySelector('#classId')!, { target: { value: 'class-1' } });
    fireEvent.change(container.querySelector('#locationId')!, { target: { value: 'loc-2' } });
    fireEvent.change(container.querySelector('#dayOfWeek')!, { target: { value: 'WED' } });
    fireEvent.change(container.querySelector('#startTime')!, { target: { value: '09:00' } });
    fireEvent.change(container.querySelector('#endTime')!, { target: { value: '10:30' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect(postBody).toMatchObject({
        classId: 'class-1',
        locationId: 'loc-2',
        dayOfWeek: 'WED',
        startTime: '09:00',
        endTime: '10:30',
      });
      expect(replace).toHaveBeenCalledWith('/schedules');
    });
  });

  it('edit: prefills from the schedule and sends isActive on save', async () => {
    const { container } = renderWithProviders(<EditSchedulePage />);

    const start = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#startTime');
      if (!el || el.value !== '10:00') throw new Error('not prefilled yet');
      return el;
    });
    expect(start.value).toBe('10:00');
    // TKT-0016: time fields are native time inputs.
    expect(start.type).toBe('time');
    expect(container.querySelector<HTMLInputElement>('#endTime')!.type).toBe('time');
    expect(container.querySelector<HTMLSelectElement>('#locationId')!.value).toBe('loc-1');
    expect(container.querySelector<HTMLSelectElement>('#dayOfWeek')!.value).toBe('TUE');

    fireEvent.change(container.querySelector('#endTime')!, { target: { value: '12:00' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect(patchBody).toMatchObject({
        locationId: 'loc-1',
        dayOfWeek: 'TUE',
        startTime: '10:00',
        endTime: '12:00',
        isActive: true,
      });
      expect(replace).toHaveBeenCalledWith('/schedules');
    });
  });
});
