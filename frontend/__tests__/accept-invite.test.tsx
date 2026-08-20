import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AcceptInvitePage from '@/app/accept-invite/[token]/page';
import { I18nProvider } from '@/components/i18n-provider';
import { clearStoredTokens } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ token: 'invite-token-abc' }),
  usePathname: () => '/accept-invite/invite-token-abc',
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
      <AcceptInvitePage />
    </I18nProvider>,
  );
}

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    clearStoredTokens();
    replace.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the invite copy and both password fields', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: /Set your password|Изберете своя парола/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/New password|Нова парола/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm password|Потвърдете/)).toBeInTheDocument();
  });

  it('submits the token + new password and redirects to /login?reset=ok on success', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(204, null));

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'ChosenByMe1!');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'ChosenByMe1!');
    await user.click(screen.getByRole('button', { name: /Set password|Запазване на парола/ }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reset=ok'));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/auth/reset-password');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      token: 'invite-token-abc',
      newPassword: 'ChosenByMe1!',
    });
  });

  // A used or expired invite token both come back as 400 from completePasswordReset, and the
  // page answers both the same way: invite-specific wording plus the self-recovery link.
  it('shows the invite-specific invalid-link message and a /forgot-password link on a 400', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(400, { message: 'Invalid or expired reset link' }),
    );

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'ChosenByMe1!');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'ChosenByMe1!');
    await user.click(screen.getByRole('button', { name: /Set password|Запазване на парола/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/invite link|покана/i);
    expect(alert.textContent).not.toMatch(/reset link/i);
    expect(screen.getByRole('link', { name: /Request a new link|Заявете нова връзка/ })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks submission when the password is shorter than 8 characters', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'short');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'short');
    await user.click(screen.getByRole('button', { name: /Set password|Запазване на парола/ }));

    expect(await screen.findByText(/at least 8|поне 8/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submission when passwords do not match', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    renderPage();
    await user.type(await screen.findByLabelText(/New password|Нова парола/), 'ChosenByMe1!');
    await user.type(screen.getByLabelText(/Confirm password|Потвърдете/), 'Mismatched1!');
    await user.click(screen.getByRole('button', { name: /Set password|Запазване на парола/ }));

    expect(await screen.findByText(/do not match|не съвпадат/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
