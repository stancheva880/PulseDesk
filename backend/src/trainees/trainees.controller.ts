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
import { CreateTraineeDto } from './dto/create-trainee.dto';
import { UpdateTraineeDto } from './dto/update-trainee.dto';
import { TraineesService } from './trainees.service';

@Controller('trainees')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class TraineesController {
  constructor(private readonly trainees: TraineesService) {}

  @Get()
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainees.list(tenantId, user);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.trainees.findById(tenantId, id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTraineeDto,
  ) {
    return this.trainees.create(tenantId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTraineeDto,
  ) {
    return this.trainees.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.trainees.delete(tenantId, id, user);
  }
}
