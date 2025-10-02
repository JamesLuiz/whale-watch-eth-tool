import { Controller, Get, Logger, Sse, MessageEvent, Param } from '@nestjs/common';
import { WhaleMagnetService, WhaleMagnetEvent } from './whale-magnet.service';
import { Observable, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiTags } from '@nestjs/swagger';


@ApiTags('whale-magnet')
@Controller('whales')
export class WhaleMagnetController {
  private readonly logger = new Logger(WhaleMagnetController.name);

  constructor(private readonly whaleMagnetService: WhaleMagnetService) {}

  

  @Sse('stream')
  sseEvents(): Observable<MessageEvent> {
    this.logger.log('Client connected to SSE stream...');
    // Listen for 'whale_magnet' events from the service's EventEmitter
    // and map them to a Server-Sent Event (SSE) format
    return fromEvent(this.whaleMagnetService.whaleMagnetEmitter, 'whale_magnet').pipe(
      map((event: WhaleMagnetEvent) => {
        this.logger.log(`Streaming new whale magnet: ${event.tokenSymbol}`);
        return {
          data: JSON.stringify(event),
        };
      }),
    );
  }

  @Get('search')
  async searchWhales(): Promise<{ message: string }> {
    this.logger.log('Received search request...');
    this.whaleMagnetService.findWhaleMagnets();
    return { message: 'Whale hunting process initiated. Connect to /whales/stream for real-time updates.' };
  }


  @Get(':chainId/:tokenAddress')
  async getTokenDetails(
        @Param('chainId') chainId: string,
        @Param('tokenAddress') tokenAddress: string,
    ): Promise<WhaleMagnetEvent | { message: string }> {
        this.logger.log(`Received request for token: ${tokenAddress} on ${chainId}`);
        const tokenDetails = await this.whaleMagnetService.getSingleTokenDetails(chainId, tokenAddress);

        if (tokenDetails) {
        return tokenDetails;
        } else {
        return { message: 'Token details not found or pair not supported.' };
        }
}}
