import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { WhaleService } from './whale.service';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('whales')
@Controller('whales')
export class WhaleController {
  constructor(private readonly whaleService: WhaleService) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Get recent whale transactions' })
  @ApiResponse({ status: 200, description: 'Whale transactions retrieved successfully' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'minValue', required: false, type: Number, description: 'Minimum transaction value in ETH' })
  async getWhaleTransactions(
    @Query() paginationDto: PaginationDto,
    @Query('minValue') minValue?: number,
  ) {
    return this.whaleService.getWhaleTransactions(paginationDto, minValue);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get tracked whale addresses' })
  @ApiResponse({ status: 200, description: 'Whale addresses retrieved successfully' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'minBalance', required: false, type: Number, description: 'Minimum balance in ETH' })
  async getWhaleAddresses(
    @Query() paginationDto: PaginationDto,
    @Query('minBalance') minBalance?: number,
  ) {
    return this.whaleService.getWhaleAddresses(paginationDto, minBalance);
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
  @ApiResponse({ status: 200, description: 'Address transactions retrieved successfully' })
  @ApiParam({ name: 'address', description: 'Ethereum address' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAddressTransactions(
    @Param('address') address: string,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.whaleService.getAddressTransactions(address, paginationDto);
  }

  @Get('addresses/:address/tokens')
  @ApiOperation({ summary: 'Get token holdings for a whale address' })
  @ApiResponse({ status: 200, description: 'Token holdings retrieved successfully' })
  @ApiParam({ name: 'address', description: 'Ethereum address' })
  async getAddressTokens(@Param('address') address: string) {
    return this.whaleService.getAddressTokenHoldings(address);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get whale tracking statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getWhaleStats() {
    return this.whaleService.getWhaleStats();
  }

  @Get('trending-tokens')
  @ApiOperation({ summary: 'Get trending tokens among whales' })
  @ApiResponse({ status: 200, description: 'Trending tokens retrieved successfully' })
  @ApiQuery({ name: 'timeframe', required: false, enum: ['1h', '24h', '7d'], description: 'Time frame for trending analysis' })
  async getTrendingTokens(@Query('timeframe') timeframe: string = '24h') {
    return this.whaleService.getTrendingTokens(timeframe);
  }
}