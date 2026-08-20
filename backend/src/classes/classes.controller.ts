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
import { ListClassesQueryDto } from './dto/list-classes-query.dto';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { ClassesService } from './classes.service';
import {
  ClassDetailSchema,
  ClassRowSchema,
  PaginatedClassRowSchema,
} from './classes.schema';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

@ApiBearerAuth()
@Controller('classes')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  @ResponseSchema('PaginatedClassRow', PaginatedClassRowSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClassesQueryDto,
  ) {
    // One DTO carries both the pagination input and the filter set, as on GET /fees.
    return this.classes.list(tenantId, user, query, query);
  }

  @Get(':id')
  @ResponseSchema('ClassDetail', ClassDetailSchema)
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.classes.findById(tenantId, id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('ClassRow', ClassRowSchema)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClassDto,
  ) {
    return this.classes.create(tenantId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ResponseSchema('ClassRow', ClassRowSchema)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.classes.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('ClassNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.classes.delete(tenantId, id, user);
  }
}
