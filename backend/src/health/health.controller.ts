import { Controller, Get } from '@nestjs/common';
import { ResponseSchema } from '../common/response-schema';
import { Public } from '../auth/decorators/public.decorator';
import { HealthSchema } from './health.schema';

@Public()
@Controller('health')
export class HealthController {
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
