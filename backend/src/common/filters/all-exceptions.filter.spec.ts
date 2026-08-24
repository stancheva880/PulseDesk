import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
} from '@nestjs/common';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from './all-exceptions.filter';

// getClient() defaults to undefined — the DSN-less path — so every pre-TKT-0097 test
// below exercises the filter exactly as before the Sentry integration existed.
vi.mock('@sentry/nestjs', () => ({
  getClient: vi.fn(() => undefined),
  captureException: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
}));

const mockGetClient = vi.mocked(Sentry.getClient);
const mockCapture = vi.mocked(Sentry.captureException);
const mockFlush = vi.mocked(Sentry.flush);

@Controller('boom')
class BoomController {
  @Get('http')
  http(): unknown {
    throw new BadRequestException('bad input');
  }
  @Get('unknown')
  unknown(): unknown {
    throw new Error('something internal exploded with sensitive details');
  }
  @Get('coded')
  coded(): unknown {
    throw new BadRequestException({
      message: 'Payment of 10 exceeds the outstanding balance of 5 on this fee',
      code: 'FEE_PAYMENT_EXCEEDS_BALANCE',
      params: { amount: 10, balance: '5' },
    });
  }
}

async function buildApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [BoomController],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('AllExceptionsFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a structured response for HttpException', async () => {
    const res = await request(app.getHttpServer()).get('/boom/http');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      message: 'bad input',
      error: 'BadRequest',
    });
    expect(res.body.path).toBe('/boom/http');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('returns a generic 500 for unknown exceptions without leaking the stack', async () => {
    const res = await request(app.getHttpServer()).get('/boom/unknown');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      error: 'InternalServerError',
    });
    expect(JSON.stringify(res.body)).not.toContain('sensitive details');
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });

  // The client translates on `code` and interpolates `params`; `message` stays the
  // English fallback for a code the bundle has no key for.
  it('passes a code and its params through to the body', async () => {
    const res = await request(app.getHttpServer()).get('/boom/coded');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      message: 'Payment of 10 exceeds the outstanding balance of 5 on this fee',
      error: 'BadRequest',
      code: 'FEE_PAYMENT_EXCEEDS_BALANCE',
      params: { amount: 10, balance: '5' },
    });
  });

  it('omits code and params when the exception carries none', async () => {
    const res = await request(app.getHttpServer()).get('/boom/http');
    expect(res.body.code).toBeUndefined();
    expect(res.body.params).toBeUndefined();
  });
});

// TKT-0097 — errors reach Sentry only when a client exists (DSN set), only for >=500,
// and the flush that guarantees delivery on Vercel is awaited before the response.
describe('AllExceptionsFilter — Sentry capture (TKT-0097)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockGetClient.mockReset().mockReturnValue({} as ReturnType<typeof Sentry.getClient>);
    mockCapture.mockReset();
    mockFlush.mockReset().mockResolvedValue(true);
  });

  it('captures a 500 with the request method and path, and flushes with a 2000ms cap', async () => {
    const res = await request(app.getHttpServer()).get('/boom/unknown');
    expect(res.status).toBe(500);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    // toHaveBeenCalledTimes(1) above guarantees the call exists.
    const [captured, context] = mockCapture.mock.calls[0]!;
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain('something internal exploded');
    expect(context).toMatchObject({
      contexts: { request: { method: 'GET', url: '/boom/unknown' } },
    });
    expect(mockFlush).toHaveBeenCalledExactlyOnceWith(2000);
  });

  it('does not capture 4xx responses', async () => {
    await request(app.getHttpServer()).get('/boom/http').expect(400);
    await request(app.getHttpServer()).get('/boom/coded').expect(400);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('does nothing on a 500 when no Sentry client exists (DSN unset)', async () => {
    mockGetClient.mockReturnValue(undefined);
    const res = await request(app.getHttpServer()).get('/boom/unknown');
    expect(res.status).toBe(500);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('holds the 500 response until the flush settles', async () => {
    let release!: (value: boolean) => void;
    mockFlush.mockReturnValue(new Promise<boolean>((resolve) => (release = resolve)));

    let settled = false;
    const pending = request(app.getHttpServer())
      .get('/boom/unknown')
      .then((res) => {
        settled = true;
        return res;
      });

    // Give the request time to reach the filter; the response must still be held.
    await vi.waitFor(() => expect(mockFlush).toHaveBeenCalled());
    expect(settled).toBe(false);

    release(true);
    const res = await pending;
    expect(res.status).toBe(500);
  });

  it('still answers with the normal 500 body when the flush rejects (Sentry unreachable)', async () => {
    mockFlush.mockRejectedValue(new Error('network down'));
    const res = await request(app.getHttpServer()).get('/boom/unknown');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      error: 'InternalServerError',
    });
  });
});
