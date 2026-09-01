import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ResponseSchema } from '@/common/response-schema';
import { CustomerTraineeEntryListSchema } from './trainees.schema';
import { TraineesService } from './trainees.service';

// Customer-facing read-only trainees endpoint. Mirrors the CustomerFeesController pattern
// (`/me/fees`) — separate controller so the role gate is unambiguous.
@ApiBearerAuth()
@Controller('me/trainees')
@Roles(UserRole.CUSTOMER)
export class CustomerTraineesController {
  constructor(private readonly trainees: TraineesService) {}

  @ApiOperation({ summary: 'List the trainees of the family, with their classes, for the portal.' })
  @Get()
  @ResponseSchema('CustomerTraineeEntryList', CustomerTraineeEntryListSchema)
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainees.listForCustomer(tenantId, user.id);
  }
}
