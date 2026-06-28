import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setOnAuthFailure } from '@/lib/api';
import {
  clearStoredTokens,
  readStoredTokens,
  writeStoredTokens,
} from '@/lib/auth-storage';

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
    writeStoredTokens({ accessToken: 'AAA', refreshToken: 'RRR' });
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
    writeStoredTokens({ accessToken: 'AAA', refreshToken: 'RRR' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiRequest('/locations/abc', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws ApiError with the server message on non-OK', async () => {
    writeStoredTokens({ accessToken: 'AAA', refreshToken: 'RRR' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(409, { message: 'Already exists' }),
    );
    await expect(apiRequest('/locations', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'Already exists',
    });
  });

  it('refreshes once on 401 and retries the original request with the new token', async () => {
    writeStoredTokens({ accessToken: 'OLD', refreshToken: 'RRR' });
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
    expect(readStoredTokens()).toEqual({ accessToken: 'NEW', refreshToken: 'RRR2' });

    const retryInit = fetchMock.mock.calls[2]![1] as RequestInit;
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer NEW');
  });

  it('clears tokens, calls onAuthFailure, and surfaces the 401 when refresh fails', async () => {
    writeStoredTokens({ accessToken: 'OLD', refreshToken: 'RRR' });
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Refresh rejected' }));

    await expect(apiRequest('/locations')).rejects.toBeInstanceOf(ApiError);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(readStoredTokens()).toBeNull();
  });
});
