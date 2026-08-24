import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * TKT-0123: refuse a delete that would take the money ledger with it.
 *
 * `Fee.class` and `Fee.trainee` cascade, and `Payment.fee` / `Refund.fee` / `Card.fee` cascade
 * from there — so one `DELETE /classes/:id` used to erase every fee, payment and refund attached
 * to that class, irreversibly and without a word. Both models already carry `isActive`, which is
 * the non-destructive way to retire one.
 *
 * The line is drawn at *collected* money, not at any fee: a fee nobody has paid is a billing
 * intention, and deleting it loses nothing a generator cannot rebuild. A payment or a refund is a
 * record of cash that moved, and nothing can rebuild that. Same principle as
 * PaymentsService.delete and RefundsService.delete, which already refuse to leave the ledger in a
 * state it cannot express — applied one level up, to the row the fees hang off.
 */
// Not `as const`: Prisma's generated filter wants a mutable FeeWhereInput[] for `OR`.
const HAS_SETTLED_MONEY: Prisma.FeeListRelationFilter = {
  some: { OR: [{ payments: { some: {} } }, { refunds: { some: {} } }] },
};

export async function assertClassLedgerEmpty(
  prisma: PrismaService,
  tenantId: string,
  classId: string,
): Promise<void> {
  const blocked = await prisma.class.count({
    where: { id: classId, tenantId, fees: HAS_SETTLED_MONEY },
  });
  if (blocked) {
    throw new ConflictException({
      message:
        'This class has fees with recorded payments or refunds. Deactivate it instead, or remove the payments first.',
      code: 'CLASS_HAS_PAYMENTS',
    });
  }
}

/**
 * TKT-0124: the same principle as the two guards above — refuse a delete whose cascade destroys
 * records nothing can rebuild — applied to a Location, where the records are history rather than
 * money.
 *
 * `Session.location` and `ClassSchedule.location` cascade, and `Attendance.session` then
 * `CardConsumption.attendance` cascade from there. So one `DELETE /locations/:id` used to erase
 * every session ever held at a hall together with its attendance, and because a card's remaining
 * balance is derived from `CardConsumption` rows, dropping those **returns the spent visits** —
 * value created from nothing, with no ledger row recording it.
 *
 * The line is "any session or any schedule", not "any attendance or any payment". One count each,
 * no edge cases, and nothing — attendance, card visit, waitlist entry or per-session fee — can
 * slip through behind it. A hall that never hosted or scheduled anything is unused and still
 * deletes, so fixing a mistyped name keeps working. `Location.isActive` is the non-destructive
 * way to retire one that is in use.
 */
export async function assertLocationUnused(
  prisma: PrismaService,
  tenantId: string,
  locationId: string,
): Promise<void> {
  const [sessions, schedules] = await prisma.$transaction([
    prisma.session.count({ where: { locationId, tenantId } }),
    prisma.classSchedule.count({ where: { locationId, tenantId } }),
  ]);
  if (sessions || schedules) {
    throw new ConflictException({
      message: `This location has ${sessions} session(s) and ${schedules} schedule(s). Deactivate it instead, or move them to another location first.`,
      code: 'LOCATION_IN_USE',
      params: { sessions, schedules },
    });
  }
}

export async function assertTraineeLedgerEmpty(
  prisma: PrismaService,
  tenantId: string,
  traineeId: string,
): Promise<void> {
  const blocked = await prisma.trainee.count({
    where: { id: traineeId, tenantId, fees: HAS_SETTLED_MONEY },
  });
  if (blocked) {
    throw new ConflictException({
      message:
        'This trainee has fees with recorded payments or refunds. Deactivate them instead, or remove the payments first.',
      code: 'TRAINEE_HAS_PAYMENTS',
    });
  }
}
