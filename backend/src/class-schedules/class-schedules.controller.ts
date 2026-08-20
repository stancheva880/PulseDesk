import {
  Body,
  Controller,
  Delete,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import { GenerateResultSchema } from '@/common/generate-result';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { ClassSchedulesService } from './class-schedules.service';
import {
  ClassScheduleSchema,
  PaginatedClassScheduleSchema,
} from './class-schedules.schema';
import { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import { GenerateSessionsDto } from './dto/generate-sessions.dto';
import { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';

@ApiBearerAuth()
@Controller('class-schedules')
@Roles(UserRole.ADMIN)
export class ClassSchedulesController {
  constructor(private readonly schedules: ClassSchedulesService) {}

  @Get()
  @ResponseSchema('PaginatedClassSchedule', PaginatedClassScheduleSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.schedules.list(tenantId, user, query);
  }

  @Get(':id')
  @ResponseSchema('ClassSchedule', ClassScheduleSchema)
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.schedules.findById(tenantId, id, user);
  }

  @Post()
  @ResponseSchema('ClassSchedule', ClassScheduleSchema)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClassScheduleDto,
  ) {
    return this.schedules.create(tenantId, dto, user);
  }

  @Patch(':id')
  @ResponseSchema('ClassSchedule', ClassScheduleSchema)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateClassScheduleDto,
  ) {
    return this.schedules.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('ClassScheduleNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.schedules.delete(tenantId, id, user);
  }

  @Post('generate-sessions')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema('GenerateResult', GenerateResultSchema)
  generate(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSessionsDto,
  ) {
    return this.schedules.generateSessions(tenantId, dto, user);
  }
}
