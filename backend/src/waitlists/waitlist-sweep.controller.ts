import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '@/auth/decorators/roles.decorator';
import { ResponseSchema } from '@/common/response-schema';
import { WaitlistSweepResultSchema } from './waitlists.schema';
import { WaitlistsService } from './waitlists.service';

/**
 * TKT-0122: the manual trigger for the stale-queue sweep. Its own controller because
 * `WaitlistsController` is mounted at `sessions/:sessionId/waitlist` with
 * `@Roles(ADMIN, EMPLOYEE)` — wrong path and wrong roles for a platform maintenance action.
 *
 * No `@TenantId()` on purpose. The sweep spans every tenant, and that decorator would reject a
 * SUPER_ADMIN acting without a club. The frontend attaches `X-Tenant-Id` to every request, so
 * the header is normally present and `TenantContextGuard` validates it — this handler just has
 * no use for it.
 */
@ApiBearerAuth()
@Controller('waitlists')
@Roles(UserRole.SUPER_ADMIN)
export class WaitlistSweepController {
  constructor(private readonly waitlists: WaitlistsService) {}

  @ApiOperation({ summary: 'Delete queue entries for sessions that started over 48 hours ago.' })
  @Post('sweep')
  @ResponseSchema('WaitlistSweepResult', WaitlistSweepResultSchema)
  sweep(): Promise<{ deleted: number }> {
    return this.waitlists.sweepStaleEntries();
  }
}
