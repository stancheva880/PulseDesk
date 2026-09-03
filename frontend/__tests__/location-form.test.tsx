import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewLocationPage from '@/app/(dashboard)/locations/new/page';
import EditLocationPage from '@/app/(dashboard)/locations/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { setAccessToken } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'loc-1' }),
  usePathname: () => '/locations',
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

const LOCATION = {
  id: 'loc-1',
  tenantId: 't',
  name: 'Main Hall',
  address: 'Center 1',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider>
      <ToastViewport />
      <AuthProvider>{ui}</AuthProvider>
    </I18nProvider>,
  );
}

describe('location form pages', () => {
  let postBody: Record<string, unknown> | null = null;
  let patchBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    setAccessToken(buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }));
    replace.mockClear();
    postBody = null;
    patchBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/locations/loc-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, LOCATION));
      }
      if (url.includes('/locations/loc-1')) return Promise.resolve(jsonResponse(200, LOCATION));
      if (url.includes('/locations') && method === 'POST') {
        postBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(201, LOCATION));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TKT-0092 (approved TEST CHANGE REQUEST): create stays on the form, confirms with a toast,
  // and resets ready for the next record.
  it('new: submits name, omits empty address, stays put and resets', async () => {
    const { container } = renderWithProviders(<NewLocationPage />);

    fireEvent.change(container.querySelector('#name')!, { target: { value: 'Hall B' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect(postBody!.name).toBe('Hall B');
      expect('address' in postBody!).toBe(false);
    });
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector<HTMLInputElement>('#name')!.value).toBe('');
    });
  });

  it('edit: prefills from the record and sends isActive on save', async () => {
    // The full name/address/isActive form is SUPER_ADMIN's — an ADMIN gets a narrower view,
    // covered separately below.
    setAccessToken(
      buildJwt({ sub: 'u', email: 'a@b', role: 'SUPER_ADMIN', tenantId: 't', exp: Math.floor(Date.now() / 1000) + 600 }),
    );
    const { container } = renderWithProviders(<EditLocationPage />);

    const name = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#name');
      if (!el || el.value !== 'Main Hall') throw new Error('not prefilled yet');
      return el;
    });
    expect(name.value).toBe('Main Hall');

    fireEvent.change(name, { target: { value: 'Renamed Hall' } });
    fireEvent.click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect(patchBody!.name).toBe('Renamed Hall');
      expect(patchBody!.address).toBe('Center 1');
      expect(patchBody!.isActive).toBe(false);
    });
    // TKT-0092 (approved TEST CHANGE REQUEST): edit stays put, confirms with a toast, and the
    // form keeps showing the saved values.
    expect(await screen.findByText(/Запазено|^Saved$/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('#name')!.value).toBe('Renamed Hall');
  });

  // TKT-0128: an ADMIN reaches the edit route but only for payment details — name/address/
  // isActive stay a SUPER_ADMIN concern.
  it('edit as ADMIN: shows only payment details, collapsed by default, and saves via its own PATCH', async () => {
    let paymentPatchBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/locations/loc-1/payment-details') && method === 'PATCH') {
        paymentPatchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, { ...LOCATION, revolutHandle: '@studio' }));
      }
      if (url.includes('/locations/loc-1')) return Promise.resolve(jsonResponse(200, LOCATION));
      return Promise.resolve(jsonResponse(200, {}));
    });
    const { container } = renderWithProviders(<EditLocationPage />);

    expect(await screen.findByText('Main Hall')).toBeInTheDocument();
    expect(container.querySelector('#name')).toBeNull();
    expect(container.querySelector('#revolutHandle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Add payment details|Добавяне на собствени/ }));
    fireEvent.change(container.querySelector('#revolutHandle')!, { target: { value: '@studio' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(paymentPatchBody).not.toBeNull();
      expect(paymentPatchBody!.revolutHandle).toBe('@studio');
      expect(patchBody).toBeNull(); // the general PATCH /locations/:id never fires for ADMIN
    });
  });

  // A location that already has its own override shows the fields expanded, not behind the
  // "+ Add" button — there is nothing left to reveal.
  it('edit: payment fields start expanded when the location already has an override', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/locations/loc-1')) {
        return Promise.resolve(jsonResponse(200, { ...LOCATION, revolutHandle: '@studio' }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    const { container } = renderWithProviders(<EditLocationPage />);

    const revolut = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('#revolutHandle');
      if (!el) throw new Error('not rendered yet');
      return el;
    });
    expect(revolut.value).toBe('@studio');
    expect(
      screen.queryByRole('button', { name: /Add payment details|Добавяне на собствени/ }),
    ).not.toBeInTheDocument();
  });

  // SUPER_ADMIN gets both: the full location form and the payment-details section, saved with
  // one submit.
  it('edit as SUPER_ADMIN: saving with payment details open sends both PATCH calls', async () => {
    setAccessToken(
      buildJwt({ sub: 'u', email: 'a@b', role: 'SUPER_ADMIN', tenantId: 't', exp: Math.floor(Date.now() / 1000) + 600 }),
    );
    let paymentPatchBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/locations/loc-1/payment-details') && method === 'PATCH') {
        paymentPatchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, LOCATION));
      }
      if (url.includes('/locations/loc-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, LOCATION));
      }
      if (url.includes('/locations/loc-1')) return Promise.resolve(jsonResponse(200, LOCATION));
      return Promise.resolve(jsonResponse(200, {}));
    });
    const { container } = renderWithProviders(<EditLocationPage />);

    await waitFor(() => {
      if (container.querySelector<HTMLInputElement>('#name')!.value !== 'Main Hall') {
        throw new Error('not prefilled yet');
      }
    });
    fireEvent.click(screen.getByRole('button', { name: /Add payment details|Добавяне на собствени/ }));
    fireEvent.change(container.querySelector('#bankIban')!, { target: { value: 'BG80BNBG96611020345678' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect(paymentPatchBody).not.toBeNull();
      expect(paymentPatchBody!.bankIban).toBe('BG80BNBG96611020345678');
    });
  });

  // TKT-0090: a failed field says what is wrong in words, wired for assistive tech.
  it('says what is wrong and wires the a11y attributes when submitted empty', async () => {
    const { container } = renderWithProviders(<NewLocationPage />);

    fireEvent.click(container.querySelector('button[type="submit"]')!);

    const message = await screen.findByText('Това поле е задължително.');
    expect(message).toHaveAttribute('role', 'alert');
    expect(message).toHaveAttribute('id', 'name-error');
    const name = container.querySelector('#name')!;
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'name-error');
  });

  // TKT-0090: a submit-level failure is announced and brought into view, not left as a bare
  // paragraph above the buttons.
  it('focuses the submit-level error when the save fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/locations') && (init?.method ?? 'GET') === 'POST') {
        return Promise.resolve(jsonResponse(500, { message: 'boom' }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    const { container } = renderWithProviders(<NewLocationPage />);

    fireEvent.change(container.querySelector('#name')!, { target: { value: 'Hall B' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    const alert = await screen.findByText('boom');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(document.activeElement).toBe(alert);
  });
});
