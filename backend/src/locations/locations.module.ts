import { Module } from '@nestjs/common';
import { CustomerLocationsController } from './customer-locations.controller';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  controllers: [LocationsController, CustomerLocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
