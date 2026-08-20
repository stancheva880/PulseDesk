import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ResponseSchema } from '@/common/response-schema';
import {
  CashflowSummaryEntryListSchema,
  FeesSummaryEntryListSchema,
} from './dashboard.schema';
import { DashboardService } from './dashboard.service';

// Both routes answer one entry per calendar month in the window, so the window itself is
// the contract: neither end may be left open-ended and the span is capped. Described here
// because a caller only meets the rules as a 400.
const FROM_DESCRIPTION =
  'Inclusive start (YYYY-MM-DD), rounded down to its month. Omitted: 5 months before "to".';
const TO_DESCRIPTION =
  'Inclusive end (YYYY-MM-DD), rounded up to its month. Omitted: the current month, or "from" own month when "from" is in the future. A span over 120 months is rejected with 400.';

@ApiBearerAuth()
@Controller('dashboard')
@Roles(UserRole.ADMIN)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('fees-summary')
  @ApiQuery({ name: 'from', required: false, description: FROM_DESCRIPTION })
  @ApiQuery({ name: 'to', required: false, description: TO_DESCRIPTION })
  @ResponseSchema('FeesSummaryEntryList', FeesSummaryEntryListSchema)
  feesSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.getFeesSummary(tenantId, { from, to }, user);
  }

  @Get('cashflow-summary')
  @ApiQuery({ name: 'from', required: false, description: FROM_DESCRIPTION })
  @ApiQuery({ name: 'to', required: false, description: TO_DESCRIPTION })
  @ResponseSchema('CashflowSummaryEntryList', CashflowSummaryEntryListSchema)
  cashflowSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.getCashflowSummary(tenantId, { from, to }, user);
  }
}
