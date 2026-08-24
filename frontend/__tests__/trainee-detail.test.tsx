import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TraineeDetailPage from '@/app/(dashboard)/trainees/[id]/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/trainees/tr-1',
  useParams: () => ({ id: 'tr-1' }),
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

const DETAIL = {
  id: 'tr-1',
  tenantId: 't',
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '2015-03-04T00:00:00.000Z',
  phone: '0888 111 222',
  email: 'ada@example.com',
  notes: 'Left-handed',
  isActive: true,
  userId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  contacts: [
    {
      id: 'c-1',
      tenantId: 't',
      traineeId: 'tr-1',
      firstName: 'Maria',
      lastName: 'Lovelace',
      relationship: 'PARENT',
      phone: '0888 333 444',
      email: 'maria@example.com',
      isPrimary: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  locations: [
    {
      id: 'loc-1',
      tenantId: 't',
      name: 'Central Hall',
      address: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  classes: [
    {
      id: 'cl-1',
      tenantId: 't',
      name: 'Judo Beginners',
      description: null,
      billingMode: 'PER_MONTH',
      monthlyAmount: '80',
      sessionPrice: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  // A different person from the contact above, so the two sections cannot be confused.
  guardians: [{ id: 'u-9', firstName: 'Ivan', lastName: 'Petrov', email: 'ivan@example.com' }],
  user: null,
};

function mockDetailFetch(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/trainees/tr-1')) return Promise.resolve(jsonResponse(200, DETAIL));
    return Promise.resolve(jsonResponse(200, {}));
  });
}

function signIn(role: string): void {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }));
}

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <TraineeDetailPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('TraineeDetailPage', () => {
  beforeEach(() => {
    mockDetailFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a trainer the contact details the list page withholds', async () => {
    signIn('EMPLOYEE');
    const { container } = renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('0888 111 222')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Judo Beginners')).toBeInTheDocument();
    // The guardian contact — name, relationship and phone — is the reason this screen exists.
    expect(screen.getByText('Maria Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Родител')).toBeInTheDocument();
    expect(screen.getByText('0888 333 444')).toBeInTheDocument();
    // The linked guardian account is a separate fact from the contact person.
    expect(screen.getByText('Ivan Petrov')).toBeInTheDocument();

    // Read-only for a trainer: no way in to the form, and nothing to type into.
    expect(container.querySelector('a[href="/trainees/tr-1/edit"]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('offers a manager the edit link', async () => {
    signIn('ADMIN');
    const { container } = renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(container.querySelector('a[href="/trainees/tr-1/edit"]')).not.toBeNull();
  });

  // TKT-0091: contextual create — the detail page links to the fee form with ?traineeId= carried.
  it('offers a manager a new-fee link carrying the trainee id', async () => {
    signIn('ADMIN');
    const { container } = renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(container.querySelector('a[href="/fees/new?traineeId=tr-1"]')).not.toBeNull();
  });

  it('hides the new-fee link from an EMPLOYEE', async () => {
    signIn('EMPLOYEE');
    const { container } = renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(container.querySelector('a[href="/fees/new?traineeId=tr-1"]')).toBeNull();
  });
});
