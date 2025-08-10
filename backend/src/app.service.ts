import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getApiInfo(): object {
    return {
      name: 'Whale Tracker API',
      version: '1.0.0',
      description: 'Backend service for monitoring whale transactions and token purchases',
      endpoints: {
        health: '/api/v1/health',
        whales: '/api/v1/whales',
        transactions: '/api/v1/transactions',
        tokens: '/api/v1/tokens',
        docs: '/api/docs',
      },
      timestamp: new Date().toISOString(),
    };
  }
}