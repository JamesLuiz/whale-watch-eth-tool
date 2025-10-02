import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SolanaController } from './solana.controller';
import { SolanaService } from './solana.service';

/**
 * The main module for the Solana integration.
 * It imports the ConfigModule to access environment variables.
 * It provides the SolanaService and registers the SolanaController.
 */
@Module({
  imports: [ConfigModule],
  controllers: [SolanaController],
  providers: [SolanaService],
  exports: [SolanaService],
})
export class SolanaModule {}
