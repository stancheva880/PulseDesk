import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setOnAuthFailure } from '@/lib/api';
import { Tenants } from '@/lib/api-resources';
import { clearStoredTokens, getAccessToken, setAccessToken } from '@/lib/auth-storage';
import { writeTenantContext } from '@/lib/tenant-context';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  beforeEach(() => {
    clearStoredTokens();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setOnAuthFailure(null);
  });

  it('GET attaches the Bearer header from storage and returns the JSON body', async () => {
    setAccessToken('AAA');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { id: '1' }));

    const result = await apiRequest<{ id: string }>('/locations');

    expect(result).toEqual({ id: '1' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer AAA');
  });

  it('POST sends a JSON body and Content-Type', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(201, { id: 'x' }));

    await apiRequest('/locations', {
      method: 'POST',
      body: { name: 'Studio' },
      unauthenticated: true,
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'Studio' }));
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBeUndefined();
  });

  it('returns undefined for 204 responses', async () => {
    setAccessToken('AAA');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiRequest('/locations/abc', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws ApiError with the server message on non-OK', async () => {
    setAccessToken('AAA');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(409, { message: 'Already exists' }),
    );
    await expect(apiRequest('/locations', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'Already exists',
    });
  });

  // TKT-0056: the stored club is attached to every request, so a stale one 404s at the guard —
  // including on the two routes that exist to recover from it. Neither reads @TenantId(), and
  // tenants.schema.ts:3-5 already states the list must stay independent of the header.
  describe('the club routes never carry the tenant header', () => {
    it('omits the tenant header from the club list', async () => {
      setAccessToken('AAA');
      writeTenantContext('gone');
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(200, []));

      await Tenants.list();

      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as RequestInit).headers).not.toHaveProperty('X-Tenant-Id');
    });

    it('omits the tenant header when creating a club', async () => {
      setAccessToken('AAA');
      writeTenantContext('gone');
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(201, { id: 'new' }));

      await Tenants.create({
        name: 'Sofia Judo',
        slug: 'sofia-judo',
        locationName: 'Central Hall',
        adminEmail: 'a@b.com',
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as RequestInit).headers).not.toHaveProperty('X-Tenant-Id');
    });

    // Guards the reason the flag is safe here: a route whose authorization depends on the
    // per-tenant role must keep the header, because the guard's role swap reads it.
    it('still attaches the tenant header to an ordinary request', async () => {
      setAccessToken('AAA');
      writeTenantContext('t1');
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(200, []));

      await apiRequest('/locations');

      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as RequestInit).headers).toHaveProperty('X-Tenant-Id', 't1');
    });
  });

  it('refreshes once on 401 and retries the original request with the new token', async () => {
    setAccessToken('OLD');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // 1st call — original request returns 401
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Token expired' }))
      // 2nd call — refresh returns new tokens
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'NEW', refreshToken: 'RRR2' }),
      )
      // 3rd call — retry of the original returns success
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await apiRequest<{ ok: true }>('/locations');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // TKT-0036 (approved TCR): previously asserted the rotated pair was persisted to
    // localStorage. The refresh token is now an httpOnly cookie the client cannot read.
    expect(getAccessToken()).toBe('NEW');
    expect(window.localStorage.getItem('pulsedesk.refresh')).toBeNull();

    const retryInit = fetchMock.mock.calls[2]![1] as RequestInit;
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer NEW');
  });

  it('de-duplicates concurrent refreshes and retries every caller', async () => {
    setAccessToken('OLD');
    // Concurrent call order is nondeterministic, so route by URL + token rather
    // than by mockResolvedValueOnce ordering.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(jsonResponse(200, { accessToken: 'NEW', refreshToken: 'RRR2' }));
      }
      const headers = ((init as RequestInit).headers ?? {}) as Record<string, string>;
      return Promise.resolve(
        headers.Authorization === 'Bearer NEW'
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, { message: 'Token expired' }),
      );
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => apiRequest<{ ok: true }>('/locations')),
    );

    expect(results).toEqual(Array.from({ length: 5 }, () => ({ ok: true })));
    const refreshCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    // TKT-0036 (approved TCR): previously asserted the rotated pair was persisted to
    // localStorage. The refresh token is now an httpOnly cookie the client cannot read.
    expect(getAccessToken()).toBe('NEW');
    expect(window.localStorage.getItem('pulsedesk.refresh')).toBeNull();
  });

  it('clears tokens, calls onAuthFailure, and surfaces the 401 when refresh fails', async () => {
    setAccessToken('OLD');
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Refresh rejected' }));

    await expect(apiRequest('/locations')).rejects.toBeInstanceOf(ApiError);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBeNull();
  });

  // Only the server rejecting the cookie proves the session is over. These three cases say
  // nothing about it, and clearing on them signed a good session out mid-blip — the 429 case is
  // real: the shared 100 req/min throttle answers the refresh, not the credential.
  it('keeps the session when the refresh request fails with a network error', async () => {
    setAccessToken('OLD');
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(apiRequest('/locations')).rejects.toBeInstanceOf(ApiError);
    expect(onFailure).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('OLD');
  });

  it('keeps the session when the refresh is throttled', async () => {
    setAccessToken('OLD');
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
      .mockResolvedValueOnce(jsonResponse(429, { message: 'ThrottlerException: Too Many Requests' }));

    await expect(apiRequest('/locations')).rejects.toBeInstanceOf(ApiError);
    expect(onFailure).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('OLD');
  });

  it('keeps the session when the refresh answers 500', async () => {
    setAccessToken('OLD');
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
      .mockResolvedValueOnce(jsonResponse(500, { message: 'Internal server error' }));

    await expect(apiRequest('/locations')).rejects.toBeInstanceOf(ApiError);
    expect(onFailure).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('OLD');
  });

  // A transient failure must not poison the next attempt: once the network is back, the next 401
  // has to be able to refresh and recover without a re-login.
  it('recovers on the next 401 after a transient refresh failure', async () => {
    setAccessToken('OLD');
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'NEW' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: '1' }));

    await expect(apiRequest('/locations')).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest<{ id: string }>('/locations')).resolves.toEqual({ id: '1' });
    expect(onFailure).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('NEW');
  });

  it('fires onAuthFailure once when a shared refresh fails', async () => {
    setAccessToken('OLD');
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        String(input).endsWith('/auth/refresh')
          ? jsonResponse(401, { message: 'Refresh rejected' })
          : jsonResponse(401, { message: 'Token expired' }),
      ),
    );

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => apiRequest('/locations')),
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBeNull();
  });

  // TKT-0031 — cross-tab coordination. Each tab has its own module instance, so the
  // in-flight promise alone cannot stop two tabs presenting the same refresh token.
  describe('cross-tab lock', () => {
    afterEach(() => {
      delete (globalThis.navigator as { locks?: unknown }).locks;
    });

    function installLockManager(onAcquire?: () => void) {
      const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => {
        onAcquire?.();
        return cb();
      });
      (globalThis.navigator as { locks?: unknown }).locks = { request };
      return request;
    }

    it('runs the refresh inside a named Web Lock when available', async () => {
      setAccessToken('OLD');
      const request = installLockManager();
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
        .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'NEW', refreshToken: 'RRR2' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      await expect(apiRequest('/locations')).resolves.toEqual({ ok: true });

      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.calls[0]![0]).toBe('pulsedesk.refresh');
    });

    // TKT-0036 (approved TCR). This previously asserted that a tab losing the lock sends
    // NO refresh, having detected the winner's rotation by comparing stored refresh
    // tokens. That comparison is impossible now — the token is an httpOnly cookie — and
    // the post-lock re-read it guarded was deliberately removed: the cookie jar plays
    // that role atomically, so the waiter's own refresh presents the already-rotated
    // cookie and is a clean rotation rather than a replay.
    //
    // Known coverage reduction, recorded in the ticket: nothing on the frontend can
    // observe whether that second refresh was a rotation or a replay. The backend
    // grace-window tests (TKT-0032) cover the replay side; the seam between them is
    // untested.
    it('lets a tab that waited on the lock run its own refresh', async () => {
      setAccessToken('OLD');
      const request = installLockManager();
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
        .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'NEW' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      await expect(apiRequest('/locations')).resolves.toEqual({ ok: true });

      // Serialised by the lock, not skipped.
      expect(request).toHaveBeenCalledOnce();
      const refreshCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith('/auth/refresh'),
      );
      expect(refreshCalls).toHaveLength(1);
      // ...and it sends no body: the cookie is the credential.
      expect((refreshCalls[0]![1] as RequestInit).body).toBeUndefined();
      const retryInit = fetchMock.mock.calls[2]![1] as RequestInit;
      expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer NEW');
    });

    it('still refreshes when the Web Locks API is unavailable', async () => {
      setAccessToken('OLD');
      expect((globalThis.navigator as { locks?: unknown }).locks).toBeUndefined();
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
        .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'NEW', refreshToken: 'RRR2' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      await expect(apiRequest('/locations')).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it('allows a new refresh after the previous one settles', async () => {
    setAccessToken('OLD');
    let issued = 0;
    // Each issued access token is accepted exactly once, then "expires" — so the
    // second request 401s too and must be able to trigger a fresh refresh.
    let validToken: string | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        issued += 1;
        validToken = `NEW${issued}`;
        return Promise.resolve(
          jsonResponse(200, { accessToken: validToken, refreshToken: `RRR${issued}` }),
        );
      }
      const headers = ((init as RequestInit).headers ?? {}) as Record<string, string>;
      if (validToken !== null && headers.Authorization === `Bearer ${validToken}`) {
        validToken = null;
        return Promise.resolve(jsonResponse(200, { ok: true }));
      }
      return Promise.resolve(jsonResponse(401, { message: 'Token expired' }));
    });

    await expect(apiRequest('/locations')).resolves.toEqual({ ok: true });
    await expect(apiRequest('/classes')).resolves.toEqual({ ok: true });

    const refreshCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(2);
  });
});
