import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ResponseSchema } from '@/common/response-schema';
import { CustomerLocationPaymentEntryListSchema } from './locations.schema';
import { LocationsService } from './locations.service';

// Customer-facing read-only payment-details endpoint. Mirrors the CustomerTraineesController
// pattern (`/me/trainees`) — separate controller so the role gate is unambiguous.
@ApiBearerAuth()
@Controller('me/locations')
@Roles(UserRole.CUSTOMER)
export class CustomerLocationsController {
  constructor(private readonly locations: LocationsService) {}

  @ApiOperation({
    summary: "List the family's locations with payment details, for the portal.",
  })
  @Get()
  @ResponseSchema('CustomerLocationPaymentEntryList', CustomerLocationPaymentEntryListSchema)
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.locations.listPaymentDetailsForCustomer(tenantId, user.id);
  }
}
