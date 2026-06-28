import type { SendInviteOptions, SendMailOptions, SendPasswordResetOptions } from './mail.types';

// Abstract MailService — concrete implementations are bound by MailModule based on
// the MAIL_TRANSPORT env. Use this token in @Inject() / constructor injection so the
// transport can be swapped (console <-> smtp) without touching call sites.
export abstract class MailService {
  abstract send(options: SendMailOptions): Promise<void>;

  async sendInvite(options: SendInviteOptions): Promise<void> {
    const subject = `You're invited to join ${options.tenantName} on PulseDesk`;
    const text = [
      `Hello,`,
      ``,
      `You've been invited to join ${options.tenantName} on PulseDesk.`,
      ``,
      `Accept the invite (expires ${options.expiresAt.toISOString()}):`,
      options.inviteUrl,
      ``,
      `If you didn't expect this, you can ignore this email.`,
    ].join('\n');
    return this.send({ to: options.to, subject, text });
  }

  async sendPasswordReset(options: SendPasswordResetOptions): Promise<void> {
    const subject = `Reset your PulseDesk password`;
    const text = [
      `Hello,`,
      ``,
      `We received a request to reset your PulseDesk password.`,
      ``,
      `Reset it here (expires ${options.expiresAt.toISOString()}):`,
      options.resetUrl,
      ``,
      `If you didn't request this, you can safely ignore this email — your password will stay the same.`,
    ].join('\n');
    return this.send({ to: options.to, subject, text });
  }
}
