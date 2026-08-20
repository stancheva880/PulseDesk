import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ConsoleMailService } from './console-mail.service';

describe('ConsoleMailService', () => {
  let service: ConsoleMailService;
  let logSpy: MockInstance;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ConsoleMailService],
    }).compile();
    service = moduleRef.get(ConsoleMailService);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs the outgoing mail to the Nest logger', async () => {
    await service.send({ to: 'a@b.com', subject: 'Hello', text: 'Hi there' });
    expect(logSpy).toHaveBeenCalledOnce();
    const message = logSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain('a@b.com');
    expect(message).toContain('Hello');
    expect(message).toContain('Hi there');
  });

  it('formats password-reset emails with the reset URL and expiry', async () => {
    await service.sendPasswordReset({
      to: 'user@example.com',
      resetUrl: 'https://app/reset-password/raw-token-xyz',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    });
    expect(logSpy).toHaveBeenCalledOnce();
    const message = logSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain('user@example.com');
    expect(message).toContain('Reset your PulseDesk password');
    expect(message).toContain('https://app/reset-password/raw-token-xyz');
    expect(message).toContain('2026-12-01T00:00:00');
  });

  // TKT-0061: the recipient already has a password. Carrying a link here would hand a
  // password-setting capability to a live account, which is the whole point of not sending one.
  it('formats club-access emails with the club and role, and no link', async () => {
    await service.sendClubAccess({
      to: 'member@example.com',
      clubName: 'Sofia Swim Club',
      role: UserRole.EMPLOYEE,
    });
    expect(logSpy).toHaveBeenCalledOnce();
    const message = logSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain('member@example.com');
    expect(message).toContain('Sofia Swim Club');
    expect(message).toContain('EMPLOYEE');
    expect(message).not.toContain('http');
    expect(message).not.toContain('/accept-invite/');
    expect(message).not.toContain('/reset-password/');
  });
});
