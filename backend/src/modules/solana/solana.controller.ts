import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, Sse, MessageEvent, Res } from '@nestjs/common';
import { SolanaService } from './solana.service';
import { Observable, fromEvent, map } from 'rxjs';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('solana')
@Controller('solana')
export class SolanaController {
  constructor(private readonly solanaService: SolanaService) {}

  @Get('status')
  async getStatus(): Promise<{ status: string; slot: number | null }> {
    return this.solanaService.getStatus();
  }

  @Get('balance/:publicKey')
  async getBalance(@Param('publicKey') publicKey: string): Promise<{ balanceSol: number; balanceLamports: number }> {
    try {
      return await this.solanaService.getBalance(publicKey);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('start-monitoring-whales')
  async startMonitoringWhales(): Promise<{ message: string }> {
    try {
      await this.solanaService.startWhaleMonitoring();
      return { message: 'Started monitoring for whale transactions.' };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('stop-monitoring-whales')
  async stopMonitoringWhales(): Promise<{ message: string }> {
    try {
      await this.solanaService.stopWhaleMonitoring();
      return { message: 'Stopped monitoring for whale transactions.' };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Sse('sse/whales')
  sseWhaleTransactions(@Res() res: Response): Observable<MessageEvent> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Subscribe to the 'whale_transaction' event from the service's EventEmitter
    return fromEvent(this.solanaService.whaleTransactionsEmitter, 'whale_transaction').pipe(
      map((data: any) => ({ data: JSON.stringify(data) }))
    );
  }
}
