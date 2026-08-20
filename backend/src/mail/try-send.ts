import type { Logger } from '@nestjs/common';

/**
 * Runs a mail send and reports whether it went out, instead of throwing.
 *
 * Every outgoing mail in this codebase sits outside the database write that caused it
 * (PRD-0010 §7): the row commits first, and delivery is reported rather than transacted. So
 * every call site needs the same three lines — try, log, return false — and had its own copy
 * until TKT-0063.
 *
 * `AuthService.issueInvite` deliberately does not use this: it already reports delivery and
 * never throws, so wrapping it would add a layer that can only ever return true.
 */
export async function trySend(
  logger: Logger,
  failureMessage: string,
  send: () => Promise<void>,
): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (err) {
    logger.error(failureMessage, err as Error);
    return false;
  }
}
