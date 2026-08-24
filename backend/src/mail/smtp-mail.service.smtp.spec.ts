import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeConfigService } from '@/test-utils/fake-config';
import { startFakeSmtp, type FakeSmtp } from '@/test-utils/fake-smtp';
import { SmtpMailService } from './smtp-mail.service';

// TKT-0128: real sockets, no nodemailer mock — these two criteria are about what nodemailer
// does with the transport options, so a mock would prove nothing. The option values
// themselves are asserted in smtp-mail.service.spec.ts.
describe('SmtpMailService over a real socket', () => {
  let server: FakeSmtp;
  let service: SmtpMailService;

  const build = (port: number): SmtpMailService =>
    new SmtpMailService(
      new FakeConfigService({
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(port),
        MAIL_FROM: 'noreply@pulsedesk.test',
      }) as unknown as ConfigService,
    );

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    // The pool keeps sockets open, which would hold the Vitest fork open. Reached through the
    // private field on purpose: closing a pool is a spec concern, not a MailService capability.
    (service as unknown as { transporter: Transporter | null }).transporter?.close();
    vi.restoreAllMocks();
    await server.close();
  });

  // AC #1. The bound is what matters: nodemailer's default greetingTimeout is 30s, so without
  // the configured 10s this either breaches 15s or runs the test out of time.
  it(
    'rejects within 15s when the server never sends a greeting',
    async () => {
      server = await startFakeSmtp('stall');
      service = build(server.port);

      const startedAt = Date.now();
      await expect(
        service.send({ to: 'a@b.test', subject: 'Hi', text: 'Hi' }),
      ).rejects.toThrow();
      expect(Date.now() - startedAt).toBeLessThan(15_000);
    },
    20_000,
  );

  // AC #2. Without `pool: true` nodemailer builds no pool at all and every message opens its
  // own connection, so the peak here would be 20.
  it('opens at most 5 connections for 20 concurrent sends', async () => {
    server = await startFakeSmtp('accept');
    service = build(server.port);

    await Promise.all(
      Array.from({ length: 20 }, (_unused, i) =>
        service.send({ to: `to-${i}@b.test`, subject: `Subject ${i}`, text: 'Body' }),
      ),
    );

    expect(server.messages).toBe(20);
    expect(server.peakConnections).toBeLessThanOrEqual(5);
  });
});
