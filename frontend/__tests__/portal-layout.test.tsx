import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import PortalLayout from '@/app/(portal)/layout';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken, writeStoredMemberships, type LoginMembership } from '@/lib/auth-storage';
import { readTenantContext, writeTenantContext } from '@/lib/tenant-context';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/portal/schedule',
}));

const { hardNavigate, reloadApp } = vi.hoisted(() => ({
  hardNavigate: vi.fn(),
  reloadApp: vi.fn(),
}));
vi.mock('@/lib/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  hardNavigate,
  reloadApp,
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

const CHILD = 'portal-content';
const MEMBERSHIPS: LoginMembership[] = [
  { tenantId: 't-first', tenantName: 'First', role: 'CUSTOMER' },
  { tenantId: 't-second', tenantName: 'Second', role: 'CUSTOMER' },
];

function renderPortal() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <PortalLayout>
          <p>{CHILD}</p>
        </PortalLayout>
      </AuthProvider>
    </I18nProvider>,
  );
}

// TKT-0039: a CUSTOMER is a tenant user, so the portal shares the auto-recovery half of
// the active-tenant gate. It never shows the select-tenant panel — that is SUPER_ADMIN
// only, and a SUPER_ADMIN is redirected out of the portal by useRequireRole.
//
// GET /auth/memberships is left pending in both cases on purpose. AuthProvider's own
// recovery runs off that response, so a pending fetch isolates what the layout does by
// itself, out of the stored snapshot.
describe('PortalLayout active-tenant gate', () => {
  beforeEach(() => {
    hardNavigate.mockClear();
    writeTenantContext(null);
    setAccessToken(
      buildJwt({
        sub: 'u',
        email: 'c@b',
        role: 'CUSTOMER',
        tenantId: 't-first',
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers a customer's active tenant from the first stored membership", async () => {
    writeStoredMemberships(MEMBERSHIPS);

    renderPortal();

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(readTenantContext()).toBe('t-first');
  });

  it('renders no portal content while there is no tenant to recover', async () => {
    writeStoredMemberships([]);

    renderPortal();
    await act(async () => undefined);

    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    expect(readTenantContext()).toBeNull();
  });

  // TKT-0057: a stored club the customer's own snapshot does not list is suspect, so the portal
  // holds rather than letting its pages mount and answer 403. The pending fetch above is what makes
  // this the gate's own decision — and the case right below proves a listed club still renders
  // without waiting for it, so TKT-0039's snapshot-first recovery is intact.
  it('renders no portal content while the stored club is not one of theirs', async () => {
    writeStoredMemberships(MEMBERSHIPS);
    writeTenantContext('left-over');

    renderPortal();
    await act(async () => undefined);

    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
    // The gate withholds; auth-provider.tsx:96-118 remains the only writer.
    expect(readTenantContext()).toBe('left-over');
  });

  // Fees moved into the profile page's own tab; Schedule/Cards nav removed alongside it for
  // now (routes still exist, just no entry point in the header).
  it('shows the brand mark but no Schedule/Fees/Cards nav links', async () => {
    writeStoredMemberships(MEMBERSHIPS);

    renderPortal();

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PulseDesk/ })).toHaveAttribute(
      'href',
      '/portal/schedule',
    );
    expect(screen.queryByRole('link', { name: /^Schedule$|^График$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Fees$|^Такси$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Cards$|^Карти$/ })).not.toBeInTheDocument();
  });
});
