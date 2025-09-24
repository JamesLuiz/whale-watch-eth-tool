import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { WhaleService } from './whale.service';
import { PaginationDto, PaginatedResponse } from '../../common/dto/pagination.dto';
import { 
  WhaleTransactionDto, 
  AddressTokensDto, 
  WhaleStatsDto, 
  TrendingTokensResponseDto 
} from '../../common/dto/whale.dto';
import { 
  WhaleTransactionQueryDto, 
  WhaleAddressQueryDto, 
  TrendingTokensQueryDto 
} from './dto/whale-query.dto';

@ApiTags('whales')
@Controller('whales')
export class WhaleController {
  constructor(private readonly whaleService: WhaleService) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Get recent whale transactions' })
  @ApiResponse({ 
    status: 200, 
    description: 'Whale transactions retrieved successfully',
    type: 'object',
    schema: {
      allOf: [
        { $ref: '#/components/schemas/PaginatedResponse' },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/WhaleTransactionDto' }
            }
          }
        }
      ]
    }
  })
  async getWhaleTransactions(
    @Query() queryDto: WhaleTransactionQueryDto,
  ): Promise<PaginatedResponse<WhaleTransactionDto>> {
    return this.whaleService.getWhaleTransactions(queryDto);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get tracked whale addresses' })
  @ApiResponse({ 
    status: 200, 
    description: 'Whale addresses retrieved successfully',
    type: 'object'
  })
  async getWhaleAddresses(
    @Query() queryDto: WhaleAddressQueryDto,
  ) {
    return this.whaleService.getWhaleAddresses(queryDto);
  }

  @Get('addresses/:address')
  @ApiOperation({ summary: 'Get whale address details' })
  @ApiResponse({ status: 200, description: 'Whale address details retrieved successfully' })
  @ApiParam({ name: 'address', description: 'Ethereum address' })
  async getWhaleAddress(@Param('address') address: string) {
    return this.whaleService.getWhaleAddressDetails(address);
  }

  @Get('addresses/:address/transactions')
  @ApiOperation({ summary: 'Get transactions for a specific whale address' })
  @ApiResponse({ 
    status: 200, 
    description: 'Address transactions retrieved successfully',
    type: 'object'
  })
  @ApiParam({ name: 'address', description: 'Ethereum address' })
  async getAddressTransactions(
    @Param('address') address: string,
    @Query() paginationDto: PaginationDto,
  ): Promise<PaginatedResponse<WhaleTransactionDto>> {
    return this.whaleService.getAddressTransactions(address, paginationDto);
  }

  @Get('addresses/:address/tokens')
  @ApiOperation({ summary: 'Get token holdings for a whale address' })
  @ApiResponse({ 
    status: 200, 
    description: 'Token holdings retrieved successfully',
    type: AddressTokensDto
  })
  @ApiParam({ name: 'address', description: 'Ethereum address' })
  async getAddressTokens(@Param('address') address: string): Promise<AddressTokensDto> {
    return this.whaleService.getAddressTokenHoldings(address);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get whale tracking statistics' })
  @ApiResponse({ 
    status: 200, 
    description: 'Statistics retrieved successfully',
    type: WhaleStatsDto
  })
  async getWhaleStats(): Promise<WhaleStatsDto> {
    return this.whaleService.getWhaleStats();
  }

  @Get('trending-tokens')
  @ApiOperation({ summary: 'Get trending tokens among whales' })
  @ApiResponse({ 
    status: 200, 
    description: 'Trending tokens retrieved successfully',
    type: TrendingTokensResponseDto
  })
  async getTrendingTokens(@Query() queryDto: TrendingTokensQueryDto): Promise<TrendingTokensResponseDto> {
    return this.whaleService.getTrendingTokens(queryDto.timeframe || '24h');
  }
}