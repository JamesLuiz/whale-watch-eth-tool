import { Module } from '@nestjs/common';
import { WhaleController } from './whale.controller';
import { WhaleService } from './whale.service';
import { WhaleGateway } from './whale.gateway';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [TokenModule],
  controllers: [WhaleController],
  providers: [WhaleService, WhaleGateway],
  exports: [WhaleService],
})
export class WhaleModule {}