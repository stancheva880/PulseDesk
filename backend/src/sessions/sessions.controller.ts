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
import { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import {
  PaginatedSessionSchema,
  SessionDetailSchema,
  SessionSchema,
} from './sessions.schema';
import { SessionsService } from './sessions.service';

@ApiBearerAuth()
@Controller('sessions')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ResponseSchema('PaginatedSession', PaginatedSessionSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSessionsQueryDto,
  ) {
    // One DTO carries both the pagination input and the filter set, as on GET /fees.
    return this.sessions.list(tenantId, user, query, query);
  }

  @Get(':id')
  @ResponseSchema('SessionDetail', SessionDetailSchema)
  findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.findById(tenantId, id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Session', SessionSchema)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessions.create(tenantId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Session', SessionSchema)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessions.update(tenantId, id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('SessionNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.sessions.delete(tenantId, id, user);
  }
}
