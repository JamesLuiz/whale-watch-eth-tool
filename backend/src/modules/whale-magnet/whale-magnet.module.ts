import { Module } from '@nestjs/common';
import { WhaleMagnetController } from './whale-magnet.controller';
import { WhaleMagnetService } from './whale-magnet.service';

@Module({
  controllers: [WhaleMagnetController],
  providers: [WhaleMagnetService]
})
export class WhaleMagnetModule {}
