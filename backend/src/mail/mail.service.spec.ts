import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ConsoleMailService } from './console-mail.service';
import { MailModule } from './mail.module';
import { MailService } from './mail.service';

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

  it('formats invite emails with subject + tenant name + invite URL', async () => {
    await service.sendInvite({
      to: 'newbie@b.com',
      tenantName: 'Demo Sports Club',
      inviteUrl: 'https://app/invite/abc',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    });
    expect(logSpy).toHaveBeenCalledOnce();
    const message = logSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain('newbie@b.com');
    expect(message).toContain('Demo Sports Club');
    expect(message).toContain('https://app/invite/abc');
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
});

describe('MailModule (transport selection)', () => {
  async function buildModule(transport: string) {
    process.env.MAIL_TRANSPORT = transport;
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), MailModule],
    }).compile();
    return moduleRef.get(MailService);
  }

  it('binds the console transport when MAIL_TRANSPORT=console', async () => {
    const svc = await buildModule('console');
    expect(svc).toBeInstanceOf(ConsoleMailService);
  });

  it('binds the console transport by default when env is unset', async () => {
    delete process.env.MAIL_TRANSPORT;
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), MailModule],
    }).compile();
    const svc = moduleRef.get(MailService);
    expect(svc).toBeInstanceOf(ConsoleMailService);
  });
});
