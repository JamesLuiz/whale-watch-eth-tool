import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SolanaController } from './solana.controller';
import { SolanaAlertsController } from './solana-alerts.controller';
import { SolanaAlertsGateway } from './solana-alerts.gateway';
import { SolanaService } from './solana.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Alert, AlertSchema } from '../whale-magnet/schemas/alert.schema';

/**
 * The main module for the Solana integration.
 * It imports the ConfigModule to access environment variables.
 * It provides the SolanaService and registers the SolanaController.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: Alert.name, schema: AlertSchema }])
  ],
  controllers: [SolanaController, SolanaAlertsController],
  providers: [SolanaService, SolanaAlertsGateway],
  exports: [SolanaService, SolanaAlertsGateway],
})
export class SolanaModule {}
