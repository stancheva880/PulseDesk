import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditClassPage from '@/app/(dashboard)/classes/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'class-1' }),
  usePathname: () => '/classes/class-1/edit',
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

const CLASS_DETAIL = {
  id: 'class-1', tenantId: 't', name: 'Yoga', description: null,
  billingMode: 'PER_SESSION', monthlyAmount: null, sessionPrice: '10',
  capacity: 8, isActive: true, createdAt: '', updatedAt: '',
  locations: [], trainers: [], trainees: [],
};

describe('ClassForm capacity (TKT-0103)', () => {
  // Body of the PATCH the form sends, captured for assertions.
  let patchBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    patchBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/classes/class-1')) {
        if (init?.method === 'PATCH') {
          patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse(200, { ...CLASS_DETAIL, ...patchBody });
        }
        return jsonResponse(200, CLASS_DETAIL);
      }
      if (url.includes('/locations')) return jsonResponse(200, paged([]));
      return jsonResponse(200, paged([]));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage() {
    return render(
      <I18nProvider>
        <AuthProvider>
          <EditClassPage />
        </AuthProvider>
      </I18nProvider>,
    );
  }

  // AC #1/#3 surface — the form edits capacity and sends an integer.
  it('shows the stored capacity and sends the edited value', async () => {
    const { container } = renderPage();

    const input = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#capacity');
      expect(el).not.toBeNull();
      expect(el!.value).toBe('8');
      return el!;
    });

    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запазване' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody!.capacity).toBe(10);
  });

  // Clearing the field lifts the limit — the update sends null.
  it('sends null when the capacity is cleared', async () => {
    const { container } = renderPage();
    const input = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#capacity');
      expect(el).not.toBeNull();
      return el!;
    });

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запазване' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody!.capacity).toBeNull();
  });
});

// TKT-0111: warn-allow — the form counts and warns, the save always goes through.
describe('ClassForm capacity warning (TKT-0111)', () => {
  let patchBody: Record<string, unknown> | null = null;

  function mockApi(
    detail: Omit<typeof CLASS_DETAIL, 'trainees' | 'capacity'> & {
      trainees: unknown[];
      capacity: number | null;
    },
  ) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/classes/class-1')) {
        if (init?.method === 'PATCH') {
          patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse(200, { ...detail, ...patchBody });
        }
        return jsonResponse(200, detail);
      }
      return jsonResponse(200, paged([]));
    });
  }

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    patchBody = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage() {
    return render(
      <I18nProvider>
        <AuthProvider>
          <EditClassPage />
        </AuthProvider>
      </I18nProvider>,
    );
  }

  const trainee = (id: string) => ({ id, firstName: 'T', lastName: id });

  it('shows the enrolled/capacity counter, warns when over, and still saves', async () => {
    mockApi({ ...CLASS_DETAIL, capacity: 1, trainees: [trainee('t1'), trainee('t2')] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Записани 2 / капацитет 1')).toBeTruthy(),
    );
    const warning = screen.getByRole('status');
    expect(warning.textContent).toContain('капацитет');

    fireEvent.click(screen.getByRole('button', { name: 'Запазване' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody!.traineeIds).toEqual(['t1', 't2']);
  });

  it('shows the counter without a warning when within capacity', async () => {
    mockApi({ ...CLASS_DETAIL, capacity: 8, trainees: [trainee('t1')] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Записани 1 / капацитет 8')).toBeTruthy(),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no counter when capacity is unset', async () => {
    mockApi({ ...CLASS_DETAIL, capacity: null, trainees: [trainee('t1')] });
    const { container } = renderPage();

    await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#capacity');
      expect(el).not.toBeNull();
      expect(el!.value).toBe('');
    });
    expect(screen.queryByText(/Записани/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
