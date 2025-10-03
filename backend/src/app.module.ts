import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { WhaleModule } from './modules/whale/whale.module';
import { TransactionModule } from './modules/transaction/transaction.module';
import { TokenModule } from './modules/token/token.module';
import { HealthModule } from './modules/health/health.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BnbModule } from './modules/bnb/bnb.module';
import { SolanaModule } from './modules/solana/solana.module';
import { WhaleMagnetModule } from './modules/whale-magnet/whale-magnet.module';


@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI || 'mongodb://localhost:27017/Whale', {
      dbName: undefined,
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    WhaleModule,
    TransactionModule,
    TokenModule,
    HealthModule,
    BnbModule,
    SolanaModule,
    WhaleMagnetModule,

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}