import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FeeStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { CreateFeeDto } from './dto/create-fee.dto';
import { GenerateMonthlyFeesDto } from './dto/generate-monthly-fees.dto';
import { GenerateSessionFeesDto } from './dto/generate-session-fees.dto';
import { UpdateFeeDto } from './dto/update-fee.dto';
import { FeesService, type FeeListFilters } from './fees.service';

@Controller('fees')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: FeeStatus,
    @Query('classId') classId?: string,
    @Query('traineeId') traineeId?: string,
    @Query('periodStartFrom') periodStartFrom?: string,
    @Query('periodStartTo') periodStartTo?: string,
  ) {
    const filters: FeeListFilters = {};
    if (status) filters.status = status;
    if (classId) filters.classId = classId;
    if (traineeId) filters.traineeId = traineeId;
    if (periodStartFrom) filters.periodStartFrom = periodStartFrom;
    if (periodStartTo) filters.periodStartTo = periodStartTo;
    return this.fees.list(tenantId, filters, user);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.fees.findById(tenantId, id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFeeDto,
  ) {
    return this.fees.create(tenantId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFeeDto,
  ) {
    return this.fees.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.fees.delete(tenantId, id, user);
  }

  @Post('generate-monthly')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  generateMonthly(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateMonthlyFeesDto,
  ) {
    return this.fees.generateMonthly(tenantId, dto, user);
  }

  @Post('generate-session')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  generateSession(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSessionFeesDto,
  ) {
    return this.fees.generateSessionFees(tenantId, dto, user);
  }
}
