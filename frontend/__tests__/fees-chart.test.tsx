import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeesChart } from '@/components/fees-chart';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';
import { setLocale } from '@/lib/i18n';

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
    setAccessToken(buildJwt({ sub: 'u', email: 'admin@x', role: 'ADMIN', tenantId: 't', exp }));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await setLocale('bg');
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

  describe('date filters', () => {
    const SEPT = [{ period: '2026-09', collected: 1, pending: 2 }];
    const fromInput = () => screen.getByLabelText(/^(От|From)$/);
    const toInput = () => screen.getByLabelText(/^(До|To)$/);

    it('does not fire a request while the year is half-typed', async () => {
      const calls: string[] = [];
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, FEES_SUMMARY);
      });
      renderChart();
      await screen.findByTestId('chart-row-2026-03');
      expect(calls).toHaveLength(1);

      // A native date input emits complete-but-absurd values while the year is typed.
      fireEvent.change(fromInput(), { target: { value: '0002-01-01' } });
      fireEvent.change(fromInput(), { target: { value: '0020-01-01' } });
      fireEvent.change(fromInput(), { target: { value: '0202-01-01' } });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(calls).toHaveLength(1);
    });

    it('fires exactly one request once the from date is plausible', async () => {
      const calls: string[] = [];
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, FEES_SUMMARY);
      });
      renderChart();
      await screen.findByTestId('chart-row-2026-03');

      fireEvent.change(fromInput(), { target: { value: '2026-01-01' } });
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toContain('from=2026-01-01');
    });

    it('ignores a stale response that lands after a newer one', async () => {
      const resolvers: Array<(r: Response) => void> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise<Response>((resolve) => resolvers.push(resolve)),
      );
      renderChart();
      await vi.waitFor(() => expect(resolvers).toHaveLength(1));

      fireEvent.change(fromInput(), { target: { value: '2026-09-01' } });
      await vi.waitFor(() => expect(resolvers).toHaveLength(2));

      const [firstRequest, secondRequest] = resolvers;
      if (!firstRequest || !secondRequest) throw new Error('expected two in-flight requests');

      // Newest request answers first, then the superseded one.
      secondRequest(jsonResponse(200, SEPT));
      await screen.findByTestId('chart-row-2026-09');
      firstRequest(jsonResponse(200, FEES_SUMMARY));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(screen.queryByTestId('chart-row-2026-03')).toBeNull();
      expect(screen.getByTestId('chart-row-2026-09')).toBeTruthy();
    });


    it('shows a translated message and sends nothing when "to" is before "from"', async () => {
      const calls: string[] = [];
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, FEES_SUMMARY);
      });
      renderChart();
      await screen.findByTestId('chart-row-2026-03');

      fireEvent.change(fromInput(), { target: { value: '2026-05-01' } });
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      fireEvent.change(toInput(), { target: { value: '2026-03-01' } });

      expect(
        await screen.findByText('Крайната дата трябва да е на или след началната.'),
      ).toBeInTheDocument();
      expect(calls).toHaveLength(2);
    });

    it('shows a translated message and sends nothing when the range exceeds the limit', async () => {
      const calls: string[] = [];
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, FEES_SUMMARY);
      });
      renderChart();
      await screen.findByTestId('chart-row-2026-03');

      fireEvent.change(toInput(), { target: { value: '2026-12-31' } });
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      fireEvent.change(fromInput(), { target: { value: '1990-01-01' } });

      expect(
        await screen.findByText('Периодът не може да е по-дълъг от 120 месеца.'),
      ).toBeInTheDocument();
      expect(calls).toHaveLength(2);
    });

    const clearFrom = () =>
      screen.queryByRole('button', { name: /Clear start date|Изчистване на началната дата/i });
    const clearTo = () =>
      screen.queryByRole('button', { name: /Clear end date|Изчистване на крайната дата/i });

    it('renders no clear button while both fields are empty', async () => {
      mockFetch(() => jsonResponse(200, FEES_SUMMARY));
      renderChart();
      await screen.findByTestId('chart-row-2026-03');
      expect(clearFrom()).toBeNull();
      expect(clearTo()).toBeNull();
    });

    it('shows a clear button only for the field that holds a value', async () => {
      mockFetch(() => jsonResponse(200, FEES_SUMMARY));
      renderChart();
      await screen.findByTestId('chart-row-2026-03');

      fireEvent.change(fromInput(), { target: { value: '2026-01-01' } });
      await vi.waitFor(() => expect(clearFrom()).not.toBeNull());
      expect(clearTo()).toBeNull();
    });

    it('clicking clear empties the field and refetches without that bound', async () => {
      const calls: string[] = [];
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, FEES_SUMMARY);
      });
      renderChart();
      await screen.findByTestId('chart-row-2026-03');

      fireEvent.change(fromInput(), { target: { value: '2026-01-01' } });
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toContain('from=2026-01-01');

      const button = clearFrom();
      if (!button) throw new Error('expected a clear button for the start date');
      await userEvent.click(button);

      await vi.waitFor(() => expect(calls).toHaveLength(3));
      expect(calls[2]).not.toContain('from=');
      expect(fromInput()).toHaveValue('');
      expect(clearFrom()).toBeNull();
    });

    it('captions the period actually charted, taken from the response', async () => {
      mockFetch(() => jsonResponse(200, FEES_SUMMARY));
      renderChart();
      await screen.findByTestId('chart-row-2026-03');
      expect(
        await screen.findByText(/(Показва|Showing): 2026-03 – 2026-04/),
      ).toBeInTheDocument();
    });

    it('captions a single-month response without a range dash', async () => {
      mockFetch(() => jsonResponse(200, [{ period: '2026-05', collected: 5, pending: 5 }]));
      renderChart();
      await screen.findByTestId('chart-row-2026-05');
      expect(await screen.findByText(/(Показва|Showing): 2026-05$/)).toBeInTheDocument();
    });
    it('does not refetch when the language changes', async () => {
      const calls: string[] = [];
      mockFetch((url) => {
        calls.push(url);
        return jsonResponse(200, FEES_SUMMARY);
      });
      renderChart();
      await screen.findByTestId('chart-row-2026-03');
      expect(calls).toHaveLength(1);

      await act(async () => {
        await setLocale('en');
      });
      expect(await screen.findByLabelText('From')).toBeInTheDocument();
      expect(calls).toHaveLength(1);
    });
  });

  // TKT-0096: the chart offers a way into /fees for the period in view. The fees page's month
  // filter holds exactly one month, so a single-month view links filtered; a wider view links
  // to the unfiltered list.
  describe('link into /fees', () => {
    const linkName = /View in fees list|Към списъка с такси/;

    it('links to /fees?month= when a single month is in view', async () => {
      mockFetch(() => jsonResponse(200, [{ period: '2026-05', collected: 5, pending: 5 }]));
      renderChart();
      await screen.findByTestId('chart-row-2026-05');

      const link = await screen.findByRole('link', { name: linkName });
      expect(link).toHaveAttribute('href', '/fees?month=2026-05');
    });

    it('links to /fees unfiltered when the view spans months', async () => {
      mockFetch(() => jsonResponse(200, FEES_SUMMARY));
      renderChart();
      await screen.findByTestId('chart-row-2026-03');

      const link = await screen.findByRole('link', { name: linkName });
      expect(link).toHaveAttribute('href', '/fees');
    });

    it('offers no link while loading, on error, or on an empty response', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise<Response>(() => {}),
      );
      const loading = renderChart();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('link', { name: linkName })).toBeNull();
      loading.unmount();
      vi.restoreAllMocks();

      mockFetch(() => jsonResponse(500, { message: 'boom' }));
      const failed = renderChart();
      await screen.findByText('boom');
      expect(screen.queryByRole('link', { name: linkName })).toBeNull();
      failed.unmount();
      vi.restoreAllMocks();

      mockFetch(() => jsonResponse(200, []));
      renderChart();
      await screen.findByText(/No data in this range|Няма данни за този период/);
      expect(screen.queryByRole('link', { name: linkName })).toBeNull();
    });
  });
});
