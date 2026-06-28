import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantsService, type TenantSummary } from './tenants.service';

// SUPER_ADMIN-only read-only endpoint that powers the frontend tenant selector.
// The RolesGuard's SUPER_ADMIN bypass means this is also reachable by SUPER_ADMIN
// without further annotation; ADMIN/EMPLOYEE/CUSTOMER are rejected with 403.
@Controller('tenants')
@Roles(UserRole.SUPER_ADMIN)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list(): Promise<TenantSummary[]> {
    return this.tenants.list();
  }
}
