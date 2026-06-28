import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResetPasswordPage from '@/app/reset-password/[token]/page';
import { I18nProvider } from '@/components/i18n-provider';
import { clearStoredTokens } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ token: 'raw-token-xyz' }),
  usePathname: () => '/reset-password/raw-token-xyz',
}));

function jsonResponse(status: number, body: unknown): Response {
  // 204 No Content disallows a body in the Fetch spec.
  const noBody = status === 204 || body == null;
  return new Response(noBody ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <ResetPasswordPage />
    </I18nProvider>,
  );
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    clearStoredTokens();
    replace.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the new + confirm password fields', async () => {
    renderPage();
    expect(await screen.findByLabelText(/New password|Нова парола/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm password|Потвърдете/)).toBeInTheDocument();
  });

  it('submits the token + new password and redirects to /login?reset=ok on success', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(204, null));

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'BrandNew123!');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'BrandNew123!');
    await user.click(screen.getByRole('button', { name: /Reset password|Запазване на парола/ }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reset=ok'));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      token: 'raw-token-xyz',
      newPassword: 'BrandNew123!',
    });
  });

  it('shows an invalid-link message when the API returns 400', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(400, { message: 'Invalid' }),
    );

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'BrandNew123!');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'BrandNew123!');
    await user.click(screen.getByRole('button', { name: /Reset password|Запазване на парола/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/invalid|невалидна|изтекла/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks submission when passwords do not match', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'BrandNew123!');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'Mismatched1!');
    await user.click(screen.getByRole('button', { name: /Reset password|Запазване на парола/ }));

    expect(await screen.findByText(/do not match|не съвпадат/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submission when password is too short', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'short');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'short');
    await user.click(screen.getByRole('button', { name: /Reset password|Запазване на парола/ }));

    expect(await screen.findByText(/at least 8|поне 8/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
