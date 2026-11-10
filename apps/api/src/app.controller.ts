import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('System')
@Controller()
export class AppController {
  @Get('health')
  @ApiOperation({ summary: 'System health check' })
  health() {
    return { status: 'ok', timestamp: new Date().toISOString(), service: 'nexora-api' };
  }
}
