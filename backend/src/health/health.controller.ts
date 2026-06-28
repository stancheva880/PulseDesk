import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

export interface HealthCheckResult {
  status: 'ok';
  service: string;
  timestamp: string;
}

@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthCheckResult {
    return {
      status: 'ok',
      service: 'pulsedesk-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
