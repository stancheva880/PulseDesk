import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listClubs, resetClubsRequest, type TenantSummary } from '@/lib/api-resources';
import { clearStoredTokens, setAccessToken } from '@/lib/auth-storage';

function club(id: string, isActive = true): TenantSummary {
  return { id, slug: id, name: id.toUpperCase(), isActive };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('listClubs', () => {
  beforeEach(() => {
    clearStoredTokens();
    resetClubsRequest();
    setAccessToken('A');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetClubsRequest();
  });

  // GET /tenants selects isActive but applies no `where` (tenants.controller.ts:31-38), and the
  // guard answers 404 for an inactive club exactly as for a missing one. Both the gate and the
  // selector read this helper, so filtering here is what stops them disagreeing about what a
  // club is — the selector must not offer an option the gate would then discard.
  it('excludes inactive clubs so every caller agrees what a club is', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, [club('live'), club('closed', false)]),
    );

    const { clubs } = await listClubs();

    expect(clubs.map((c) => c.id)).toEqual(['live']);
  });

  // Absence from a capped response is not proof of absence. The gate uses this flag to refuse to
  // discard a stored club it cannot see, which above the cap is the only way into that club.
  it('reports a response capped at MAX_PAGE_SIZE as truncated', async () => {
    const full = Array.from({ length: 100 }, (_, i) => club(`c${i}`));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, full));

    const { clubs, truncated } = await listClubs();

    expect(truncated).toBe(true);
    expect(clubs).toHaveLength(100);
  });

  it('reports a short response as complete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, [club('only')]));

    expect((await listClubs()).truncated).toBe(false);
  });

  // Truncation is judged on what the API returned, before the isActive filter — otherwise a capped
  // response containing inactive clubs would look short and licence a wrongful wipe.
  it('judges truncation on the raw response, not the filtered one', async () => {
    const full = Array.from({ length: 100 }, (_, i) => club(`c${i}`, i % 2 === 0));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, full));

    const { clubs, truncated } = await listClubs();

    expect(clubs).toHaveLength(50);
    expect(truncated).toBe(true);
  });

  it('shares one request between callers that ask together', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, [club('live')]));

    const [a, b] = await Promise.all([listClubs(), listClubs()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.clubs).toEqual(b.clubs);
  });

  // The slot clears on settle, so a failure is never memoized — a retry must reach the network.
  it('does not memoize a failure', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, [club('live')]));

    await expect(listClubs()).rejects.toThrow();
    expect((await listClubs()).clubs.map((c) => c.id)).toEqual(['live']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // The club list and the club-creation POST are the two calls that recover from a stale stored
  // club, so neither may carry the header that would 404 them at the guard.
  it('sends no tenant header even when a club is stored', async () => {
    const { writeTenantContext } = await import('@/lib/tenant-context');
    writeTenantContext('gone');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, [club('live')]));

    await listClubs();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).not.toHaveProperty('X-Tenant-Id');
    writeTenantContext(null);
  });
});
