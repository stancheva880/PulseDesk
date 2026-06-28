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
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ClassSchedulesService } from './class-schedules.service';
import { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import { GenerateSessionsDto } from './dto/generate-sessions.dto';
import { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';

@Controller('class-schedules')
@Roles(UserRole.ADMIN)
export class ClassSchedulesController {
  constructor(private readonly schedules: ClassSchedulesService) {}

  @Get()
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.schedules.list(tenantId, user);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.schedules.findById(tenantId, id, user);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClassScheduleDto,
  ) {
    return this.schedules.create(tenantId, dto, user);
  }

  @Patch(':id')
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
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.schedules.delete(tenantId, id, user);
  }

  @Post('generate-sessions')
  @HttpCode(HttpStatus.OK)
  generate(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSessionsDto,
  ) {
    return this.schedules.generateSessions(tenantId, dto, user);
  }
}
