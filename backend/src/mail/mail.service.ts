import type {
  SendClubAccessOptions,
  SendInviteOptions,
  SendMailOptions,
  SendPasswordResetOptions,
  SendWaitlistClaimOfferOptions,
  SendWaitlistPromotionOptions,
  SendWaitlistSpotFilledOptions,
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

  // TKT-0113: informational only — the spot is already booked when this is sent.
  async sendWaitlistPromotion(options: SendWaitlistPromotionOptions): Promise<void> {
    const subject = `A spot opened up — ${options.traineeName} is booked`;
    const text = [
      `Hello,`,
      ``,
      `A spot freed up in ${options.className} on ${options.startsAt.toISOString()}.`,
      `${options.traineeName} was first in the waitlist and is now booked on the session.`,
      ``,
      `If the booking is not wanted, contact the club to release the spot.`,
    ].join('\n');
    return this.send({ to: options.to, subject, text });
  }

  // TKT-0114: the link is the authorization — one click books, first click wins.
  async sendWaitlistClaimOffer(options: SendWaitlistClaimOfferOptions): Promise<void> {
    const subject = `A spot opened up in ${options.className}`;
    const text = [
      `Hello,`,
      ``,
      `A spot freed up in ${options.className} on ${options.startsAt.toISOString()}, and ${options.traineeName} is on the waitlist.`,
      ``,
      `First to claim gets the spot:`,
      options.claimUrl,
      ``,
      `The link works once and stops working when the spot is taken or the session starts.`,
    ].join('\n');
    return this.send({ to: options.to, subject, text });
  }

  // TKT-0114: consolation — the trainee keeps their place in the queue.
  async sendWaitlistSpotFilled(options: SendWaitlistSpotFilledOptions): Promise<void> {
    const subject = `The spot in ${options.className} was taken`;
    const text = [
      `Hello,`,
      ``,
      `The freed spot in ${options.className} on ${options.startsAt.toISOString()} was claimed by someone else.`,
      `${options.traineeName} stays on the waitlist and you will get a new link at the next opening.`,
    ].join('\n');
    return this.send({ to: options.to, subject, text });
  }
}
