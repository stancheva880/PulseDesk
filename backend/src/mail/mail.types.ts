export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendInviteOptions {
  to: string;
  tenantName: string;
  inviteUrl: string;
  expiresAt: Date;
}

export interface SendPasswordResetOptions {
  to: string;
  resetUrl: string;
  expiresAt: Date;
}
