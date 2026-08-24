import { BadRequestException, ConflictException } from '@nestjs/common';

// Two deliberate families — do not "unify" them:
//  * Local — club wall-clock semantics. A schedule "Monday 18:00" must generate a
//    session at 18:00 in the club's local zone, and day-of-week matching uses the
//    local calendar day. Used by session generation.
//  * Utc — absolute period boundaries for billing and reporting.

export function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function endOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

// TKT-0120: the one time rule for self-service on a session — booking, cancelling and the
// automatic waitlist backfill all read it, so they cannot disagree. A null cutoff closes at
// the start itself, which also makes every started session closed.
export function selfServiceClosed(
  startsAt: Date,
  bookingCutoffMin: number | null,
  now: Date,
): boolean {
  return now.getTime() >= startsAt.getTime() - (bookingCutoffMin ?? 0) * 60_000;
}

/**
 * The 409 face of the rule above — the customer write doors' time gate (booking, cancelling and
 * queueing all answer identically, TKT-0117..0121).
 */
export function assertBookingOpen(
  startsAt: Date,
  bookingCutoffMin: number | null,
  now: Date,
): void {
  if (selfServiceClosed(startsAt, bookingCutoffMin, now)) {
    throw new ConflictException({
      message: 'Booking for this session has closed',
      code: 'BOOKING_CLOSED',
    });
  }
}

// Shared start/end ordering guard. `strict` rejects equal endpoints (a session must
// have non-zero duration); non-strict allows them (a fee period may be a single day).
export function assertDateOrder(
  start: Date,
  end: Date,
  opts: { strict: boolean; message: string; code?: string },
): void {
  const invalid = opts.strict
    ? end.getTime() <= start.getTime()
    : end.getTime() < start.getTime();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || invalid) {
    throw new BadRequestException(
      opts.code ? { message: opts.message, code: opts.code } : opts.message,
    );
  }
}
