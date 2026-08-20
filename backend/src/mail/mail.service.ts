import type {
  SendClubAccessOptions,
  SendInviteOptions,
  SendMailOptions,
  SendPasswordResetOptions,
} from './mail.types';

// Abstract MailService — concrete implementations are bound by MailModule based on
// the MAIL_TRANSPORT env. Use this token in @Inject() / constructor injection so the
// transport can be swapped (console <-> smtp) without touching call sites.
export abstract class MailService {
  abstract send(options: SendMailOptions): Promise<void>;

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

  // TKT-0058: the first thing an invited person ever receives. No password is quoted — the
  // link is how they set one, and it is single-use.
  async sendInvite(options: SendInviteOptions): Promise<void> {
    const subject = `You have been invited to PulseDesk`;
    const text = [
      `Hello,`,
      ``,
      `An account has been created for you in PulseDesk.`,
      ``,
      `Choose your password here (the link expires ${options.expiresAt.toISOString()} and works once):`,
      options.inviteUrl,
      ``,
      `If you were not expecting this, you can ignore this email — the account cannot be used until the link is opened.`,
    ].join('\n');
    return this.send({ to: options.to, subject, text });
  }

  /**
   * TKT-0061: the recipient already has a PulseDesk account and a working password. This mail
   * deliberately carries no token and no link — sending one would hand a password-setting
   * capability to a live account, which is what the invite flow exists to avoid.
   */
  async sendClubAccess(options: SendClubAccessOptions): Promise<void> {
    const subject = `You have been added to ${options.clubName} on PulseDesk`;
    const text = [
      `Hello,`,
      ``,
      `You have been given access to ${options.clubName} on PulseDesk, as ${options.role}.`,
      ``,
      `Sign in with your usual password and pick the club from the club selector.`,
      ``,
      `Your password has not changed. If you were not expecting this, contact the club.`,
    ].join('\n');
    return this.send({ to: options.to, subject, text });
  }
}
