import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
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
