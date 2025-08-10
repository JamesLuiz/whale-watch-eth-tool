import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

@Injectable()
export class HealthService {
  private provider: ethers.JsonRpcProvider;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('ETHEREUM_RPC_URL');
    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async getHealthStatus() {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime / 60)} minutes`,
      memory: {
        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
      },
      environment: this.configService.get<string>('NODE_ENV'),
    };
  }

  async getEthereumHealth() {
    try {
      if (!this.provider) {
        return {
          status: 'error',
          message: 'Ethereum provider not configured',
          connected: false,
        };
      }

      const blockNumber = await this.provider.getBlockNumber();
      const network = await this.provider.getNetwork();

      return {
        status: 'healthy',
        connected: true,
        network: {
          name: network.name,
          chainId: network.chainId.toString(),
        },
        latestBlock: blockNumber,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}