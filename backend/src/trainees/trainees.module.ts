import { Module } from '@nestjs/common';
import { CustomerTraineesController } from './customer-trainees.controller';
import { TraineesController } from './trainees.controller';
import { TraineesService } from './trainees.service';

@Module({
  controllers: [TraineesController, CustomerTraineesController],
  providers: [TraineesService],
})
export class TraineesModule {}
