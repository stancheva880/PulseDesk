import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTenantPage from '@/app/(dashboard)/tenants/new/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { setAccessToken } from '@/lib/auth-storage';

// TKT-0053: a super administrator onboards a club, its first location and its first administrator
// in one step. The route is SUPER_ADMIN-only; the dashboard layout denies the other roles.

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/tenants/new',
}));

const hardNavigate = vi.fn();
const writeTenantContext = vi.fn();
vi.mock('@/lib/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  hardNavigate: (path: string) => hardNavigate(path),
  writeTenantContext: (id: string | null) => writeTenantContext(id),
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// notificationSent mirrors the CreatedTenant contract: POST /tenants reports whether the new
// administrator's mail left. Stub input, not an expectation — every assertion below is unchanged.
const CREATED = {
  id: 'tenant-new',
  slug: 'sofia-judo',
  name: 'Sofia Judo',
  isActive: true,
  notificationSent: true,
};

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Име на клуба|Club name/), 'Sofia Judo');
  await user.type(screen.getByLabelText(/Идентификатор|Identifier/), 'sofia-judo');
  await user.type(screen.getByLabelText(/Първа локация|First location/), 'Central Hall');
  await user.type(screen.getByLabelText(/Имейл на администратора|Administrator email/), 'ivan@example.com');
}

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <NewTenantPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('NewTenantPage', () => {
  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'sa', email: 's@a', role: 'SUPER_ADMIN', tenantId: null, exp }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    push.mockReset();
    hardNavigate.mockReset();
    writeTenantContext.mockReset();
  });

  it('posts the club, its location and its administrator, then enters the new club', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(201, CREATED));
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const call = await vi.waitFor(() => {
      const found = fetchSpy.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(found).toBeDefined();
      return found!;
    });
    const [url, init] = call;
    expect(String(url)).toContain('/tenants');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      name: 'Sofia Judo',
      slug: 'sofia-judo',
      locationName: 'Central Hall',
      adminEmail: 'ivan@example.com',
    });
    // TKT-0062 (approved TEST CHANGE REQUEST): the DTO no longer accepts a password, so a
    // client still sending one would get a 400. Assert the absence, not the presence.
    expect(JSON.parse(String((init as RequestInit).body))).not.toHaveProperty('adminPassword');

    // The new club becomes the active one, and the reload is what refreshes the selector.
    await vi.waitFor(() => expect(writeTenantContext).toHaveBeenCalledWith('tenant-new'));
    expect(hardNavigate).toHaveBeenCalledWith('/dashboard');
  });

  // The invite is the new administrator's only way in — they have no password. A failed send
  // used to be invisible: the response was still 201 and the page navigated away, so the club
  // read as onboarded while nobody could reach it.
  it('stays on the page and names the recovery when the invite mail did not go out', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, { ...CREATED, notificationSent: false }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    expect(await screen.findByText(/ivan@example.com/)).toBeInTheDocument();
    // Navigating away would take the only notice of the failure with it.
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(writeTenantContext).not.toHaveBeenCalled();

    // The club itself was created, so entering it stays one click away.
    await user.click(screen.getByRole('button', { name: /Към клуба|Go to the club/ }));
    expect(writeTenantContext).toHaveBeenCalledWith('tenant-new');
    expect(hardNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('has no starting-password field', async () => {
    renderPage();
    // TKT-0062: the super administrator never chooses the administrator's password.
    expect(screen.queryByLabelText(/Начална парола|Starting password/)).toBeNull();
  });

  // TKT-0092 AC — hardNavigate discards the JS context, so the confirmation is stashed in
  // sessionStorage for the next document's ToastViewport to drain.
  it('stashes the created-club toast before the hard navigation', async () => {
    window.sessionStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, CREATED));
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    await vi.waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/dashboard'));
    const raw = window.sessionStorage.getItem('pulsedesk.pendingToast');
    expect(raw).not.toBeNull();
    const stash = JSON.parse(raw!) as { text: string; variant: string };
    expect(stash.variant).toBe('success');
    expect(stash.text).toMatch(/Sofia Judo/);
  });

  it('explains a duplicate identifier instead of showing a raw error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, { message: 'A club with slug "sofia-judo" already exists' }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    expect(
      await screen.findByText(/вече съществува|already exists/i),
    ).toBeInTheDocument();
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('refuses a slug that is not url-safe without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, CREATED));
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.clear(screen.getByLabelText(/Идентификатор|Identifier/));
    await user.type(screen.getByLabelText(/Идентификатор|Identifier/), 'Not A Slug');
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    expect(await screen.findByText(/малки букви|lowercase letters/i)).toBeInTheDocument();
    expect(
      fetchSpy.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false);
  });
  // The three reasons POST /tenants answers 409 used to render one message, so two of them
  // named the wrong problem. These pin each to its own code.
  it('names the taken identifier, with the slug, on a coded 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, {
        statusCode: 409,
        message: 'A club with slug "sofia-judo" already exists',
        error: 'Conflict',
        code: 'TENANT_SLUG_TAKEN',
        params: { slug: 'sofia-judo' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const shown = await screen.findByText(/вече съществува/);
    expect(shown.textContent).toContain('sofia-judo');
    // Bulgarian, not the server's English sentence.
    expect(shown.textContent).not.toContain('already exists');
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('does not call a deactivated administrator a duplicate identifier', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, {
        statusCode: 409,
        message:
          'That account is deactivated; reactivate it before making it a club administrator',
        error: 'Conflict',
        code: 'TENANT_ADMIN_DEACTIVATED',
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Запазване|Save/ }));

    const shown = await screen.findByText(/деактивиран/i);
    // Scoped to the error itself — the form always carries an 'Идентификатор' label.
    expect(shown.textContent).not.toMatch(/идентификатор/i);
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  // TKT-0090: a failed field says what is wrong in words, wired for assistive tech.
  it('says what is wrong and wires the a11y attributes when submitted empty', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Запазване|^Save$/ }));

    const messages = await screen.findAllByText('Това поле е задължително.');
    expect(messages.length).toBeGreaterThanOrEqual(2); // name, slug, locationName
    const name = screen.getByLabelText(/Име на клуба|Club name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'name-error');
    const nameError = messages.find((m) => m.id === 'name-error');
    expect(nameError).toBeDefined();
    expect(nameError).toHaveAttribute('role', 'alert');
    // The email rule carries its own message.
    expect(screen.getByText('Въведете валиден имейл адрес.')).toBeInTheDocument();
  });
});
