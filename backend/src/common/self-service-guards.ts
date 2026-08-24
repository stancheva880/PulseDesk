import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PrismaService } from '@/prisma/prisma.service';
import { assertBookingOpen } from './dates';

// PRD-0016's guard ladder for every customer-initiated write on a session. It lives here
// rather than in one service because two modules hold the doors — attendances (book, cancel)
// and waitlists (queue) — and the ACs require them to answer identically.

/** The family gate: a customer may only act for a trainee they own or guard. */
export async function assertOwnTrainee(
  prisma: PrismaService,
  params: { tenantId: string; traineeId: string; viewer: AuthenticatedUser; action: string },
): Promise<void> {
  const trainee = await prisma.trainee.findFirst({
    where: {
      id: params.traineeId,
      tenantId: params.tenantId,
      OR: [
        { userId: params.viewer.id },
        { guardians: { some: { id: params.viewer.id } } },
      ],
    },
    select: { id: true },
  });
  if (!trainee) {
    throw new ForbiddenException(`You may only ${params.action} for your own trainees`);
  }
}

/**
 * The full ladder for a door that *adds* the trainee to a session (booking, queueing): family,
 * session existence, the class's self-booking policy, enrollment, then the cutoff. Returns what
 * the callers need from the session so they do not read it twice.
 */
export async function assertSelfServiceAllowed(
  prisma: PrismaService,
  params: {
    tenantId: string;
    sessionId: string;
    viewer: AuthenticatedUser;
    traineeId: string;
    action: string;
    now: Date;
  },
): Promise<{ classId: string; capacity: number | null }> {
  await assertOwnTrainee(prisma, params);

  const session = await prisma.session.findFirst({
    where: { id: params.sessionId, tenantId: params.tenantId },
    select: {
      startsAt: true,
      classId: true,
      class: {
        select: {
          allowSelfBooking: true,
          bookingCutoffMin: true,
          capacity: true,
          trainees: { where: { id: params.traineeId }, select: { id: true } },
        },
      },
    },
  });
  if (!session) throw new NotFoundException(`Session ${params.sessionId} not found`);
  if (!session.class.allowSelfBooking) {
    throw new ConflictException({
      message: 'This class does not allow self-booking',
      code: 'SELF_BOOKING_DISABLED',
    });
  }
  if (session.class.trainees.length === 0) {
    throw new ConflictException({
      message: 'Trainee is not enrolled in this class',
      code: 'SELF_BOOKING_NOT_ENROLLED',
    });
  }
  assertBookingOpen(session.startsAt, session.class.bookingCutoffMin, params.now);

  return { classId: session.classId, capacity: session.class.capacity };
}
