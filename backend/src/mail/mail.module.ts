import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ConsoleMailService } from './console-mail.service';
import { MailService } from './mail.service';
import { SmtpMailService } from './smtp-mail.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    ConsoleMailService,
    SmtpMailService,
    {
      provide: MailService,
      inject: [ConfigService, ConsoleMailService, SmtpMailService],
      useFactory: (
        config: ConfigService,
        consoleSvc: ConsoleMailService,
        smtpSvc: SmtpMailService,
      ): MailService => {
        const transport = (config.get<string>('MAIL_TRANSPORT') ?? 'console').toLowerCase();
        const isProd = (config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production';
        if (isProd && transport !== 'smtp') {
          throw new Error(
            `MAIL_TRANSPORT=${transport} is not permitted in production. Set MAIL_TRANSPORT=smtp.`,
          );
        }
        return transport === 'smtp' ? smtpSvc : consoleSvc;
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
