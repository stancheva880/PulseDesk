import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { FeesService } from './fees.service';

// Customer-facing read-only fees endpoint. Mirrors the AttendancesController.myUpcoming
// pattern (`/me/sessions`) — separate controller so the role gate is unambiguous.
@Controller('me/fees')
@Roles(UserRole.CUSTOMER)
export class CustomerFeesController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fees.listForCustomer(tenantId, user.id);
  }
}
