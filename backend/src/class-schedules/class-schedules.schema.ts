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
});

export const PaginatedClassScheduleSchema = paginatedSchema(ClassScheduleSchema);
