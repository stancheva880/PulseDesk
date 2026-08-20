import { Module } from '@nestjs/common';
import { SessionsModule } from '@/sessions/sessions.module';
import { ClassSchedulesController } from './class-schedules.controller';
import { ClassSchedulesService } from './class-schedules.service';

@Module({
  imports: [SessionsModule],
  controllers: [ClassSchedulesController],
  providers: [ClassSchedulesService],
})
export class ClassSchedulesModule {}
