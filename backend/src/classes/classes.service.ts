import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingMode, Prisma, UserRole, type Class } from '@prisma/client';
import { backfillFutureSessions } from '@/attendances/attendance-backfill';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateClassDto } from './dto/create-class.dto';
import type { UpdateClassDto } from './dto/update-class.dto';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(tenantId: string, user?: AuthenticatedUser): Promise<Class[]> {
    const allowedIds = user ? await this.scope.getAccessibleLocationIds(user, tenantId) : null;
    return this.prisma.class.findMany({
      where: {
        tenantId,
        ...(allowedIds === null
          ? {}
          : { locations: { some: { id: { in: allowedIds } } } }),
      },
      orderBy: { name: 'asc' },
      take: DEFAULT_LIST_TAKE,
    });
  }

  async findById(tenantId: string, id: string, user?: AuthenticatedUser) {
    const allowedIds = user ? await this.scope.getAccessibleLocationIds(user, tenantId) : null;
    const cls = await this.prisma.class.findFirst({
      where: {
        id,
        tenantId,
        ...(allowedIds === null
          ? {}
          : { locations: { some: { id: { in: allowedIds } } } }),
      },
      include: {
        locations: { select: { id: true, name: true } },
        trainers: { select: { id: true, firstName: true, lastName: true, email: true } },
        trainees: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!cls) throw new NotFoundException(`Class ${id} not found`);
    return cls;
  }

  async create(tenantId: string, dto: CreateClassDto, user?: AuthenticatedUser): Promise<Class> {
    this.assertCreateBillingConsistent(dto);

    await this.assertLocationIds(tenantId, dto.locationIds);
    if (user) await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await this.assertTrainerIds(tenantId, dto.trainerIds);
    await this.assertTraineeIds(tenantId, dto.traineeIds);

    try {
      return await this.prisma.class.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description ?? null,
          billingMode: dto.billingMode,
          monthlyAmount: dto.monthlyAmount ?? null,
          sessionPrice: dto.sessionPrice ?? null,
          locations: connectMany(dto.locationIds),
          trainers: connectMany(dto.trainerIds),
          trainees: connectMany(dto.traineeIds),
        },
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException(`Class "${dto.name}" already exists`);
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateClassDto,
    user?: AuthenticatedUser,
  ): Promise<Class> {
    await this.findById(tenantId, id, user);
    const existing = await this.prisma.class.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Class ${id} not found`);

    if (dto.billingMode !== undefined && dto.billingMode !== existing.billingMode) {
      throw new BadRequestException('billingMode is immutable after class creation');
    }
    if (dto.monthlyAmount !== undefined && existing.billingMode !== BillingMode.PER_MONTH) {
      throw new BadRequestException('monthlyAmount is only valid on PER_MONTH classes');
    }
    if (dto.sessionPrice !== undefined && existing.billingMode !== BillingMode.PER_SESSION) {
      throw new BadRequestException('sessionPrice is only valid on PER_SESSION classes');
    }

    await this.assertLocationIds(tenantId, dto.locationIds);
    if (user) await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await this.assertTrainerIds(tenantId, dto.trainerIds);
    await this.assertTraineeIds(tenantId, dto.traineeIds);

    const data: Prisma.ClassUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.monthlyAmount !== undefined) data.monthlyAmount = dto.monthlyAmount;
    if (dto.sessionPrice !== undefined) data.sessionPrice = dto.sessionPrice;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.locationIds !== undefined) data.locations = setMany(dto.locationIds);
    if (dto.trainerIds !== undefined) data.trainers = setMany(dto.trainerIds);
    if (dto.traineeIds !== undefined) data.trainees = setMany(dto.traineeIds);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.class.update({ where: { id }, data });
        // Trainees added to the roster must appear on this class's upcoming sessions.
        if (dto.traineeIds !== undefined) {
          await backfillFutureSessions(tx, { tenantId, classId: id, traineeIds: dto.traineeIds });
        }
        return updated;
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException('Class name already in use');
      }
      throw e;
    }
  }

  async delete(tenantId: string, id: string, user?: AuthenticatedUser): Promise<void> {
    await this.findById(tenantId, id, user);
    await this.prisma.class.delete({ where: { id } });
  }

  private assertCreateBillingConsistent(dto: CreateClassDto): void {
    if (dto.billingMode === BillingMode.PER_MONTH) {
      if (dto.monthlyAmount == null) {
        throw new BadRequestException('monthlyAmount is required when billingMode is PER_MONTH');
      }
      if (dto.sessionPrice != null) {
        throw new BadRequestException('sessionPrice must be omitted when billingMode is PER_MONTH');
      }
    } else {
      if (dto.sessionPrice == null) {
        throw new BadRequestException('sessionPrice is required when billingMode is PER_SESSION');
      }
      if (dto.monthlyAmount != null) {
        throw new BadRequestException('monthlyAmount must be omitted when billingMode is PER_SESSION');
      }
    }
  }

  private async assertLocationIds(tenantId: string, ids?: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const found = await this.prisma.location.count({ where: { id: { in: ids }, tenantId } });
    if (found !== ids.length) {
      throw new BadRequestException('Some locationIds are invalid or not in your tenant');
    }
  }

  private async assertTrainerIds(tenantId: string, ids?: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const found = await this.prisma.user.count({
      where: { id: { in: ids }, tenantId, role: UserRole.EMPLOYEE },
    });
    if (found !== ids.length) {
      throw new BadRequestException('Some trainerIds are not employees in your tenant');
    }
  }

  private async assertTraineeIds(tenantId: string, ids?: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const found = await this.prisma.trainee.count({ where: { id: { in: ids }, tenantId } });
    if (found !== ids.length) {
      throw new BadRequestException('Some traineeIds are invalid or not in your tenant');
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
