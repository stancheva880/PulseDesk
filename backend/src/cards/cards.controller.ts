import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ResponseSchema } from '@/common/response-schema';
import { CardRowSchema, PaginatedCardRowSchema } from './cards.schema';
import { CardsService } from './cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { ListCardsQueryDto } from './dto/list-cards-query.dto';

@ApiBearerAuth()
@Controller('cards')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @ApiOperation({ summary: 'List the visit cards of the club. Filtered and paginated.' })
  @Get()
  @ResponseSchema('PaginatedCardRow', PaginatedCardRowSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCardsQueryDto,
  ) {
    // ListCardsQueryDto is both the filter set and the pagination input.
    return this.cards.list(tenantId, query, user, query);
  }

  @ApiOperation({ summary: 'Sell a visit card. The fee for it is raised in the same transaction.' })
  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('CardRow', CardRowSchema)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCardDto,
  ) {
    return this.cards.create(tenantId, dto, user);
  }

  // TKT-0115: no body — the refund half of the flow goes through POST /fees/:feeId/refunds.
  @ApiOperation({ summary: 'Cancel a card. Give the money back on its fee with a refund.' })
  @Post(':id/cancel')
  @Roles(UserRole.ADMIN)
  @ResponseSchema('CardRow', CardRowSchema)
  cancel(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.cards.cancel(tenantId, id, user);
  }
}
