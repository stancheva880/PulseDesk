import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClaimPage from '@/app/claim/page';
import { I18nProvider } from '@/components/i18n-provider';

let query = 'token=tok-1';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <ClaimPage />
    </I18nProvider>,
  );
}

describe('Claim landing page (TKT-0114)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    query = 'token=tok-1';
  });

  it('posts the token and shows "claimed" with the class name on 200', async () => {
    let posted: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      expect(url).toContain('/waitlist/claim');
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, {
        claimed: true,
        className: 'Yoga 101',
        startsAt: '2026-12-01T10:00:00.000Z',
      });
    });

    renderPage();
    expect(await screen.findByText('Мястото е запазено!')).toBeInTheDocument();
    expect(screen.getByText(/Yoga 101/)).toBeInTheDocument();
    expect(posted).toEqual({ token: 'tok-1' });
    expect(screen.queryByText('Мястото вече е заето.')).toBeNull();
    expect(screen.queryByText('Връзката е невалидна или изтекла.')).toBeNull();
  });

  it('shows "already taken" on 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, { code: 'SPOT_TAKEN', message: 'taken' }),
    );

    renderPage();
    expect(await screen.findByText('Мястото вече е заето.')).toBeInTheDocument();
    expect(screen.queryByText('Мястото е запазено!')).toBeNull();
  });

  it('shows "expired" on 410 and when the token is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(410, { code: 'WAITLIST_CLAIM_GONE', message: 'gone' }),
    );
    renderPage();
    expect(await screen.findByText('Връзката е невалидна или изтекла.')).toBeInTheDocument();

    // No token in the URL — no request at all, straight to expired.
    vi.restoreAllMocks();
    const spy = vi.spyOn(globalThis, 'fetch');
    query = '';
    renderPage();
    expect(await screen.findAllByText('Връзката е невалидна или изтекла.')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});
