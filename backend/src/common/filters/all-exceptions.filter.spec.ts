import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
} from '@nestjs/common';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter';

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
