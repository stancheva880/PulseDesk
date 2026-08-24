import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewSchedulePage from '@/app/(dashboard)/schedules/new/page';
import EditSchedulePage from '@/app/(dashboard)/schedules/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
// TKT-0091: switchable per test — the new page reads ?classId= via useSearchParams.
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'sch-1' }),
  usePathname: () => '/schedules',
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
  { id: 'class-1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true },
];
const loc = (id: string, name: string, isActive = true) => ({
  id, tenantId: 't', name, address: null, isActive,
});

// loc-1 is the schedule's own hall (SCHEDULE.locationId). loc-3 is retired — added for
// TKT-0127; the first two stay active so the pre-existing tests are unaffected. TKT-0127 tests
// reassign `locationRows` before rendering to vary which halls are retired.
const LOCATIONS = [loc('loc-1', 'Main Hall'), loc('loc-2', 'Annex'), loc('loc-3', 'Retired', false)];

let locationRows: ReturnType<typeof loc>[] = LOCATIONS;
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
      <ToastViewport />
      <AuthProvider>{ui}</AuthProvider>
    </I18nProvider>,
  );
}

describe('schedule form pages', () => {
  let postBody: Record<string, unknown> | null = null;
  let patchBody: Record<string, unknown> | null = null;
  let failNextPost = false;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    search = '';
    postBody = null;
    patchBody = null;
    locationRows = LOCATIONS;
    failNextPost = false;
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
        if (failNextPost) return Promise.resolve(jsonResponse(500, { message: 'boom' }));
        postBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(201, SCHEDULE));
      }
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(locationRows)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TKT-0092 (approved TEST CHANGE REQUEST): create no longer navigates back to the list — it
  // stays on the form, confirms with a toast, and resets ready for the next record.
  it('new: submits, stays on the form, confirms with a toast, and resets', async () => {
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
    });
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    // Reset, ready for the next record.
    await waitFor(() => {
      expect(container.querySelector<HTMLSelectElement>('#classId')!.value).toBe('');
      expect(container.querySelector<HTMLInputElement>('#startTime')!.value).toBe('');
    });
  });

  // TKT-0092 AC #4 — a failed save keeps the route, the values, and announces the failure.
  it('new: a failed save stays put with the values preserved and the error shown', async () => {
    const { container } = renderWithProviders(<NewSchedulePage />);

    await waitFor(() => {
      if (!container.querySelector('option[value="class-1"]')) throw new Error('lookups not loaded');
    });
    failNextPost = true;

    fireEvent.change(container.querySelector('#classId')!, { target: { value: 'class-1' } });
    fireEvent.change(container.querySelector('#locationId')!, { target: { value: 'loc-2' } });
    fireEvent.change(container.querySelector('#startTime')!, { target: { value: '09:00' } });
    fireEvent.change(container.querySelector('#endTime')!, { target: { value: '10:30' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      if (!container.querySelector('form .text-destructive')) throw new Error('no error surfaced');
    });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/Запазено|^Saved$/)).toBeNull();
    // Entered values survive the failure.
    expect(container.querySelector<HTMLSelectElement>('#classId')!.value).toBe('class-1');
    expect(container.querySelector<HTMLInputElement>('#startTime')!.value).toBe('09:00');
  });

  // TKT-0091: contextual create — ?classId= preselects the class, membership-checked.
  it('new: preselects the class from ?classId=', async () => {
    search = 'classId=class-1';
    const { container } = renderWithProviders(<NewSchedulePage />);

    await waitFor(() => {
      const el = container.querySelector<HTMLSelectElement>('#classId');
      if (!el || el.value !== 'class-1') throw new Error('not prefilled yet');
    });
  });

  it('new: leaves nothing selected for a ?classId= that is not in the list', async () => {
    search = 'classId=bogus';
    const { container } = renderWithProviders(<NewSchedulePage />);

    await waitFor(() => {
      if (!container.querySelector('option[value="class-1"]')) throw new Error('lookups not loaded');
    });
    expect(container.querySelector<HTMLSelectElement>('#classId')!.value).toBe('');
    expect(container.querySelector('.text-destructive')).toBeNull();
  });

  // TKT-0092 (approved TEST CHANGE REQUEST): edit no longer navigates — it stays put, confirms
  // with a toast, and the fields keep showing the saved values.
  it('edit: prefills, sends isActive on save, stays put and keeps the saved values', async () => {
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
    });
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    // The form still shows the saved values.
    expect(container.querySelector<HTMLInputElement>('#endTime')!.value).toBe('12:00');
    expect(container.querySelector<HTMLInputElement>('#startTime')!.value).toBe('10:00');
  });

  // TKT-0090: a failed field says what is wrong in words, wired for assistive tech. The
  // inverted-range refine carries its own message on the end-time field.
  it('says what is wrong and wires the a11y attributes on an inverted range', async () => {
    const { container } = renderWithProviders(<NewSchedulePage />);
    await waitFor(() => {
      if (!container.querySelector('option[value="class-1"]')) throw new Error('lookups not loaded');
    });

    fireEvent.change(container.querySelector('#classId')!, { target: { value: 'class-1' } });
    fireEvent.change(container.querySelector('#locationId')!, { target: { value: 'loc-2' } });
    fireEvent.change(container.querySelector('#startTime')!, { target: { value: '10:00' } });
    fireEvent.change(container.querySelector('#endTime')!, { target: { value: '09:00' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    const message = await screen.findByText(/Краят трябва|End time must be after/);
    expect(message).toHaveAttribute('role', 'alert');
    expect(message).toHaveAttribute('id', 'endTime-error');
    const endTime = container.querySelector('#endTime')!;
    expect(endTime).toHaveAttribute('aria-invalid', 'true');
    expect(endTime).toHaveAttribute('aria-describedby', 'endTime-error');
    expect(postBody).toBeNull();
  });

  // TKT-0127: the schedules half of the same rule the session form gets — a retired hall is
  // not offered, but the row's own hall keeps its <option> so the select cannot display a hall
  // this schedule is not at. See the note in session-form.test.tsx for why the save assertion
  // is an invariant guard rather than a corruption reproduction.
  describe('deactivated locations (TKT-0127)', () => {
    const optionIds = (container: HTMLElement) =>
      [...container.querySelectorAll<HTMLOptionElement>('#locationId option')]
        .map((o) => o.value)
        .filter(Boolean);

    async function renderEditLoaded() {
      const { container } = renderWithProviders(<EditSchedulePage />);
      await waitFor(() => {
        const el = container.querySelector<HTMLInputElement>('#startTime');
        if (!el || el.value !== '10:00') throw new Error('not prefilled yet');
      });
      return container;
    }

    it('omits a deactivated hall but keeps the active ones', async () => {
      const container = await renderEditLoaded();
      expect(optionIds(container)).toEqual(['loc-1', 'loc-2']);
    });

    it('keeps the row own hall in the list once it is deactivated', async () => {
      locationRows = [loc('loc-1', 'Main Hall', false), loc('loc-2', 'Annex')];
      const container = await renderEditLoaded();
      expect(optionIds(container)).toContain('loc-1');
    });

    // Pins that editing a schedule at a retired hall keeps its location.
    it('saves the same location when the schedule hall is deactivated', async () => {
      locationRows = [loc('loc-1', 'Main Hall', false), loc('loc-2', 'Annex')];
      const container = await renderEditLoaded();

      fireEvent.change(container.querySelector('#endTime')!, { target: { value: '12:00' } });
      fireEvent.click(container.querySelector('button[type="submit"]')!);

      await waitFor(() => {
        expect(patchBody).not.toBeNull();
        expect(patchBody!.locationId).toBe('loc-1');
      });
    });
  });
});
