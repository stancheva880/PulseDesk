import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthenticatedUser } from '../types/jwt-payload';

// Centralises the location-based access checks for the two roles that have them:
//  - ADMIN and EMPLOYEE are limited to the locations assigned to them (TKT-0054).
//  - SUPER_ADMIN is never location-restricted.
//  - CUSTOMER is scoped by ownership instead (their own and their trainees' rows), so this
//    helper does not apply — location-scoping a customer would empty their portal.
//
// Sessions, classes and attendances narrow EMPLOYEE by their own work *before* reaching this
// helper (sessions.service.ts, classes.service.ts, attendances.service.ts); everything else —
// trainees, contacts, fees, payments, locations — relies on the assignment below.
@Injectable()
export class LocationScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the location IDs the user is allowed to operate on within the given tenant.
   * - SUPER_ADMIN → null (no filter; allowed everywhere)
   * - ADMIN / EMPLOYEE → their assigned location IDs. Never empty in practice: the users
   *   service requires at least one assignment for both roles.
   * - CUSTOMER → null (scoped by ownership, not by location)
   */
  async getAccessibleLocationIds(
    user: AuthenticatedUser,
    tenantId: string,
  ): Promise<string[] | null> {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.EMPLOYEE) return null;
    const rows = await this.prisma.location.findMany({
      where: { tenantId, trainers: { some: { id: user.id } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Throws ForbiddenException if `user` is ADMIN and any of `locationIds` lies outside
   * their assigned set. No-op for SUPER_ADMIN and for empty input. EMPLOYEE/CUSTOMER
   * are not constrained by this helper.
   */
  async assertLocationsAllowed(
    user: AuthenticatedUser,
    tenantId: string,
    locationIds: readonly string[],
  ): Promise<void> {
    if (locationIds.length === 0) return;
    const allowed = await this.getAccessibleLocationIds(user, tenantId);
    if (allowed === null) return;
    const allowedSet = new Set(allowed);
    const denied = locationIds.filter((id) => !allowedSet.has(id));
    if (denied.length > 0) {
      throw new ForbiddenException(
        `Not allowed for location${denied.length === 1 ? '' : 's'}: ${denied.join(', ')}`,
      );
    }
  }

  /**
   * Where fragment restricting a query to the user's accessible locations.
   * Spread into a Prisma `where`; empty object when the user is unrestricted.
   * `field` is the column holding the location id — 'locationId' on most models,
   * 'id' on Location itself.
   */
  async locationWhere(
    user: AuthenticatedUser,
    tenantId: string,
  ): Promise<{ locationId?: { in: string[] } }>;
  async locationWhere(
    user: AuthenticatedUser,
    tenantId: string,
    field: 'id',
  ): Promise<{ id?: { in: string[] } }>;
  async locationWhere(
    user: AuthenticatedUser,
    tenantId: string,
    field: 'locationId' | 'id' = 'locationId',
  ): Promise<{ locationId?: { in: string[] }; id?: { in: string[] } }> {
    const allowed = await this.getAccessibleLocationIds(user, tenantId);
    return allowed === null ? {} : { [field]: { in: allowed } };
  }

  /**
   * Relation-shaped variant of `locationWhere` for models linked to locations
   * via a `locations` m:n relation (Class, Trainee).
   */
  async locationsWhere(
    user: AuthenticatedUser,
    tenantId: string,
  ): Promise<{ locations?: { some: { id: { in: string[] } } } }> {
    const allowed = await this.getAccessibleLocationIds(user, tenantId);
    return allowed === null ? {} : { locations: { some: { id: { in: allowed } } } };
  }
}
