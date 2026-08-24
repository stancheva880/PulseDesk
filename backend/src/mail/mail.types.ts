import type { UserRole } from '@prisma/client';

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendPasswordResetOptions {
  to: string;
  resetUrl: string;
  expiresAt: Date;
}

export interface SendInviteOptions {
  to: string;
  inviteUrl: string;
  expiresAt: Date;
}

// TKT-0061: sent when an existing account gains access to another club. Carries no token and
// no URL — the recipient already has a password, so there is nothing for them to set.
export interface SendClubAccessOptions {
  to: string;
  clubName: string;
  role: UserRole;
}

// TKT-0113: sent after a FIFO_AUTO promotion books a queued trainee onto a freed spot.
export interface SendWaitlistPromotionOptions {
  to: string;
  traineeName: string;
  className: string;
  startsAt: Date;
}

// TKT-0114: a CLAIM-mode spot opened — first click on the link books it.
export interface SendWaitlistClaimOfferOptions {
  to: string;
  traineeName: string;
  className: string;
  startsAt: Date;
  claimUrl: string;
}

// TKT-0114: someone else claimed the spot; the recipient's trainee stays queued.
export interface SendWaitlistSpotFilledOptions {
  to: string;
  traineeName: string;
  className: string;
  startsAt: Date;
}
