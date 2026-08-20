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
import { ListTraineesQueryDto } from './dto/list-trainees-query.dto';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateTraineeDto } from './dto/create-trainee.dto';
import { UpdateTraineeDto } from './dto/update-trainee.dto';
import {
  PaginatedTraineeSchema,
  TraineeDetailSchema,
  TraineeSchema,
} from './trainees.schema';
import { TraineesService } from './trainees.service';

@ApiBearerAuth()
@Controller('trainees')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class TraineesController {
  constructor(private readonly trainees: TraineesService) {}

  @Get()
  @ResponseSchema('PaginatedTrainee', PaginatedTraineeSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTraineesQueryDto,
  ) {
    // One DTO carries both the pagination input and the filter set, as on GET /users.
    return this.trainees.list(tenantId, user, query, query);
  }

  @Get(':id')
  @ResponseSchema('TraineeDetail', TraineeDetailSchema)
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.trainees.findById(tenantId, id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Trainee', TraineeSchema)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTraineeDto,
  ) {
    return this.trainees.create(tenantId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Trainee', TraineeSchema)
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
  @ResponseSchema('TraineeNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.trainees.delete(tenantId, id, user);
  }
}
