import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { WaitlistEntrySchema } from './waitlists.schema';
import { WaitlistsService } from './waitlists.service';

// TKT-0121: the customer half of the queue. A Nest prefix always prepends, so the `me/` pair
// cannot live on the staff controller — the same split the claim controller already uses.
// Addressed by trainee, not entry id: the portal knows its trainees, never the entry.
@ApiBearerAuth()
@Controller('me/sessions/:sessionId/waitlist')
@Roles(UserRole.CUSTOMER)
export class MeWaitlistController {
  constructor(private readonly waitlists: WaitlistsService) {}

  @ApiOperation({ summary: 'Join the queue of a full session as a customer.' })
  @Post()
  @ResponseSchema('WaitlistEntry', WaitlistEntrySchema)
  join(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWaitlistEntryDto,
  ) {
    return this.waitlists.joinForCustomer(tenantId, sessionId, user, dto);
  }

  @ApiOperation({ summary: 'Leave the queue. Allowed after the booking deadline too.' })
  @Delete(':traineeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('WaitlistNoContent', NoContent)
  async leave(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @Param('traineeId') traineeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.waitlists.leaveForCustomer(tenantId, sessionId, user, traineeId);
  }
}
