import type { Prisma } from '@prisma/client';

export interface TraineeRecipients {
  traineeName: string;
  emails: string[];
}

/**
 * Who gets waitlist mail for a trainee (TKT-0113 rule, shared with TKT-0114): the linked
 * account's email when one exists, otherwise every contact person with an address; an
 * empty list means "skip the mail" — never "block the booking".
 */
export async function traineeRecipients(
  db: Prisma.TransactionClient,
  traineeId: string,
): Promise<TraineeRecipients> {
  const trainee = await db.trainee.findUniqueOrThrow({
    where: { id: traineeId },
    select: {
      firstName: true,
      lastName: true,
      user: { select: { email: true } },
      contacts: { select: { email: true } },
    },
  });
  const emails = trainee.user
    ? [trainee.user.email]
    : trainee.contacts.map((c) => c.email).filter((e): e is string => e !== null);
  return { traineeName: `${trainee.firstName} ${trainee.lastName}`, emails };
}
