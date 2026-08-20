import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ResponseSchemaInterceptor } from './response-schema.interceptor';

const SCHEMA = z.object({ id: z.string() });

// A value that fails SCHEMA and carries data that must never reach a log line.
const TRAINEE_NAME = 'Ivan Petrov';
const MISMATCHED = { traineeName: TRAINEE_NAME };

// `null` means an undecorated handler — the reflector finds no metadata.
function build(nodeEnv: string, schema: unknown = SCHEMA) {
  const reflector = { get: () => schema ?? undefined } as unknown as Reflector;
  const config = { get: () => nodeEnv } as unknown as ConfigService;
  const context = {
    getHandler: () => function findOne() {},
    switchToHttp: () => ({ getRequest: () => ({ method: 'GET', url: '/api/classes/c1' }) }),
  } as unknown as ExecutionContext;
  return { interceptor: new ResponseSchemaInterceptor(reflector, config), context };
}

const run = (nodeEnv: string, value: unknown, schema?: unknown): Promise<unknown> => {
  const { interceptor, context } = build(nodeEnv, schema);
  const next: CallHandler = { handle: () => of(value) };
  return firstValueFrom(interceptor.intercept(context, next));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResponseSchemaInterceptor', () => {
  it('passes an undecorated handler through untouched', async () => {
    const value = { anything: true };
    await expect(run('test', value, null)).resolves.toBe(value);
  });

  it('returns the parsed value when the response matches', async () => {
    await expect(run('test', { id: 'c1', extra: 'stripped' })).resolves.toEqual({ id: 'c1' });
  });

  it('throws outside production', async () => {
    await expect(run('test', MISMATCHED)).rejects.toThrow(/Response schema mismatch/);
  });

  it('logs and returns the unparsed value in production', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await expect(run('production', MISMATCHED)).resolves.toBe(MISMATCHED);
    expect(logged).toHaveBeenCalledOnce();
    const message = String(logged.mock.calls[0]![0]);
    expect(message).toContain('GET /api/classes/c1');
    expect(message).toContain('id');
  });

  it('never logs the received value', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await run('production', MISMATCHED);
    // issues[].received would put trainee data — or a token — into the log.
    expect(String(logged.mock.calls[0]![0])).not.toContain(TRAINEE_NAME);
  });

  it('does not name the received value in the thrown message either', async () => {
    await expect(run('test', MISMATCHED)).rejects.not.toThrow(new RegExp(TRAINEE_NAME));
  });
});
