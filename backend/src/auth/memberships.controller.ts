import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ResponseSchema } from '@/common/response-schema';
import { LoginMembershipListSchema } from './auth.schema';
import { AuthService, type LoginMembership } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './types/jwt-payload';

// Lives outside AuthController because that one is class-level @Public() — this
// route requires a JWT. No @Roles: any authenticated user may read their own list.
// No X-Tenant-Id required — clients call it header-less so a stale context (the
// tenant the caller was just removed from) can't 403 the request at the guard.
@ApiBearerAuth()
@Controller('auth')
export class MembershipsController {
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: 'List the clubs the signed-in user belongs to.' })
  @Get('memberships')
  @ResponseSchema('LoginMembershipList', LoginMembershipListSchema)
  list(@CurrentUser() user: AuthenticatedUser): Promise<LoginMembership[]> {
    return this.auth.listMemberships(user.id);
  }
}
