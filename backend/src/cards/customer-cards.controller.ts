import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ResponseSchema } from '@/common/response-schema';
import { CustomerCardEntryListSchema } from './cards.schema';
import { CardsService } from './cards.service';

// TKT-0116: read-only, like every me/* controller — the portal has no card writes.
// Path follows the me/* customer convention (deviation from the AC's literal /cards/me,
// approved in the tech plan).
@ApiBearerAuth()
@Controller('me/cards')
@Roles(UserRole.CUSTOMER)
export class CustomerCardsController {
  constructor(private readonly cards: CardsService) {}

  @ApiOperation({ summary: 'List the visit cards of the family, with the visits that are left.' })
  @Get()
  @ResponseSchema('CustomerCardEntryList', CustomerCardEntryListSchema)
  myCards(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.cards.listForCustomer(tenantId, user.id);
  }
}
