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
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateFeeDto } from './dto/create-fee.dto';
import { GenerateMonthlyFeesDto } from './dto/generate-monthly-fees.dto';
import { GenerateSessionFeesDto } from './dto/generate-session-fees.dto';
import { ListFeesQueryDto } from './dto/list-fees-query.dto';
import { UpdateFeeDto } from './dto/update-fee.dto';
import {
  FeeDetailSchema,
  FeeSchema,
  GenerateResultSchema,
  PaginatedFeeRowSchema,
  UnbilledFeeListSchema,
} from './fees.schema';
import { FeesService } from './fees.service';

@ApiBearerAuth()
@Controller('fees')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  @ResponseSchema('PaginatedFeeRow', PaginatedFeeRowSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFeesQueryDto,
  ) {
    // ListFeesQueryDto is both the filter set and the pagination input.
    return this.fees.list(tenantId, query, user, query);
  }

  // Declared before @Get(':id'), or Nest matches "unbilled" as a fee id and answers 404.
  // Takes GenerateMonthlyFeesDto because the inputs are the same ones generate-monthly
  // takes — sharing the DTO is what keeps the preview and the write in step.
  @Get('unbilled')
  @ResponseSchema('UnbilledFeeList', UnbilledFeeListSchema)
  unbilled(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GenerateMonthlyFeesDto,
  ) {
    return this.fees.listUnbilled(tenantId, query, user);
  }

  @Get(':id')
  @ResponseSchema('FeeDetail', FeeDetailSchema)
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.fees.findById(tenantId, id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Fee', FeeSchema)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFeeDto,
  ) {
    return this.fees.create(tenantId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Fee', FeeSchema)
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
  @ResponseSchema('FeeNoContent', NoContent)
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
  @ResponseSchema('GenerateResult', GenerateResultSchema)
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
  @ResponseSchema('GenerateResult', GenerateResultSchema)
  generateSession(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSessionFeesDto,
  ) {
    return this.fees.generateSessionFees(tenantId, dto, user);
  }
}
