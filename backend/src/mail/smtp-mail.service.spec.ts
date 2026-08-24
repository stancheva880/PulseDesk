import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeConfigService } from '@/test-utils/fake-config';
import { SmtpMailService } from './smtp-mail.service';

// TKT-0128: the two criteria that are about *what reaches nodemailer* are proved here, with
// nodemailer mocked. What nodemailer then does with those options (gives up on a dead host,
// caps its connections) needs real sockets and lives in smtp-mail.service.smtp.spec.ts.
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue(undefined) })),
}));

const mockedCreateTransport = vi.mocked(createTransport);

function build(): SmtpMailService {
  const config = new FakeConfigService({
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    MAIL_FROM: 'noreply@pulsedesk.test',
  });
  return new SmtpMailService(config as unknown as ConfigService);
}

describe('SmtpMailService', () => {
  beforeEach(() => {
    mockedCreateTransport.mockClear();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes pool and timeout options to createTransport', async () => {
    await build().send({ to: 'a@b.test', subject: 'Hi', text: 'Hi' });

    expect(mockedCreateTransport).toHaveBeenCalledOnce();
    expect(mockedCreateTransport.mock.calls[0]![0]).toMatchObject({
      host: 'smtp.example.test',
      port: 587,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      greetingTimeout: 10_000,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  });

  // The transporter must not be built at construction time. app-setup.ts:41 depends on this —
  // boot would otherwise throw on a missing SMTP_HOST — and app-setup.spec.ts:137 asserts it.
  it('does not create a transporter until the first send', async () => {
    const service = build();
    expect(mockedCreateTransport).not.toHaveBeenCalled();

    await service.send({ to: 'a@b.test', subject: 'Hi', text: 'Hi' });
    expect(mockedCreateTransport).toHaveBeenCalledOnce();

    await service.send({ to: 'c@d.test', subject: 'Again', text: 'Again' });
    expect(mockedCreateTransport).toHaveBeenCalledOnce();
  });
});
