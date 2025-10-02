import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, IsEnum, IsDateString, IsDate } from 'class-validator';
import { Type } from 'class-transformer';

export class TokenInfoDto {
  @ApiProperty({ description: 'Token contract address' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'Token name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Token symbol' })
  @IsString()
  symbol: string;

  @ApiProperty({ description: 'Token decimals' })
  @IsNumber()
  decimals: number;

  @ApiPropertyOptional({ description: 'Token balance' })
  @IsOptional()
  @IsString()
  balance?: string;

  @ApiPropertyOptional({ description: 'Is newly launched token' })
  @IsOptional()
  @IsBoolean()
  isNewlyLaunched?: boolean;

  @ApiPropertyOptional({ description: 'Launch date timestamp' })
  @IsOptional()
  @IsNumber()
  launchDate?: number;

  @ApiPropertyOptional({ description: 'Market cap in USD' })
  @IsOptional()
  @IsNumber()
  marketCap?: number;

  @ApiPropertyOptional({ description: 'Token price in USD' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: 'Is verified token' })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ description: 'Token tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export enum TransactionType {
  TRANSFER = 'transfer',
  MINT = 'mint',
  SWAP = 'swap'
}

export class WhaleTransactionDto {
  @ApiProperty({ description: 'Transaction hash' })
  @IsString()
  hash: string;

  @ApiProperty({ description: 'From address' })
  @IsString()
  from: string;

  @ApiProperty({ description: 'To address' })
  @IsString()
  to: string;

  @ApiProperty({ description: 'Transaction value in ETH' })
  @IsString()
  value: string;

  @ApiProperty({ description: 'Transaction timestamp' })
  @IsDate()
  timestamp: number;

  @ApiPropertyOptional({ description: 'Gas price in Gwei' })
  @IsOptional()
  @IsString()
  gasPrice?: string;

  @ApiProperty({ description: 'Transaction type', enum: TransactionType })
  @IsEnum(TransactionType)
  transactionType: TransactionType;

  @ApiPropertyOptional({ description: 'Token information', type: TokenInfoDto })
  @IsOptional()
  @Type(() => TokenInfoDto)
  tokenInfo?: TokenInfoDto;

  @ApiPropertyOptional({ description: 'Transaction input data' })
  @IsOptional()
  @IsString()
  input?: string;

  @ApiPropertyOptional({ description: 'ETH invested amount' })
  @IsOptional()
  @IsString()
  ethInvested?: string;

  @ApiPropertyOptional({ description: 'Token amount' })
  @IsOptional()
  @IsString()
  tokenAmount?: string;

  @ApiPropertyOptional({ description: 'Block number' })
  @IsOptional()
  @IsNumber()
  blockNumber?: number;

  @ApiPropertyOptional({ description: 'Transaction status' })
  @IsOptional()
  @IsString()
  status?: string;
  @ApiPropertyOptional({ description: 'chain' })
  @IsOptional()
  @IsString()
  chain?: string;
}

export class AddressTokensDto {
  @ApiProperty({ description: 'Ethereum address' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'Token holdings', type: [TokenInfoDto] })
  @IsArray()
  @Type(() => TokenInfoDto)
  tokens: TokenInfoDto[];

  @ApiProperty({ description: 'Total value in USD' })
  @IsNumber()
  totalValueUsd: number;

  @ApiProperty({ description: 'Last updated timestamp' })
  @IsDateString()
  lastUpdated: string;
}

export class WhaleStatsDto {
  @ApiProperty({ description: 'Total number of tracked whales' })
  @IsNumber()
  totalWhales: number;

  @ApiProperty({ description: 'Total number of transactions' })
  @IsNumber()
  totalTransactions: number;

  @ApiProperty({ description: 'Total value in ETH' })
  @IsString()
  totalValueEth: string;

  @ApiProperty({ description: 'Total value in USD' })
  @IsString()
  totalValueUsd: string;

  @ApiProperty({ description: 'Last 24h statistics' })
  last24h: {
    transactions: number;
    valueEth: string;
  };

  @ApiProperty({ description: 'Current ETH price' })
  @IsNumber()
  ethPrice: number;

  @ApiProperty({ description: 'Last updated timestamp' })
  @IsDateString()
  lastUpdated: string;
}

export class TrendingTokenDto {
  @ApiProperty({ description: 'Token address' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'Token name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Token symbol' })
  @IsString()
  symbol: string;

  @ApiProperty({ description: 'Number of whale transactions' })
  @IsNumber()
  whaleTransactions: number;

  @ApiProperty({ description: 'Total volume' })
  @IsNumber()
  totalVolume: number;

  @ApiProperty({ description: 'Number of unique whales' })
  @IsNumber()
  uniqueWhales: number;

  @ApiProperty({ description: '24h price change percentage' })
  @IsNumber()
  priceChange24h: number;
}

export class TrendingTokensResponseDto {
  @ApiProperty({ description: 'Timeframe for analysis' })
  @IsString()
  timeframe: string;

  @ApiProperty({ description: 'Trending tokens', type: [TrendingTokenDto] })
  @IsArray()
  @Type(() => TrendingTokenDto)
  tokens: TrendingTokenDto[];

  @ApiProperty({ description: 'Last updated timestamp' })
  @IsDateString()
  lastUpdated: string;
}