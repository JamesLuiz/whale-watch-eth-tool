import { Module } from '@nestjs/common';
import { BnbController } from './bnb.controller';
import { BnbService } from './bnb.service';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TokenModule } from '../token/token.module'; // Assuming you have a TokenModule
import { WhaleModule } from '../whale/whale.module';

@Module({
  imports: [ConfigModule, ScheduleModule.forRoot(), TokenModule, WhaleModule],
  controllers: [BnbController],
  providers: [BnbService],
  exports: [BnbService], // Export the service if other modules need to use it
})
export class BnbModule {}