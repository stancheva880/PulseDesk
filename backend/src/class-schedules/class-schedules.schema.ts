import { DayOfWeek } from '@prisma/client';
import { z } from 'zod';
import { isoDate, paginatedSchema } from '@/common/response-schema';
import { HHMM } from './dto/create-class-schedule.dto';

// The recurring-slot contract. Two things here are unlike every other module in this epic:
//
// 1. startTime and endTime are "HH:MM" 24-hour wall-clock strings with no zone — the generation
//    logic interprets them against a date. They are declared with the same pattern the request
//    DTO enforces and carry NO transform: turning either into a Date or an instant would be a
//    bug, not a serialization.
// 2. There is no Decimal and no relation in any class-schedule response, so isoDate on the two
//    real DateTime columns is the only transform the module needs.
//
// openapi-typescript cannot express a patterned string, so the generated frontend type is
// `string`. The pattern's value is the published contract plus this runtime parse.

/** The single declaration of the day union, derived from schema.prisma. */
export const DayOfWeekSchema = z.enum(DayOfWeek);

const hhmm = z.string().regex(HHMM);

// Same trainer-ref shape sessions.schema.ts declares — kept local rather than shared across
// sibling feature modules for one small object.
const TrainerRefSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string(),
});

export const ClassScheduleSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  classId: z.string(),
  locationId: z.string(),
  dayOfWeek: DayOfWeekSchema,
  startTime: hhmm,
  endTime: hhmm,
  isActive: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
  // List rows only (class-schedules.service.ts's list()). A template has no trainer of its
  // own — this is the soonest not-yet-started session the slot has actually generated, so an
  // admin can open and change its trainer without leaving the schedules table. null when
  // nothing matches within the lookahead window; undefined on create/update/delete, which
  // return the bare row.
  nextSession: z
    .object({
      id: z.string(),
      startsAt: isoDate,
      trainers: z.array(TrainerRefSchema),
    })
    .nullable()
    .optional(),
});

export const PaginatedClassScheduleSchema = paginatedSchema(ClassScheduleSchema);
