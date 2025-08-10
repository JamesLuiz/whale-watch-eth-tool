import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async getHealth() {
    return this.healthService.getHealthStatus();
  }

  @Get('ethereum')
  @ApiOperation({ summary: 'Ethereum connection health check' })
  @ApiResponse({ status: 200, description: 'Ethereum connection status' })
  async getEthereumHealth() {
    return this.healthService.getEthereumHealth();
  }
}