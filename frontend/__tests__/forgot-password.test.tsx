import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgotPasswordPage from '@/app/forgot-password/page';
import { I18nProvider } from '@/components/i18n-provider';
import { clearStoredTokens } from '@/lib/auth-storage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/forgot-password',
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <ForgotPasswordPage />
    </I18nProvider>,
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => clearStoredTokens());
  afterEach(() => vi.restoreAllMocks());

  it('renders the email field and submit button', async () => {
    renderPage();
    expect(await screen.findByLabelText(/Email|Имейл/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send reset link|Изпращане/ })).toBeInTheDocument();
  });

  it('submits the email and replaces the form with a success message', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { message: 'ok' }));

    renderPage();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'me@example.com');
    await user.click(screen.getByRole('button', { name: /Send reset link|Изпращане/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(/instructions|инструкции/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ email: 'me@example.com' });
  });

  it('blocks submission when the email is invalid', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    renderPage();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Send reset link|Изпращане/ }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/valid email|валиден имейл/i)).toBeInTheDocument();
  });

  it('shows a generic error if the API call fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }));

    renderPage();
    await user.type(await screen.findByLabelText(/Email|Имейл/), 'me@example.com');
    await user.click(screen.getByRole('button', { name: /Send reset link|Изпращане/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Something went wrong|Възникна грешка/);
  });
});
