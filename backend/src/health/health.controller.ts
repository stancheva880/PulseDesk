import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseSchema } from '../common/response-schema';
import { Public } from '../auth/decorators/public.decorator';
import { HealthSchema } from './health.schema';

@Public()
@Controller('health')
export class HealthController {
  @ApiOperation({ summary: 'Report that the service is alive.' })
  @Get()
  @ResponseSchema('Health', HealthSchema)
  check(): { status: 'ok'; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'pulsedesk-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
