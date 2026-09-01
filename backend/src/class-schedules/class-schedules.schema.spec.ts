import { DayOfWeek } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HHMM } from './dto/create-class-schedule.dto';
import {
  ClassScheduleSchema,
  DayOfWeekSchema,
  PaginatedClassScheduleSchema,
} from './class-schedules.schema';

// This module owns the codebase's one non-obvious wire format: startTime and endTime are
// "HH:MM" 24-hour wall-clock strings with no zone, not timestamps. The schema must publish the
// format and must not turn either of them into an instant.

const runtimeSchedule = {
  id: 'cs1',
  tenantId: 't1',
  classId: 'c1',
  locationId: 'l1',
  dayOfWeek: DayOfWeek.MON,
  startTime: '18:00',
  endTime: '19:30',
  isActive: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-02T09:00:00.000Z'),
};

const published = (): Record<string, { pattern?: string }> =>
  (z.toJSONSchema(ClassScheduleSchema, { io: 'output' }).properties ?? {}) as Record<
    string,
    { pattern?: string }
  >;

describe('ClassScheduleSchema', () => {
  it("declares startTime and endTime with the request DTO's HH:MM pattern", () => {
    const properties = published();
    expect(properties.startTime?.pattern).toBe(HHMM.source);
    expect(properties.endTime?.pattern).toBe(HHMM.source);
  });

  it('rejects a time the request DTO would also reject', () => {
    for (const bad of ['6pm', '25:99', '9:00', '18:00:00', '']) {
      expect(
        ClassScheduleSchema.safeParse({ ...runtimeSchedule, startTime: bad }).success,
        `startTime "${bad}" must not parse`,
      ).toBe(false);
    }
    // A Date would mean the column stopped being a wall-clock string.
    expect(
      ClassScheduleSchema.safeParse({ ...runtimeSchedule, endTime: new Date() }).success,
    ).toBe(false);
  });

  it('hands wall-clock times through without transforming them', () => {
    const parsed = ClassScheduleSchema.parse(runtimeSchedule);
    expect(parsed.startTime).toBe('18:00');
    expect(parsed.endTime).toBe('19:30');
    // The two real DateTime columns do transform; the times must not.
    expect(parsed.createdAt).toBe('2026-08-01T09:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-08-02T09:00:00.000Z');
  });

  it('rejects a schedule that lost its dayOfWeek', () => {
    const { dayOfWeek: _dropped, ...withoutDay } = runtimeSchedule;
    expect(ClassScheduleSchema.safeParse(withoutDay).success).toBe(false);
  });

  // nextSession is list()-only (class-schedules.service.ts) — create()/update()/delete()
  // return the bare row, so it must stay optional; null is a real, distinct "nothing
  // generated within the lookahead window" answer, not the same as absent.
  it('parses with nextSession absent (create/update), null, or a real session', () => {
    expect(ClassScheduleSchema.parse(runtimeSchedule).nextSession).toBeUndefined();
    expect(
      ClassScheduleSchema.parse({ ...runtimeSchedule, nextSession: null }).nextSession,
    ).toBeNull();

    const parsed = ClassScheduleSchema.parse({
      ...runtimeSchedule,
      nextSession: {
        id: 's1',
        startsAt: new Date('2026-09-08T15:00:00.000Z'),
        trainers: [{ id: 'u1', firstName: 'Tina', lastName: 'Trainer', email: 'tina@x' }],
      },
    });
    expect(parsed.nextSession).toEqual({
      id: 's1',
      startsAt: '2026-09-08T15:00:00.000Z',
      trainers: [{ id: 'u1', firstName: 'Tina', lastName: 'Trainer', email: 'tina@x' }],
    });
  });
});

describe('DayOfWeekSchema', () => {
  it('builds DayOfWeek from the Prisma enum and rejects an unknown member', () => {
    expect(DayOfWeekSchema.options).toEqual(Object.values(DayOfWeek));
    expect(DayOfWeekSchema.parse('SUN')).toBe('SUN');
    // Adding a member to schema.prisma without regenerating must not silently pass here.
    expect(DayOfWeekSchema.safeParse('CHRISTMAS').success).toBe(false);
  });
});

describe('PaginatedClassScheduleSchema', () => {
  it('uses the shared pagination envelope', () => {
    const parsed = PaginatedClassScheduleSchema.parse({
      items: [runtimeSchedule],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
      'totalPages',
    ]);
    expect(parsed.items[0]!.startTime).toBe('18:00');
  });
});
