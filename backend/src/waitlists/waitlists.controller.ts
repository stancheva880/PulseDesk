import {
  Body,
  Controller,
  Delete,
  Get,
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
import { WaitlistEntryListSchema, WaitlistEntrySchema } from './waitlists.schema';
import { WaitlistsService } from './waitlists.service';

// Waitlisting is a door-side action like the attendance add, so EMPLOYEE joins ADMIN here
// (visibility still limits a trainer to sessions they train).
@ApiBearerAuth()
@Controller('sessions/:sessionId/waitlist')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class WaitlistsController {
  constructor(private readonly waitlists: WaitlistsService) {}

  @ApiOperation({ summary: 'List the queue of one session, in order.' })
  @Get()
  @ResponseSchema('WaitlistEntryList', WaitlistEntryListSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.waitlists.listForSession(tenantId, sessionId, user);
  }

  @ApiOperation({ summary: 'Put a trainee on the queue of one full session.' })
  @Post()
  @ResponseSchema('WaitlistEntry', WaitlistEntrySchema)
  join(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWaitlistEntryDto,
  ) {
    return this.waitlists.join(tenantId, sessionId, user, dto);
  }

  @ApiOperation({ summary: 'Take a trainee off the queue.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('WaitlistNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.waitlists.remove(tenantId, sessionId, id, user);
  }
}
