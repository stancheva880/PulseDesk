import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { MailService } from './mail.service';
import type { SendMailOptions } from './mail.types';

@Injectable()
export class SmtpMailService extends MailService {
  private readonly logger = new Logger('Mail:smtp');
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = this.config.get<string>('SMTP_HOST');
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (!host) throw new Error('SMTP_HOST is not configured but MAIL_TRANSPORT=smtp');
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
    return this.transporter;
  }

  async send(options: SendMailOptions): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM') ?? 'noreply@pulsedesk.local';
    await this.getTransporter().sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    this.logger.log(`Sent mail to ${redactEmail(options.to)}: ${options.subject}`);
  }
}

function redactEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `***@${address.slice(at + 1)}`;
}
