import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DayOfWeek, Prisma, type ClassSchedule } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import { endOfDayLocal, startOfDayLocal } from '@/common/dates';
import type { GenerateResult } from '@/common/generate-result';
import { assertClassInTenant, assertLocationInTenant } from '@/common/tenant-guards';
import { SessionsService } from '@/sessions/sessions.service';
import type { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import type { GenerateSessionsDto } from './dto/generate-sessions.dto';
import type { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';

// Standard JS Date.getDay(): Sunday=0 ... Saturday=6.
const JS_DAY_TO_ENUM: DayOfWeek[] = [
  DayOfWeek.SUN,
  DayOfWeek.MON,
  DayOfWeek.TUE,
  DayOfWeek.WED,
  DayOfWeek.THU,
  DayOfWeek.FRI,
  DayOfWeek.SAT,
];

@Injectable()
export class ClassSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(
    tenantId: string,
    user: AuthenticatedUser,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<ClassSchedule>> {
    const where = {
      tenantId,
      ...(await this.scope.locationWhere(user, tenantId)),
    };
    const p = normalizePagination(pagination);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.classSchedule.findMany({
        where,
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.classSchedule.count({ where }),
    ]);
    return buildPaginatedResult(items, total, p);
  }

  async findById(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<ClassSchedule> {
    const sched = await this.prisma.classSchedule.findFirst({
      where: {
        id,
        tenantId,
        ...(await this.scope.locationWhere(user, tenantId)),
      },
    });
    if (!sched) throw new NotFoundException(`ClassSchedule ${id} not found`);
    return sched;
  }

  async create(
    tenantId: string,
    dto: CreateClassScheduleDto,
    user: AuthenticatedUser,
  ): Promise<ClassSchedule> {
    assertTimeOrder(dto.startTime, dto.endTime);
    await assertClassInTenant(this.prisma, tenantId, dto.classId);
    await assertLocationInTenant(this.prisma, tenantId, dto.locationId);
    await this.scope.assertLocationsAllowed(user, tenantId, [dto.locationId]);

    return this.prisma.classSchedule.create({
      data: {
        tenantId,
        classId: dto.classId,
        locationId: dto.locationId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateClassScheduleDto,
    user: AuthenticatedUser,
  ): Promise<ClassSchedule> {
    const existing = await this.findById(tenantId, id, user);
    const newStart = dto.startTime ?? existing.startTime;
    const newEnd = dto.endTime ?? existing.endTime;
    assertTimeOrder(newStart, newEnd);

    if (dto.locationId !== undefined) {
      await assertLocationInTenant(this.prisma, tenantId, dto.locationId);
      await this.scope.assertLocationsAllowed(user, tenantId, [dto.locationId]);
    }

    const data: Prisma.ClassScheduleUpdateInput = {};
    if (dto.locationId !== undefined) data.location = { connect: { id: dto.locationId } };
    if (dto.dayOfWeek !== undefined) data.dayOfWeek = dto.dayOfWeek;
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.classSchedule.update({ where: { id }, data });
  }

  async delete(tenantId: string, id: string, user: AuthenticatedUser): Promise<void> {
    await this.findById(tenantId, id, user);
    await this.prisma.classSchedule.delete({ where: { id } });
  }

  // --- Generate concrete Sessions from active schedules over a date range ---
  async generateSessions(
    tenantId: string,
    dto: GenerateSessionsDto,
    user: AuthenticatedUser,
  ): Promise<GenerateResult> {
    const fromDate = parseDateOnly(dto.from);
    const toDate = parseDateOnly(dto.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('from/to must be valid YYYY-MM-DD dates');
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from must be ≤ to');
    }

    const schedules = await this.prisma.classSchedule.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(dto.classId ? { classId: dto.classId } : {}),
        ...(await this.scope.locationWhere(user, tenantId)),
      },
    });
    if (schedules.length === 0) return { created: 0, skipped: 0 };

    // Bulk-load existing sessions in the range (one query, then in-memory dedup).
    const rangeStart = startOfDayLocal(fromDate);
    const rangeEnd = endOfDayLocal(toDate);
    const existing = await this.prisma.session.findMany({
      where: {
        tenantId,
        startsAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { classId: true, locationId: true, startsAt: true },
    });
    const existingKeys = new Set(
      existing.map((s) => dedupKey(s.classId, s.locationId, s.startsAt)),
    );

    // Build the candidate (schedule, date) pairs.
    const candidates: Array<{
      schedule: ClassSchedule;
      startsAt: Date;
      endsAt: Date;
    }> = [];
    for (const schedule of schedules) {
      for (let d = new Date(fromDate); d.getTime() <= toDate.getTime(); d = addDays(d, 1)) {
        if (JS_DAY_TO_ENUM[d.getDay()] !== schedule.dayOfWeek) continue;
        candidates.push({
          schedule,
          startsAt: combineDateAndTime(d, schedule.startTime),
          endsAt: combineDateAndTime(d, schedule.endTime),
        });
      }
    }

    let created = 0;
    let skipped = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const c of candidates) {
        const key = dedupKey(c.schedule.classId, c.schedule.locationId, c.startsAt);
        if (existingKeys.has(key)) {
          skipped++;
          continue;
        }
        await this.sessions.createInTransaction(tx, {
          tenantId,
          classId: c.schedule.classId,
          locationId: c.schedule.locationId,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          // trainerIds undefined → defaults to class.trainers (per memory decision).
        });
        existingKeys.add(key); // prevent duplicates within this batch
        created++;
      }
    });

    return { created, skipped };
  }

}

function assertTimeOrder(start: string, end: string): void {
  if (toMinutes(start) >= toMinutes(end)) {
    throw new BadRequestException({
      message: 'endTime must be after startTime',
      code: 'SCHEDULE_END_BEFORE_START',
    });
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

function combineDateAndTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function parseDateOnly(s: string): Date {
  // Treat as local date midnight to align with combineDateAndTime above.
  const d = new Date(`${s}T00:00:00`);
  return d;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dedupKey(classId: string, locationId: string, startsAt: Date): string {
  return `${classId}|${locationId}|${startsAt.toISOString()}`;
}
