import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type Location } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { isUniqueConstraintError } from '@/common/prisma-relations';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateLocationDto } from './dto/create-location.dto';
import type { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(
    tenantId: string,
    user: AuthenticatedUser,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<Location>> {
    const where = {
      tenantId,
      ...(await this.scope.locationWhere(user, tenantId, 'id')),
    };
    const p = normalizePagination(pagination);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.location.count({ where }),
    ]);
    return buildPaginatedResult(items, total, p);
  }

  async findById(tenantId: string, id: string, user: AuthenticatedUser): Promise<Location> {
    // AND-composed, not spread: the scope filter keys on `id` too, so spreading it
    // would clobber the requested id and match any accessible location.
    const loc = await this.prisma.location.findFirst({
      where: { AND: [{ id, tenantId }, await this.scope.locationWhere(user, tenantId, 'id')] },
    });
    if (!loc) throw new NotFoundException(`Location ${id} not found`);
    return loc;
  }

  async create(tenantId: string, dto: CreateLocationDto): Promise<Location> {
    try {
      return await this.prisma.location.create({
        data: { tenantId, name: dto.name, address: dto.address ?? null },
      });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: `Location "${dto.name}" already exists`,
          code: 'LOCATION_NAME_TAKEN',
          params: { name: dto.name },
        });
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateLocationDto): Promise<Location> {
    const existing = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Location ${id} not found`);
    try {
      return await this.prisma.location.update({ where: { id }, data: dto });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: 'Location name already in use',
          code: 'LOCATION_NAME_IN_USE',
        });
      }
      throw e;
    }
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Location ${id} not found`);
    await this.prisma.location.delete({ where: { id } });
  }
}

