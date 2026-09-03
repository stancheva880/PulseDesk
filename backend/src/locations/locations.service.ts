import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type Location } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { assertLocationUnused } from '@/common/ledger-guards';
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
import type { UpdateLocationPaymentDetailsDto } from './dto/update-location-payment-details.dto';

const CUSTOMER_PAYMENT_SELECT = {
  id: true,
  name: true,
  bankIban: true,
  bankAccountHolder: true,
  revolutHandle: true,
  myposLink: true,
  cashNote: true,
} as const;

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
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.location.update({ where: { id }, data: dto });
        // TKT-0126: retiring a hall stops its recurring generation. `generateSessions` already
        // filters on the schedule's own isActive, so flipping these is enough — and unlike a
        // hidden location filter in that query, it is visible on the schedules screen.
        //
        // `=== false`, not falsy: a PATCH without isActive must leave schedules alone. And it
        // fires on the request body rather than on a false transition, so re-saving repairs a
        // hall that was already inactive before this shipped with its schedules still live.
        // One-way on purpose: isActive: true re-enables nothing.
        if (dto.isActive === false) {
          await tx.classSchedule.updateMany({
            where: { locationId: id, tenantId },
            data: { isActive: false },
          });
        }
        return updated;
      });
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

  /**
   * TKT-0128: where customers send money for this location. Split from `update()` (name/
   * address/isActive) because it has its own, wider role floor — ADMIN edits this day to day,
   * unlike the rest of a location, which stays SUPER_ADMIN-only (locations.controller.ts).
   * An ADMIN is scoped to their own assigned locations, same guard `assertLocationsAllowed`
   * already gives every other ADMIN-scoped write; a SUPER_ADMIN is unrestricted.
   */
  async updatePaymentDetails(
    tenantId: string,
    id: string,
    dto: UpdateLocationPaymentDetailsDto,
    actor: AuthenticatedUser,
  ): Promise<Location> {
    const existing = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Location ${id} not found`);
    await this.scope.assertLocationsAllowed(actor, tenantId, [id]);
    return this.prisma.location.update({ where: { id }, data: dto });
  }

  // Read-only list for the customer portal's Payment details tab: the locations assigned to
  // the customer's own trainees (their own record, or a guarded child's) — same ownership
  // rule as fees/sessions/cards/trainees. Deliberately sourced from `Trainee.locations`, not
  // from Fee (a Fee carries no reliable location — see the TKT-0128 tech plan) or from
  // Class.locations (many-to-many, so a class can span locations a given trainee never
  // actually attends).
  //
  // Each location's own (possibly-null) fields win; a null one falls back to the club's
  // shared default (Tenant's own same-named columns) — the portal always gets a single
  // resolved answer per location, never has to know a location was inheriting.
  async listPaymentDetailsForCustomer(tenantId: string, customerUserId: string) {
    const [tenant, locations] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          bankIban: true,
          bankAccountHolder: true,
          revolutHandle: true,
          myposLink: true,
          cashNote: true,
        },
      }),
      this.prisma.location.findMany({
        where: {
          tenantId,
          trainees: {
            some: {
              OR: [
                { userId: customerUserId },
                { guardians: { some: { id: customerUserId } } },
              ],
            },
          },
        },
        select: CUSTOMER_PAYMENT_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);
    return locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      bankIban: loc.bankIban ?? tenant.bankIban,
      bankAccountHolder: loc.bankAccountHolder ?? tenant.bankAccountHolder,
      revolutHandle: loc.revolutHandle ?? tenant.revolutHandle,
      myposLink: loc.myposLink ?? tenant.myposLink,
      cashNote: loc.cashNote ?? tenant.cashNote,
    }));
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Location ${id} not found`);
    // After the tenant lookup, so a wrong-tenant id still answers 404 rather than revealing
    // that the hall exists and is busy.
    await assertLocationUnused(this.prisma, tenantId, id);
    await this.prisma.location.delete({ where: { id } });
  }
}

