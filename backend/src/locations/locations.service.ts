import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Location } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateLocationDto } from './dto/create-location.dto';
import type { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(tenantId: string, user: AuthenticatedUser): Promise<Location[]> {
    const allowedIds = await this.scope.getAccessibleLocationIds(user, tenantId);
    return this.prisma.location.findMany({
      where: {
        tenantId,
        ...(allowedIds === null ? {} : { id: { in: allowedIds } }),
      },
      orderBy: { name: 'asc' },
      take: DEFAULT_LIST_TAKE,
    });
  }

  async findById(tenantId: string, id: string, user: AuthenticatedUser): Promise<Location> {
    const allowedIds = await this.scope.getAccessibleLocationIds(user, tenantId);
    if (allowedIds !== null && !allowedIds.includes(id)) {
      throw new NotFoundException(`Location ${id} not found`);
    }
    const loc = await this.prisma.location.findFirst({ where: { id, tenantId } });
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
        throw new ConflictException(`Location "${dto.name}" already exists`);
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
        throw new ConflictException('Location name already in use');
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

function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
