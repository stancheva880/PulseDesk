import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Public } from '@/auth/decorators/public.decorator';
import { ResponseSchema } from '@/common/response-schema';
import { ClaimWaitlistDto } from './dto/claim-waitlist.dto';
import { ClaimResultSchema } from './waitlists.schema';
import { WaitlistsService } from './waitlists.service';

// TKT-0114: the portal-read-only exception — no login, the token is the authorization.
// The global ThrottlerGuard still fronts this route (rate limiting per AC #5).
@Public()
@Controller('waitlist')
export class WaitlistClaimController {
  constructor(private readonly waitlists: WaitlistsService) {}

  @ApiOperation({ summary: 'Take a free spot with the token from a waiting-list mail. Public.' })
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema('ClaimResult', ClaimResultSchema)
  claim(@Body() dto: ClaimWaitlistDto) {
    return this.waitlists.claim(dto);
  }
}
