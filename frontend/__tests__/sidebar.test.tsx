import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { Sidebar } from '@/components/sidebar';
import { writeStoredTokens, type UserRole } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  usePathname: () => '/locations',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

// Probe lets us wait until AuthProvider has hydrated the role before asserting nav contents.
function RoleProbe() {
  const { user, status } = useAuth();
  return <span data-testid="probe">{`${status}:${user?.role ?? '-'}`}</span>;
}

function renderSidebar(role: UserRole = 'ADMIN') {
  const exp = Math.floor(Date.now() / 1000) + 600;
  writeStoredTokens({
    accessToken: buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }),
    refreshToken: 'R',
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
});
