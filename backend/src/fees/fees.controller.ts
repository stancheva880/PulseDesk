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
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateFeeDto } from './dto/create-fee.dto';
import { GenerateCourseFeesDto } from './dto/generate-course-fees.dto';
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

  @ApiOperation({ summary: 'List the fees of the club. Filtered and paginated.' })
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
  @ApiOperation({ summary: 'List the enrolled trainees that have no fee yet for a month.' })
  @Get('unbilled')
  @ResponseSchema('UnbilledFeeList', UnbilledFeeListSchema)
  unbilled(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GenerateMonthlyFeesDto,
  ) {
    return this.fees.listUnbilled(tenantId, query, user);
  }

  @ApiOperation({ summary: 'Read one fee with its payments and its refunds.' })
  @Get(':id')
  @ResponseSchema('FeeDetail', FeeDetailSchema)
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.fees.findById(tenantId, id, user);
  }

  @ApiOperation({ summary: 'Create one fee for one trainee.' })
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

  // TKT-0129: EMPLOYEE may edit a fee too, scoped the same as reads (fees.service.ts's
  // classAccessScope) — findById() inside update() answers 404 for a class they don't teach.
  @ApiOperation({ summary: 'Change one fee. The amount cannot go below what is already paid.' })
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ResponseSchema('Fee', FeeSchema)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFeeDto,
  ) {
    return this.fees.update(tenantId, id, dto, user);
  }

  @ApiOperation({ summary: 'Delete one fee. Its payments and refunds go with it.' })
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

  @ApiOperation({ summary: 'Make the monthly fees of a class for one month, in one request.' })
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

  @ApiOperation({ summary: 'Make the per-session fees for the sessions of a period.' })
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

  // TKT-0110: the class carries its own period and price — only the filter is an input.
  @ApiOperation({ summary: 'Make one course fee for each enrolled trainee of a class.' })
  @Post('generate-course')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ResponseSchema('GenerateResult', GenerateResultSchema)
  generateCourse(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateCourseFeesDto,
  ) {
    return this.fees.generateCourse(tenantId, dto, user);
  }
}
