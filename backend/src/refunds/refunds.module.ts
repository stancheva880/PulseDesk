import { Module } from '@nestjs/common';
import { FeesModule } from '@/fees/fees.module';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [FeesModule],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
