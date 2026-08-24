import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { PaginatedResult } from '@/common/dto/paginated-result';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  CreatedUserSchema,
  InviteResultSchema,
  PaginatedUserSummarySchema,
  UserSummarySchema,
} from './users.schema';
import { UsersService, type UserSummary } from './users.service';

@ApiBearerAuth()
@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOperation({ summary: 'List the accounts of the acting club. Filtered and paginated.' })
  @Get()
  @ResponseSchema('PaginatedUserSummary', PaginatedUserSummarySchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedResult<UserSummary>> {
    // One DTO carries both the pagination input and the filter set, as on GET /fees.
    return this.users.list(user, tenantId, query, query);
  }

  @ApiOperation({ summary: 'Read one account. Role and locations are those of the acting club.' })
  @Get(':id')
  @ResponseSchema('UserSummary', UserSummarySchema)
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserSummary> {
    // TKT-0123: the header is required here now. One account can hold memberships in several
    // clubs (the attach path on POST /users), so "which role does this user have" has no answer
    // without naming the club — this used to report the oldest membership's role whatever club
    // the caller was acting in.
    return this.users.findById(user, id, tenantId);
  }

  @ApiOperation({ summary: 'Create an account, or attach an existing email to this club.' })
  @Post()
  @ResponseSchema('CreatedUser', CreatedUserSchema)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-tenant-id') headerTenantId: string | undefined,
    @Body() dto: CreateUserDto,
  ): Promise<UserSummary & { attachedExisting?: boolean; notificationSent: boolean }> {
    // Tenant context for SUPER_ADMIN creating a tenant user comes from the header.
    // For SUPER_ADMIN creating SUPER_ADMIN, header is irrelevant. For tenant users,
    // the service uses actor.tenantId.
    const ctxTenantId = user.role === UserRole.SUPER_ADMIN ? (headerTenantId ?? null) : null;
    if (user.role === UserRole.SUPER_ADMIN && headerTenantId === '') {
      throw new BadRequestException('X-Tenant-Id header must not be empty');
    }
    return this.users.create(user, ctxTenantId, dto);
  }

  /**
   * TKT-0060. 200 rather than Nest's default 201: nothing is created at a new URL, this is a
   * side-effecting action on an existing user. Authorisation is the class-level
   * @Roles(ADMIN) plus the guard's SUPER_ADMIN bypass — the same pair POST /users relies on —
   * and the service applies the per-target location scope.
   */
  @ApiOperation({ summary: 'Send the invite mail again to an account that has no password yet.' })
  @Post(':id/invite')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema('InviteResult', InviteResultSchema)
  resendInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ inviteEmailSent: boolean }> {
    return this.users.resendInvite(user, id);
  }

  @ApiOperation({ summary: 'Change role and locations. The change lands in the acting club only.' })
  @Patch(':id')
  @ResponseSchema('UserSummary', UserSummarySchema)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserSummary> {
    // TKT-0123: the acting club decides which membership the role change lands on and which
    // location links are replaced. Resolving it from the target's memberships instead wrote
    // into whichever club they joined first.
    return this.users.update(user, id, dto, tenantId);
  }

  @ApiOperation({ summary: 'Remove an account from the club. A SUPER_ADMIN deletes the account itself.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('UserNoContent', NoContent)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.users.delete(user, id);
  }
}
