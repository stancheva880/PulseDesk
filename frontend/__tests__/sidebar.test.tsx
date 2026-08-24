import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { Sidebar } from '@/components/sidebar';
import { setAccessToken, type UserRole } from '@/lib/auth-storage';
import { writeTenantContext } from '@/lib/tenant-context';

vi.mock('next/navigation', () => ({
  usePathname: () => '/locations',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Probe lets us wait until AuthProvider has hydrated the role before asserting nav contents.
function RoleProbe() {
  const { user, status } = useAuth();
  return <span data-testid="probe">{`${status}:${user?.role ?? '-'}`}</span>;
}

function renderSidebar(role: UserRole = 'ADMIN') {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }));
  // AuthProvider reconciles its membership snapshot on mount. Left unmocked that request
  // goes to NEXT_PUBLIC_API_URL for real: a dev backend on that port answers 401, the
  // retried refresh answers 401 too, and the provider signs the session out mid-test —
  // which drops the role-gated links and made this file pass or fail on whether a server
  // happened to be running. Answer it here so the render depends on nothing outside.
  writeTenantContext('t');
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    return Promise.resolve(
      url.includes('/auth/memberships')
        ? jsonResponse([{ tenantId: 't', tenantName: 'Club', role }])
        : jsonResponse({}),
    );
  });
  return render(
    <I18nProvider>
      <AuthProvider>
        <RoleProbe />
        <Sidebar />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('Sidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all 8 nav items for an admin with their accessible labels', async () => {
    renderSidebar('ADMIN');
    for (const labelRe of [
      /Dashboard|Табло/,
      /Locations|Локации/,
      /Classes|Класове/,
      /Schedules|Графици/,
      /Sessions|Тренировки/,
      /Trainees|Трениращи/,
      /Fees|Такси/,
      /Users|Потребители/,
    ]) {
      expect(await screen.findByRole('link', { name: labelRe })).toBeInTheDocument();
    }
  });

  it('marks the link matching the current pathname as active (orange accent + aria-current)', async () => {
    renderSidebar('ADMIN');
    const active = await screen.findByRole('link', { name: /Locations|Локации/ });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('data-active', 'true');
    expect(active.className).toMatch(/text-accent-foreground|bg-accent/);
  });

  it('renders a brand mark with the app name', async () => {
    renderSidebar('ADMIN');
    expect(await screen.findByText(/PulseDesk/)).toBeInTheDocument();
  });

  it('hides Schedules and Users from an EMPLOYEE (trainer)', async () => {
    const { container } = renderSidebar('EMPLOYEE');
    await screen.findByText('authenticated:EMPLOYEE');
    expect(container.querySelector('a[href="/schedules"]')).toBeNull();
    expect(container.querySelector('a[href="/users"]')).toBeNull();
    // Sessions/Classes stay visible — trainers can read them.
    expect(container.querySelector('a[href="/sessions"]')).not.toBeNull();
    expect(container.querySelector('a[href="/classes"]')).not.toBeNull();
  });

  // TKT-0122: platform maintenance is the first SUPER_ADMIN-only destination, so it is also
  // the first nav item an ADMIN must not see. layout.tsx DENY_RULES covers the deep link.
  it('shows Maintenance to a SUPER_ADMIN and to nobody else', async () => {
    const su = renderSidebar('SUPER_ADMIN');
    await screen.findByText('authenticated:SUPER_ADMIN');
    expect(su.container.querySelector('a[href="/maintenance"]')).not.toBeNull();
    su.unmount();

    const admin = renderSidebar('ADMIN');
    await screen.findByText('authenticated:ADMIN');
    expect(admin.container.querySelector('a[href="/maintenance"]')).toBeNull();
  });
});
