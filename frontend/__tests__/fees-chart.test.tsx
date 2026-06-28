import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeesChart } from '@/components/fees-chart';
import { I18nProvider } from '@/components/i18n-provider';
import { writeStoredTokens } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
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

const FEES_SUMMARY = [
  { period: '2026-03', collected: 30, pending: 70 },
  { period: '2026-04', collected: 100, pending: 0 },
];
const CASHFLOW_SUMMARY = [
  { period: '2026-03', collected: 0, billed: 100 },
  { period: '2026-04', collected: 100, billed: 0 },
];

function renderChart() {
  return render(
    <I18nProvider>
      <FeesChart />
    </I18nProvider>,
  );
}

describe('FeesChart', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    writeStoredTokens({
      accessToken: buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }),
      refreshToken: 'R',
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(handler: (url: string) => Response | Promise<Response>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return Promise.resolve(handler(url));
    });
  }

  it('loads the billing lens by default and renders a row per period', async () => {
    mockFetch((url) => {
      if (url.includes('/dashboard/fees-summary')) return jsonResponse(200, FEES_SUMMARY);
      if (url.includes('/dashboard/cashflow-summary')) return jsonResponse(200, CASHFLOW_SUMMARY);
      return jsonResponse(404, null);
    });
    renderChart();
    // Use the sr-only backing table to verify data without mounting a real DOM size for the SVG.
    const row03 = await screen.findByTestId('chart-row-2026-03');
    expect(row03.textContent).toMatch(/30\.00/);
    expect(row03.textContent).toMatch(/70\.00/);
    const row04 = screen.getByTestId('chart-row-2026-04');
    expect(row04.textContent).toMatch(/100\.00/);
    expect(row04.textContent).toMatch(/0\.00/);
    // Billing button is pressed.
    expect(screen.getByRole('button', { name: /Billing|Фактуриране/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switching to cash-flow lens hits the other endpoint and shows different numbers for the same months', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.includes('/dashboard/fees-summary')) return jsonResponse(200, FEES_SUMMARY);
      if (url.includes('/dashboard/cashflow-summary')) return jsonResponse(200, CASHFLOW_SUMMARY);
      return jsonResponse(404, null);
    });
    renderChart();
    await screen.findByTestId('chart-row-2026-03');
    await user.click(screen.getByRole('button', { name: /Cash-flow|Парични потоци/ }));

    // After switching, March collected = 0 / billed = 100 (cashflow numbers).
    const row = await screen.findByTestId('chart-row-2026-03');
    // Wait for the row to reflect cashflow numbers (the row updates in place).
    await vi.waitFor(() => {
      expect(row.textContent).toMatch(/0\.00.*100\.00/);
    });
    // The cash-flow request was made.
    expect(calls.some((c) => c.includes('/dashboard/cashflow-summary'))).toBe(true);
  });

  it('renders the empty message when the API returns []', async () => {
    mockFetch(() => jsonResponse(200, []));
    renderChart();
    expect(
      await screen.findByText(/No data in this range|Няма данни за този период/),
    ).toBeInTheDocument();
  });
});
