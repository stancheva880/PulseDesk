import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import EditClassPage from '@/app/(dashboard)/classes/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

// PRD-0011's success gate, as a test rather than a measurement: opening the class form must cost
// the same number of requests in a club with 5000 trainees as in one with 50. `listAll` pages
// sequentially at pageSize 100, so a club of 5000 used to cost 50 serialized requests for this
// one field. This fails the moment a paging chain comes back.

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'class-1' }),
  usePathname: () => '/classes/class-1/edit',
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

const CLASS_DETAIL = {
  id: 'class-1',
  tenantId: 't',
  name: 'Yoga',
  description: null,
  billingMode: 'PER_SESSION',
  monthlyAmount: null,
  sessionPrice: '10',
  isActive: true,
  createdAt: '',
  updatedAt: '',
  locations: [],
  trainers: [],
  trainees: [],
};

/** A club of `total` trainees, paged the way the API pages: 100 per page. */
function traineePage(total: number, page: number) {
  const size = 100;
  const start = (page - 1) * size;
  const items = Array.from({ length: Math.min(size, Math.max(0, total - start)) }, (_, i) => ({
    id: `tr-${start + i}`,
    tenantId: 't',
    firstName: 'T',
    lastName: `Trainee${start + i}`,
    dateOfBirth: '2000-01-01T00:00:00.000Z',
    phone: null,
    email: null,
    notes: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  }));
  return { items, page, pageSize: size, total, totalPages: Math.ceil(total / size) };
}

async function countRequestsForClubOf(total: number): Promise<number> {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/classes/class-1')) return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
    if (url.includes('/trainees')) {
      const page = Number(new URL(url, 'http://test.local').searchParams.get('page') ?? '1');
      return Promise.resolve(jsonResponse(200, traineePage(total, page)));
    }
    if (url.includes('/locations')) {
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0, totalPages: 1 }));
    }
    if (url.includes('/users')) {
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0, totalPages: 1 }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });

  render(
    <I18nProvider>
      <AuthProvider>
        <EditClassPage />
      </AuthProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByDisplayValue('Yoga')).toBeInTheDocument());
  // Give any paging chain a chance to run before counting.
  await new Promise((r) => setTimeout(r, 200));
  return fetchMock.mock.calls.length;
}

describe('EditClassPage — the cost of opening the form', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    replace.mockClear();
  });

  it('costs the same number of requests at 50 trainees and at 5000', async () => {
    const small = await countRequestsForClubOf(50);
    vi.restoreAllMocks();
    const large = await countRequestsForClubOf(5000);

    expect(large).toBe(small);
  });

  it('does not fetch the trainee table on mount at all', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/classes/class-1')) return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
      if (url.includes('/trainees')) return Promise.resolve(jsonResponse(200, traineePage(5000, 1)));
      return Promise.resolve(
        jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0, totalPages: 1 }),
      );
    });

    render(
      <I18nProvider>
        <AuthProvider>
          <EditClassPage />
        </AuthProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByDisplayValue('Yoga')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 200));

    const traineeCalls = fetchMock.mock.calls.filter(([input]) =>
      String(typeof input === 'string' ? input : (input as Request).url).includes('/trainees'),
    );
    expect(traineeCalls).toHaveLength(0);
  });
});
