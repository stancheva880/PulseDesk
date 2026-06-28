import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { AuthenticatedUser } from '../types/jwt-payload';

// Centralises ADMIN's location-based access checks. Other roles are unchanged here:
//  - SUPER_ADMIN is never location-restricted.
//  - EMPLOYEE / CUSTOMER are scoped via their per-resource rules elsewhere
//    (e.g. assigned classes / sessions / guardian relationships).
@Injectable()
export class LocationScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the location IDs the user is allowed to operate on within the given tenant.
   * - SUPER_ADMIN → null (no filter; allowed everywhere)
   * - ADMIN → their assigned location IDs (may be empty if not yet assigned)
   * - EMPLOYEE / CUSTOMER → null (this helper does not apply; callers should rely on
   *   the existing per-resource rules for these roles)
   */
  async getAccessibleLocationIds(
    user: AuthenticatedUser,
    tenantId: string,
  ): Promise<string[] | null> {
    if (user.role !== UserRole.ADMIN) return null;
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
   * Convenience for write paths that target a single location.
   */
  async assertLocationAllowed(
    user: AuthenticatedUser,
    tenantId: string,
    locationId: string,
  ): Promise<void> {
    return this.assertLocationsAllowed(user, tenantId, [locationId]);
  }
}
