import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, type Trainee } from '@prisma/client';
import { backfillFutureSessions } from '@/attendances/attendance-backfill';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { calculateAge } from '@/common/age';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateTraineeDto } from './dto/create-trainee.dto';
import type { UpdateTraineeDto } from './dto/update-trainee.dto';

const MIN_ADULT_AGE = 18;

@Injectable()
export class TraineesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(tenantId: string, user?: AuthenticatedUser): Promise<Trainee[]> {
    const allowedIds = user ? await this.scope.getAccessibleLocationIds(user, tenantId) : null;
    return this.prisma.trainee.findMany({
      where: {
        tenantId,
        ...(allowedIds === null
          ? {}
          : { locations: { some: { id: { in: allowedIds } } } }),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: DEFAULT_LIST_TAKE,
    });
  }

  async findById(tenantId: string, id: string, user?: AuthenticatedUser) {
    const allowedIds = user ? await this.scope.getAccessibleLocationIds(user, tenantId) : null;
    const trainee = await this.prisma.trainee.findFirst({
      where: {
        id,
        tenantId,
        ...(allowedIds === null
          ? {}
          : { locations: { some: { id: { in: allowedIds } } } }),
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

  async create(
    tenantId: string,
    dto: CreateTraineeDto,
    user?: AuthenticatedUser,
  ): Promise<Trainee> {
    const dob = new Date(dto.dateOfBirth);
    const contacts = dto.contacts ?? [];
    if (calculateAge(dob) < MIN_ADULT_AGE && contacts.length === 0) {
      throw new BadRequestException(
        'At least one contact person is required for trainees under 18',
      );
    }

    await this.assertLocationIds(tenantId, dto.locationIds);
    if (user) await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await this.assertClassIds(tenantId, dto.classIds);
    await this.assertGuardianUserIds(tenantId, dto.guardianUserIds);
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
        }
        return trainee;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException('That user is already linked to another trainee');
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTraineeDto,
    user?: AuthenticatedUser,
  ): Promise<Trainee> {
    await this.findById(tenantId, id, user);
    const existing = await this.prisma.trainee.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Trainee ${id} not found`);

    await this.assertLocationIds(tenantId, dto.locationIds);
    if (user) await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await this.assertClassIds(tenantId, dto.classIds);
    await this.assertGuardianUserIds(tenantId, dto.guardianUserIds);
    if (typeof dto.userId === 'string') await this.assertCustomerUserId(tenantId, dto.userId);

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
        const updated = await tx.trainee.update({ where: { id }, data });
        // A changed class set must put this trainee onto each class's upcoming sessions.
        if (dto.classIds !== undefined) {
          for (const classId of dto.classIds) {
            await backfillFutureSessions(tx, { tenantId, classId, traineeIds: [id] });
          }
        }
        return updated;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException('That user is already linked to another trainee');
      }
      throw e;
    }
  }

  async delete(tenantId: string, id: string, user?: AuthenticatedUser): Promise<void> {
    await this.findById(tenantId, id, user);
    await this.prisma.trainee.delete({ where: { id } });
  }

  private async assertLocationIds(tenantId: string, ids?: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const found = await this.prisma.location.count({ where: { id: { in: ids }, tenantId } });
    if (found !== ids.length) {
      throw new BadRequestException('Some locationIds are invalid or not in your tenant');
    }
  }

  private async assertClassIds(tenantId: string, ids?: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const found = await this.prisma.class.count({ where: { id: { in: ids }, tenantId } });
    if (found !== ids.length) {
      throw new BadRequestException('Some classIds are invalid or not in your tenant');
    }
  }

  private async assertCustomerUserId(tenantId: string, id: string): Promise<void> {
    const found = await this.prisma.user.count({
      where: { id, tenantId, role: UserRole.CUSTOMER },
    });
    if (found !== 1) {
      throw new BadRequestException('userId must reference a CUSTOMER user in your tenant');
    }
  }

  private async assertGuardianUserIds(tenantId: string, ids?: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const found = await this.prisma.user.count({
      where: { id: { in: ids }, tenantId, role: UserRole.CUSTOMER },
    });
    if (found !== ids.length) {
      throw new BadRequestException('Some guardianUserIds are not customers in your tenant');
    }
  }
}

function connectMany(ids?: string[]) {
  return ids && ids.length > 0 ? { connect: ids.map((id) => ({ id })) } : undefined;
}

function setMany(ids: string[]) {
  return { set: ids.map((id) => ({ id })) };
}

function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
