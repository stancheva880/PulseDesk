import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect } from 'vitest';
import { MailModule } from './mail.module';
import { MailService } from './mail.service';
import { ConsoleMailService } from './console-mail.service';
import { SmtpMailService } from './smtp-mail.service';

class FakeConfigService {
  constructor(private readonly values: Record<string, string>) {}
  get<T>(key: string): T | undefined {
    return this.values[key] as unknown as T | undefined;
  }
}

async function build(env: Record<string, string>): Promise<MailService> {
  const module = await Test.createTestingModule({
    imports: [MailModule],
  })
    .overrideProvider(ConfigService)
    .useValue(new FakeConfigService(env))
    .compile();
  return module.get(MailService);
}

describe('MailModule factory', () => {
  it('selects ConsoleMailService when MAIL_TRANSPORT=console outside production', async () => {
    const svc = await build({ MAIL_TRANSPORT: 'console', NODE_ENV: 'development' });
    expect(svc).toBeInstanceOf(ConsoleMailService);
  });

  it('selects SmtpMailService when MAIL_TRANSPORT=smtp', async () => {
    const svc = await build({ MAIL_TRANSPORT: 'smtp', NODE_ENV: 'production' });
    expect(svc).toBeInstanceOf(SmtpMailService);
  });

  it('throws when NODE_ENV=production and MAIL_TRANSPORT is not smtp', async () => {
    await expect(build({ MAIL_TRANSPORT: 'console', NODE_ENV: 'production' })).rejects.toThrow(
      /not permitted in production/,
    );
  });

  it('throws when NODE_ENV=production and MAIL_TRANSPORT is unset (defaults to console)', async () => {
    await expect(build({ NODE_ENV: 'production' })).rejects.toThrow(/not permitted in production/);
  });
});
