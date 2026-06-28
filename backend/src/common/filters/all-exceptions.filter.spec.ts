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
});
