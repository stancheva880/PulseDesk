import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    service = module.get<PrismaService>(PrismaService);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('exposes generated model accessors', () => {
    expect(service.tenant).toBeDefined();
    expect(service.user).toBeDefined();
    expect(service.language).toBeDefined();
    expect(service.refreshToken).toBeDefined();
  });

  it('connects to the database (SELECT 1)', async () => {
    // $queryRaw returns BigInt for integer columns; coerce to Number for the assertion.
    const rows = await service.$queryRaw<Array<{ one: bigint }>>`SELECT 1 as one`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.one)).toBe(1);
  });
});
