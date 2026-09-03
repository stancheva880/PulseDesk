import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { MobileNav } from '@/components/mobile-nav';
import { Sidebar } from '@/components/sidebar';
import { setAccessToken, type UserRole } from '@/lib/auth-storage';
import { writeTenantContext } from '@/lib/tenant-context';

const replace = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/locations',
  useRouter: () => ({ replace, push, back: vi.fn() }),
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

// Same probe trick as sidebar.test.tsx: AuthProvider hydrates the role asynchronously, and the
// role-gated destinations only appear once it has.
function RoleProbe() {
  const { user, status } = useAuth();
  return <span data-testid="probe">{`${status}:${user?.role ?? '-'}`}</span>;
}

/**
 * Renders the drawer alongside the desktop sidebar, because the two have to agree: the AC is that
 * the drawer shows the same destinations, in the same order, under the same role filter.
 */
function renderNav(role: UserRole = 'ADMIN') {
  const exp = Math.floor(Date.now() / 1000) + 600;
  setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role, tenantId: 't', exp }));
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
        <MobileNav />
        <Sidebar />
      </AuthProvider>
    </I18nProvider>,
  );
}

function trigger() {
  return screen.getByRole('button', { name: /Open menu|Отвори менюто/ });
}

describe('MobileNav', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    replace.mockClear();
    push.mockClear();
  });

  // AC #1 — class contract only. vitest.config.ts sets `css: false` and matchMedia is stubbed to
  // `matches: false`, so no test here can observe a real 768px breakpoint. The visual half of this
  // AC is a manual check at 375px; this pins the classes that produce it.
  it('hides its trigger at md and above, where the sidebar takes over', async () => {
    const { container } = renderNav('ADMIN');
    await screen.findByText('authenticated:ADMIN');

    expect(trigger().className).toMatch(/md:hidden/);
    expect(container.querySelector('nav[class*="md:flex"]')?.className).toMatch(/hidden/);
  });

  // AC #2 — same destinations, same order, same role filter as the sidebar.
  // Approved TEST CHANGE REQUEST, 2026-08-22: 8 → 9 for /cards (TKT-0106, visit cards).
  // Approved TEST CHANGE REQUEST, 2026-09-03: 9 → 10 for /payment-details (TKT-0131, club
  // payment details moved off /profile into the menu). Same terms: exact set, exact order.
  it('renders all 10 destinations for an admin, in NAV_ITEMS order', async () => {
    renderNav('ADMIN');
    await screen.findByText('authenticated:ADMIN');
    await userEvent.click(trigger());

    const panel = await screen.findByRole('dialog');
    // Scoped to the nav list, so a brand link or a close control in the panel chrome cannot
    // affect the assertion.
    const list = panel.querySelector('ul');
    expect(list).not.toBeNull();
    const hrefs = Array.from(list!.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual([
      '/dashboard',
      '/locations',
      '/classes',
      '/schedules',
      '/sessions',
      '/trainees',
      '/fees',
      '/cards',
      '/users',
      '/payment-details',
    ]);
  });

  it('hides Users from an EMPLOYEE, but shows their own Schedules', async () => {
    renderNav('EMPLOYEE');
    await screen.findByText('authenticated:EMPLOYEE');
    await userEvent.click(trigger());

    const panel = await screen.findByRole('dialog');
    expect(panel.querySelector('a[href="/users"]')).toBeNull();
    // Trainers read their own — writes are ADMIN-only, gated elsewhere (not by hiding the link).
    expect(panel.querySelector('a[href="/sessions"]')).not.toBeNull();
    expect(panel.querySelector('a[href="/classes"]')).not.toBeNull();
    expect(panel.querySelector('a[href="/schedules"]')).not.toBeNull();
  });

  // AC #3 — closes on selection.
  it('closes when a destination is activated', async () => {
    renderNav('ADMIN');
    await screen.findByText('authenticated:ADMIN');
    await userEvent.click(trigger());

    const panel = await screen.findByRole('dialog');
    await userEvent.click(within(panel).getByRole('link', { name: /Fees|Такси/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // AC #3 — Escape closes without navigating.
  it('closes on Escape without navigating', async () => {
    renderNav('ADMIN');
    await screen.findByText('authenticated:ADMIN');
    await userEvent.click(trigger());
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // AC #4 — dialog semantics and focus.
  it('exposes dialog semantics and moves focus into the panel', async () => {
    renderNav('ADMIN');
    await screen.findByText('authenticated:ADMIN');

    // Held by reference: Radix marks everything outside an open modal `aria-hidden`, so a
    // role-based re-query would not find the trigger once the panel is up.
    const button = trigger();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(button);
    const panel = await screen.findByRole('dialog');

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', panel.id);
    // Radix names the dialog from its title; the title is visually hidden in a nav drawer.
    expect(panel).toHaveAccessibleName(/Menu|Меню/);
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
  });
});
