import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, type Trainee } from '@prisma/client';
import { backfillFutureSessions } from '@/attendances/attendance-backfill';
import { createCourseFees, deleteUnpaidCourseFees } from '@/fees/course-fee-sync';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { assertTraineeLedgerEmpty } from '@/common/ledger-guards';
import { connectMany, isUniqueConstraintError, setMany } from '@/common/prisma-relations';
import { searchVariants } from '@/common/search-variants';
import { assertClassIds, assertGuardianUserIds, assertLocationIds } from '@/common/tenant-guards';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateTraineeDto } from './dto/create-trainee.dto';
import type { UpdateTraineeDto } from './dto/update-trainee.dto';

const MIN_ADULT_AGE = 18;

export interface TraineeListFilters {
  search?: string;
}

@Injectable()
export class TraineesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(
    tenantId: string,
    user: AuthenticatedUser,
    pagination?: PaginationInput,
    filters?: TraineeListFilters,
  ): Promise<PaginatedResult<Trainee>> {
    // The search clause goes in `AND`, so it narrows the location scope rather than replacing it.
    const search = searchVariants(filters?.search ?? '');
    const where: Prisma.TraineeWhereInput = {
      tenantId,
      ...(await this.scope.locationsWhere(user, tenantId)),
      ...(search.length > 0
        ? {
            AND: [
              {
                OR: search.flatMap((v) => [
                  { email: { contains: v } },
                  { firstName: { contains: v } },
                  { lastName: { contains: v } },
                ]),
              },
            ],
          }
        : {}),
    };
    const p = normalizePagination(pagination);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trainee.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.trainee.count({ where }),
    ]);
    return buildPaginatedResult(items, total, p);
  }

  async findById(tenantId: string, id: string, user: AuthenticatedUser) {
    const trainee = await this.prisma.trainee.findFirst({
      where: {
        id,
        tenantId,
        ...(await this.scope.locationsWhere(user, tenantId)),
      },
      include: {
        contacts: true,
        locations: true,
        classes: true,
        guardians: { select: { id: true, firstName: true, lastName: true, email: true } },
        user: { select: { id: true, email: true } },
      },
    });
    if (!trainee) throw new NotFoundException(`Trainee ${id} not found`);
    return trainee;
  }

  // --- customer-facing list ---

  // Read-only list for the customer portal: the trainees the customer owns
  // (`Trainee.userId === customer.id`, an adult learner's own record) or guards
  // (`Trainee.guardians[]` includes customer) — same ownership rule as fees/sessions/cards.
  // Each trainee's classes travel with it, so the portal's "Деца"/"Класове" tabs both read off
  // this one call: a trainee with no classes yet (not enrolled) still appears, with `classes: []`
  // — the family can see it is linked even before there is anything else to show about it.
  listForCustomer(tenantId: string, customerUserId: string) {
    return this.prisma.trainee.findMany({
      where: {
        tenantId,
        OR: [
          { userId: customerUserId },
          { guardians: { some: { id: customerUserId } } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        classes: { select: { id: true, name: true, description: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async create(
    tenantId: string,
    dto: CreateTraineeDto,
    user: AuthenticatedUser,
  ): Promise<Trainee> {
    const dob = new Date(dto.dateOfBirth);
    const contacts = dto.contacts ?? [];
    if (calculateAge(dob) < MIN_ADULT_AGE && contacts.length === 0) {
      throw new BadRequestException({
        message: 'At least one contact person is required for trainees under 18',
        code: 'TRAINEE_MINOR_NEEDS_CONTACT',
      });
    }

    await assertLocationIds(this.prisma, tenantId, dto.locationIds);
    await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await assertClassIds(this.prisma, tenantId, dto.classIds);
    await assertGuardianUserIds(this.prisma, tenantId, dto.guardianUserIds);
    if (dto.userId) await this.assertCustomerUserId(tenantId, dto.userId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const trainee = await tx.trainee.create({
          data: {
            tenantId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            dateOfBirth: dob,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            notes: dto.notes ?? null,
            userId: dto.userId ?? null,
            locations: connectMany(dto.locationIds),
            classes: connectMany(dto.classIds),
            guardians: connectMany(dto.guardianUserIds),
            contacts: contacts.length
              ? {
                  create: contacts.map((c) => ({
                    tenantId,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    relationship: c.relationship,
                    phone: c.phone ?? null,
                    email: c.email ?? null,
                    isPrimary: c.isPrimary ?? false,
                  })),
                }
              : undefined,
          },
        });
        // New enrolment must appear on each class's upcoming sessions.
        for (const classId of dto.classIds ?? []) {
          await backfillFutureSessions(tx, { tenantId, classId, traineeIds: [trainee.id] });
          // TKT-0110: enrolling into a course class bills it in the same tx.
          await createCourseFees(tx, { tenantId, classId, traineeIds: [trainee.id] });
        }
        return trainee;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: 'That user is already linked to another trainee',
          code: 'TRAINEE_USER_ALREADY_LINKED',
        });
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTraineeDto,
    user: AuthenticatedUser,
  ): Promise<Trainee> {
    const existing = await this.findById(tenantId, id, user);

    await assertLocationIds(this.prisma, tenantId, dto.locationIds);
    await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await assertClassIds(this.prisma, tenantId, dto.classIds);
    await assertGuardianUserIds(this.prisma, tenantId, dto.guardianUserIds);
    if (typeof dto.userId === 'string') await this.assertCustomerUserId(tenantId, dto.userId);

    // TKT-0123: `set` replaces the whole relation, so what LEAVES needs checking too. Unenrolling
    // from a class also runs deleteUnpaidCourseFees, so this is the other hall's money as well as
    // its roster. Guardians are deliberately absent: they are scoped by ownership, not location.
    if (dto.locationIds !== undefined) {
      await this.scope.assertLocationRemovalsAllowed(
        user,
        tenantId,
        existing.locations.map((l) => l.id),
        dto.locationIds,
      );
    }
    if (dto.classIds !== undefined) {
      await this.scope.assertRemovalsAllowed(
        user,
        tenantId,
        existing.classes.map((c) => c.id),
        dto.classIds,
        (removed, allowed) =>
          this.prisma.class.count({
            where: {
              id: { in: removed },
              tenantId,
              locations: { some: {} },
              NOT: { locations: { some: { id: { in: allowed } } } },
            },
          }),
        'classes',
      );
    }

    const data: Prisma.TraineeUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.notes !== undefined) data.notes = dto.notes ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.userId !== undefined) {
      data.user = dto.userId === null ? { disconnect: true } : { connect: { id: dto.userId } };
    }
    if (dto.locationIds !== undefined) data.locations = setMany(dto.locationIds);
    if (dto.classIds !== undefined) data.classes = setMany(dto.classIds);
    if (dto.guardianUserIds !== undefined) data.guardians = setMany(dto.guardianUserIds);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // TKT-0110: the course-fee diff needs the pre-update class set.
        const beforeClasses =
          dto.classIds !== undefined
            ? (
                await tx.trainee.findUniqueOrThrow({
                  where: { id },
                  select: { classes: { select: { id: true } } },
                })
              ).classes.map((c) => c.id)
            : [];
        const updated = await tx.trainee.update({ where: { id }, data });
        // A changed class set must put this trainee onto each class's upcoming sessions.
        if (dto.classIds !== undefined) {
          const before = new Set(beforeClasses);
          const after = new Set(dto.classIds);
          for (const classId of dto.classIds) {
            await backfillFutureSessions(tx, { tenantId, classId, traineeIds: [id] });
            if (!before.has(classId)) {
              await createCourseFees(tx, { tenantId, classId, traineeIds: [id] });
            }
          }
          for (const classId of beforeClasses.filter((cid) => !after.has(cid))) {
            await deleteUnpaidCourseFees(tx, { tenantId, classId, traineeIds: [id] });
          }
        }
        return updated;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: 'That user is already linked to another trainee',
          code: 'TRAINEE_USER_ALREADY_LINKED',
        });
      }
      throw e;
    }
  }

  async delete(tenantId: string, id: string, user: AuthenticatedUser): Promise<void> {
    await this.findById(tenantId, id, user);
    // Fee.trainee cascades, and Payment/Refund cascade from the fee — so without this the delete
    // takes everything the club collected from this person. `isActive: false` is the safe route.
    await assertTraineeLedgerEmpty(this.prisma, tenantId, id);
    await this.prisma.trainee.delete({ where: { id } });
  }

  private async assertCustomerUserId(tenantId: string, id: string): Promise<void> {
    const found = await this.prisma.user.count({
      where: { id, memberships: { some: { tenantId, role: UserRole.CUSTOMER } } },
    });
    if (found !== 1) {
      throw new BadRequestException('userId must reference a CUSTOMER user in your tenant');
    }
  }

}


export function calculateAge(dateOfBirth: Date, on: Date = new Date()): number {
  let age = on.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = on.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age;
}
