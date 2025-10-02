import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min, Max, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class WhaleTransactionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Minimum transaction value in ETH', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minValue?: number;

  @ApiPropertyOptional({ description: 'Filter by token symbol' })
  @IsOptional()
  @IsString()
  tokenFilter?: string;
}

export class WhaleAddressQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Minimum balance in ETH', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minBalance?: number;
}

export enum TrendingTimeframe {
  ONE_HOUR = '1h',
  TWENTY_FOUR_HOURS = '24h',
  SEVEN_DAYS = '7d'
}

export class TrendingTokensQueryDto {
  @ApiPropertyOptional({ 
    description: 'Timeframe for trending analysis', 
    enum: TrendingTimeframe,
    default: TrendingTimeframe.TWENTY_FOUR_HOURS
  })
  @IsOptional()
  @IsEnum(TrendingTimeframe)
  timeframe?: TrendingTimeframe = TrendingTimeframe.TWENTY_FOUR_HOURS;
}