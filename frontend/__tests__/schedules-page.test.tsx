import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SchedulesListPage from '@/app/(dashboard)/schedules/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
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
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 };
}

const SCHEDULES = [
  {
    id: 'sch-1', tenantId: 't', classId: 'c1', locationId: 'loc-1',
    dayOfWeek: 'TUE', startTime: '10:00', endTime: '11:30', isActive: true,
    createdAt: '', updatedAt: '',
  },
];
const CLASSES = [{ id: 'c1', tenantId: 't', name: 'Yoga', billingMode: 'PER_MONTH', isActive: true }];
const LOCATIONS = [{ id: 'loc-1', tenantId: 't', name: 'Main Hall', address: null, isActive: true }];

describe('SchedulesListPage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/class-schedules')) return Promise.resolve(jsonResponse(200, paged(SCHEDULES)));
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders schedule rows with class/location names joined via lookups', async () => {
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SchedulesListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    // 'Yoga' also appears in the generate-form's class select — assert the table body.
    const tbody = await screen.findAllByText('Yoga').then(() => container.querySelector('tbody')!);
    expect(tbody.textContent).toContain('Yoga');
    expect(tbody.textContent).toContain('Main Hall');
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('11:30')).toBeInTheDocument();
    expect(container.querySelector('a[href="/schedules/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/schedules/sch-1/edit"]')).not.toBeNull();
  });

  // TKT-0089 — the generate confirmation moved out of the page and into the toast, so it now
  // survives the redirect that used to destroy it.
  it('confirms generated sessions through the toast', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/class-schedules/generate-sessions') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { created: 4, skipped: 1 }));
      }
      if (url.includes('/class-schedules')) return Promise.resolve(jsonResponse(200, paged(SCHEDULES)));
      if (url.includes('/classes')) return Promise.resolve(jsonResponse(200, paged(CLASSES)));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, paged(LOCATIONS)));
      return Promise.resolve(jsonResponse(200, {}));
    });

    render(
      <I18nProvider>
        <ToastViewport />
        <AuthProvider>
          <SchedulesListPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await screen.findByText('Main Hall');

    const from = screen.getByLabelText(/From|От/);
    const to = screen.getByLabelText(/To|До/);
    await user.type(from, '2026-04-01');
    await user.type(to, '2026-04-30');
    await user.click(screen.getByRole('button', { name: /Generate|Генериране/ }));

    const toast = await screen.findByText(/4/);
    expect(toast.closest('[role="status"]')).not.toBeNull();
  });

  // EMPLOYEE reads their own (class-schedules.service.ts scopes the list server-side); writes
  // stay ADMIN-only, so the page hides every control that leads to one.
  it('hides New/Generate/Edit/Delete for an EMPLOYEE, but still shows the schedule row', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'e@b', role: 'EMPLOYEE', tenantId: 't', exp }));
    const { container } = render(
      <I18nProvider>
        <AuthProvider>
          <SchedulesListPage />
        </AuthProvider>
      </I18nProvider>,
    );

    const tbody = await screen.findAllByText('Yoga').then(() => container.querySelector('tbody')!);
    expect(tbody.textContent).toContain('Yoga');
    expect(tbody.textContent).toContain('Main Hall');

    expect(container.querySelector('a[href="/schedules/new"]')).toBeNull();
    expect(container.querySelector('a[href="/schedules/sch-1/edit"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Generate|Генериране/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete$|^Изтриване$/ })).not.toBeInTheDocument();
  });
});
