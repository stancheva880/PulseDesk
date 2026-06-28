import { Injectable, Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import type { SendMailOptions } from './mail.types';

@Injectable()
export class ConsoleMailService extends MailService {
  private readonly logger = new Logger('Mail:console');

  async send(options: SendMailOptions): Promise<void> {
    this.logger.log(
      `\n────────── OUTGOING MAIL ──────────\n` +
        `To:      ${options.to}\n` +
        `Subject: ${options.subject}\n` +
        `─────────── BODY ───────────\n` +
        `${options.text}\n` +
        `────────────────────────────\n`,
    );
  }
}
