import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import type { AccessJwtPayload } from '../types/jwt-payload';

describe('JwtStrategy', () => {
  it('maps a JWT payload to an AuthenticatedUser', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [JwtStrategy],
    }).compile();
    const strategy = moduleRef.get(JwtStrategy);
    const payload: AccessJwtPayload = {
      sub: 'u1',
      email: 'a@b.com',
      role: UserRole.ADMIN,
      tenantId: 't1',
      type: 'access',
    };
    expect(strategy.validate(payload)).toEqual({
      id: 'u1',
      email: 'a@b.com',
      role: UserRole.ADMIN,
      tenantId: 't1',
    });
  });
});
