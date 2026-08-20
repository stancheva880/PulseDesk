import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingMode, Prisma, UserRole, type Class } from '@prisma/client';
import { backfillFutureSessions } from '@/attendances/attendance-backfill';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { connectMany, isUniqueConstraintError, setMany } from '@/common/prisma-relations';
import { searchVariants } from '@/common/search-variants';
import { assertLocationIds, assertTraineeIds, assertTrainerIds } from '@/common/tenant-guards';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateClassDto } from './dto/create-class.dto';
import type { UpdateClassDto } from './dto/update-class.dto';

export interface ClassListFilters {
  isActive?: boolean;
  search?: string;
}

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  // Build the tenant + role-scoped where clause shared by list() and findById().
  // EMPLOYEE (trainer) is scoped to classes they teach, plus classes of any session they're a
  // trainer on (so substitute sessions still resolve their class). ADMIN is location-scoped.
  private async scopedWhere(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<Prisma.ClassWhereInput> {
    if (user.role === UserRole.EMPLOYEE) {
      return {
        tenantId,
        OR: [
          { trainers: { some: { id: user.id } } },
          { sessions: { some: { trainers: { some: { id: user.id } } } } },
        ],
      };
    }
    return {
      tenantId,
      ...(await this.scope.locationsWhere(user, tenantId)),
    };
  }

  async list(
    tenantId: string,
    user: AuthenticatedUser,
    pagination?: PaginationInput,
    filters?: ClassListFilters,
  ): Promise<PaginatedResult<Class>> {
    // The filter sits on top of the scoped where rather than inside scopedWhere(), which
    // findById() shares: reading one class by id must not depend on whether it is active.
    // The search clause goes in `AND` so it narrows the scoped where instead of replacing any
    // part of it — same rule as GET /users and GET /trainees.
    const search = searchVariants(filters?.search ?? '');
    const where: Prisma.ClassWhereInput = {
      ...(await this.scopedWhere(tenantId, user)),
      ...(filters?.isActive === undefined ? {} : { isActive: filters.isActive }),
      ...(search.length > 0
        ? { AND: [{ OR: search.map((v) => ({ name: { contains: v } })) }] }
        : {}),
    };
    const p = normalizePagination(pagination);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.class.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.class.count({ where }),
    ]);
    return buildPaginatedResult(items, total, p);
  }

  async findById(tenantId: string, id: string, user: AuthenticatedUser) {
    const cls = await this.prisma.class.findFirst({
      where: { id, ...(await this.scopedWhere(tenantId, user)) },
      include: {
        locations: { select: { id: true, name: true } },
        trainers: { select: { id: true, firstName: true, lastName: true, email: true } },
        trainees: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!cls) throw new NotFoundException(`Class ${id} not found`);
    return cls;
  }

  async create(tenantId: string, dto: CreateClassDto, user: AuthenticatedUser): Promise<Class> {
    this.assertCreateBillingConsistent(dto);

    await assertLocationIds(this.prisma, tenantId, dto.locationIds);
    await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await assertTrainerIds(this.prisma, tenantId, dto.trainerIds);
    await assertTraineeIds(this.prisma, tenantId, dto.traineeIds);

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
        throw new ConflictException({
          message: `Class "${dto.name}" already exists`,
          code: 'CLASS_NAME_TAKEN',
          params: { name: dto.name },
        });
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateClassDto,
    user: AuthenticatedUser,
  ): Promise<Class> {
    const existing = await this.findById(tenantId, id, user);

    if (dto.monthlyAmount !== undefined && existing.billingMode !== BillingMode.PER_MONTH) {
      throw new BadRequestException({
        message: 'monthlyAmount is only valid on PER_MONTH classes',
        code: 'CLASS_MONTHLY_ONLY_PER_MONTH',
      });
    }
    if (dto.sessionPrice !== undefined && existing.billingMode !== BillingMode.PER_SESSION) {
      throw new BadRequestException({
        message: 'sessionPrice is only valid on PER_SESSION classes',
        code: 'CLASS_SESSION_PRICE_ONLY_PER_SESSION',
      });
    }

    await assertLocationIds(this.prisma, tenantId, dto.locationIds);
    await this.scope.assertLocationsAllowed(user, tenantId, dto.locationIds ?? []);
    await assertTrainerIds(this.prisma, tenantId, dto.trainerIds);
    await assertTraineeIds(this.prisma, tenantId, dto.traineeIds);

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
        throw new ConflictException({
          message: 'Class name already in use',
          code: 'CLASS_NAME_IN_USE',
        });
      }
      throw e;
    }
  }

  async delete(tenantId: string, id: string, user: AuthenticatedUser): Promise<void> {
    await this.findById(tenantId, id, user);
    await this.prisma.class.delete({ where: { id } });
  }

  private assertCreateBillingConsistent(dto: CreateClassDto): void {
    if (dto.billingMode === BillingMode.PER_MONTH) {
      if (dto.monthlyAmount == null) {
        throw new BadRequestException({
          message: 'monthlyAmount is required when billingMode is PER_MONTH',
          code: 'CLASS_MONTHLY_REQUIRED',
        });
      }
      if (dto.sessionPrice != null) {
        throw new BadRequestException({
          message: 'sessionPrice must be omitted when billingMode is PER_MONTH',
          code: 'CLASS_SESSION_PRICE_FORBIDDEN',
        });
      }
    } else {
      if (dto.sessionPrice == null) {
        throw new BadRequestException({
          message: 'sessionPrice is required when billingMode is PER_SESSION',
          code: 'CLASS_SESSION_PRICE_REQUIRED',
        });
      }
      if (dto.monthlyAmount != null) {
        throw new BadRequestException({
          message: 'monthlyAmount must be omitted when billingMode is PER_SESSION',
          code: 'CLASS_MONTHLY_FORBIDDEN',
        });
      }
    }
  }

}

