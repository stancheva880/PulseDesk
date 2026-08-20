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
