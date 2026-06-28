import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@Roles(UserRole.ADMIN)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('fees-summary')
  feesSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.getFeesSummary(tenantId, { from, to }, user);
  }

  @Get('cashflow-summary')
  cashflowSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.getCashflowSummary(tenantId, { from, to }, user);
  }
}
