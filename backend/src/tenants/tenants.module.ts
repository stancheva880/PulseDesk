import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

// AuthModule for AuthService.issueInvite — the club's first administrator is invited and sets
// their own password (TKT-0062). MailModule is @Global(), so MailService needs no import here.
@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
