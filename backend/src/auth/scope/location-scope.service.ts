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
   * TKT-0123: the other half of `assertLocationsAllowed`.
   *
   * Relation writes go through `set`, which replaces the whole list — so validating the ids that
   * ARRIVE says nothing about the ones that LEAVE. A class is visible to an ADMIN when any single
   * one of its locations is theirs, which was enough to strip a shared class of the other hall.
   * No-op for SUPER_ADMIN and CUSTOMER, and for a request that removes nothing.
   */
  async assertLocationRemovalsAllowed(
    user: AuthenticatedUser,
    tenantId: string,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> {
    const kept = new Set(after);
    const removed = before.filter((id) => !kept.has(id));
    if (removed.length === 0) return;
    await this.assertLocationsAllowed(user, tenantId, removed);
  }

  /**
   * TKT-0123: the same rule for rows that hang off locations rather than being one — a class's
   * trainee roster, its trainer roster, a trainee's class list.
   *
   * The bar is deliberately "positively somewhere else", not "not visible to me". A row with no
   * location at all is unscoped, and `assertTraineeIds` lets any admin of the club attach one, so
   * refusing to detach it would leave a relation an admin can add to and never remove from. What
   * this stops is the real escape: detaching a row anchored to a hall the actor does not hold.
   *
   * `countBlocked` answers "how many of these belong to another hall", asked through the caller's
   * own Prisma delegate; anything above zero fails the whole write.
   */
  async assertRemovalsAllowed(
    user: AuthenticatedUser,
    tenantId: string,
    before: readonly string[],
    after: readonly string[],
    countBlocked: (removed: string[], allowed: string[]) => Promise<number>,
    label: string,
  ): Promise<void> {
    const allowed = await this.getAccessibleLocationIds(user, tenantId);
    if (allowed === null) return;
    const kept = new Set(after);
    const removed = before.filter((id) => !kept.has(id));
    if (removed.length === 0) return;
    if ((await countBlocked(removed, allowed)) > 0) {
      throw new ForbiddenException(`Not allowed to detach ${label} outside your locations`);
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
