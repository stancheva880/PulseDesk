import { Module } from '@nestjs/common';
import { CustomerFeesController } from './customer-fees.controller';
import { FeesController } from './fees.controller';
import { FeesService } from './fees.service';

@Module({
  controllers: [FeesController, CustomerFeesController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
