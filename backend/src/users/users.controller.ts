import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService, type UserSummary } from './users.service';

@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // List SUPER_ADMINs across the whole system. SUPER_ADMIN-only.
  // The class-level @Roles(ADMIN) is overridden here; RolesGuard's bypass still grants
  // SUPER_ADMIN access regardless of the list.
  @Get('super-admins')
  @Roles(UserRole.SUPER_ADMIN)
  listSuperAdmins(): Promise<UserSummary[]> {
    return this.users.listSuperAdmins();
  }

  @Get()
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserSummary[]> {
    return this.users.list(user, tenantId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserSummary> {
    // Tenant context isn't required for the read — service authorizes per-target.
    return this.users.findById(user, user.tenantId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-tenant-id') headerTenantId: string | undefined,
    @Body() dto: CreateUserDto,
  ): Promise<UserSummary> {
    // Tenant context for SUPER_ADMIN creating a tenant user comes from the header.
    // For SUPER_ADMIN creating SUPER_ADMIN, header is irrelevant. For tenant users,
    // the service uses actor.tenantId.
    const ctxTenantId = user.role === UserRole.SUPER_ADMIN ? (headerTenantId ?? null) : null;
    if (user.role === UserRole.SUPER_ADMIN && headerTenantId === '') {
      throw new BadRequestException('X-Tenant-Id header must not be empty');
    }
    return this.users.create(user, ctxTenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserSummary> {
    return this.users.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.users.delete(user, id);
  }
}
