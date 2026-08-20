import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { FakeConfigService } from '@/test-utils/fake-config';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = module.get<HealthController>(HealthController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns ok status with service name and timestamp', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('pulsedesk-backend');
    expect(typeof result.timestamp).toBe('string');
    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});

// Added by TKT-0051. The tests above call check() directly, so they never run the interceptor
// and would not notice a wrong response schema — on the one endpoint container startup depends on.
describe('HealthController over HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ConfigService, useValue: new FakeConfigService({}) }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(
      new ResponseSchemaInterceptor(app.get(Reflector), app.get(ConfigService)),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers over HTTP with a body that satisfies the schema', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'timestamp']);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('pulsedesk-backend');
    // The timestamp reaches the wire as an ISO string, not as a serialized Date object.
    expect(res.body.timestamp).toBe(new Date(res.body.timestamp).toISOString());
  });
});
