import { Module } from '@nestjs/common';
import { MeWaitlistController } from './me-waitlist.controller';
import { WaitlistClaimController } from './waitlist-claim.controller';
import { WaitlistSweepController } from './waitlist-sweep.controller';
import { WaitlistsController } from './waitlists.controller';
import { WaitlistsService } from './waitlists.service';

@Module({
  controllers: [
    WaitlistsController,
    MeWaitlistController,
    WaitlistClaimController,
    WaitlistSweepController,
  ],
  providers: [WaitlistsService],
})
export class WaitlistsModule {}
