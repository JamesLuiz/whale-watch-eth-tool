import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationDto {
  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PaginatedResponse<T> {
  @ApiPropertyOptional({ description: 'Array of items' })
  data: T[];
  
  @ApiPropertyOptional({ description: 'Total number of items' })
  total: number;
  
  @ApiPropertyOptional({ description: 'Current page number' })
  page: number;
  
  @ApiPropertyOptional({ description: 'Items per page' })
  limit: number;
  
  @ApiPropertyOptional({ description: 'Total number of pages' })
  totalPages: number;
  
  @ApiPropertyOptional({ description: 'Whether there is a next page' })
  hasNext: boolean;
  
  @ApiPropertyOptional({ description: 'Whether there is a previous page' })
  hasPrev: boolean;

  constructor(data: T[], total: number, page: number, limit: number) {
    this.data = data;
    this.total = total;
    this.page = page;
    this.limit = limit;
    this.totalPages = Math.ceil(total / limit);
    this.hasNext = page < this.totalPages;
    this.hasPrev = page > 1;
  }
}