import { Global, Module } from '@nestjs/common';
import { LocationScopeService } from './location-scope.service';

// Global so any domain service can inject LocationScopeService without re-importing.
@Global()
@Module({
  providers: [LocationScopeService],
  exports: [LocationScopeService],
})
export class LocationScopeModule {}
