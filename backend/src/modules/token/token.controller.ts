import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TokenService } from './token.service';

@ApiTags('tokens')
@Controller('tokens')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Get(':address')
  @ApiOperation({ summary: 'Get token information by contract address' })
  @ApiResponse({ status: 200, description: 'Token information retrieved successfully' })
  @ApiParam({ name: 'address', description: 'Token contract address' })
  async getToken(@Param('address') address: string) {
    return this.tokenService.getTokenInfo(address);
  }

  @Get(':address/holders')
  @ApiOperation({ summary: 'Get token holders information' })
  @ApiResponse({ status: 200, description: 'Token holders retrieved successfully' })
  @ApiParam({ name: 'address', description: 'Token contract address' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of top holders to return' })
  async getTokenHolders(
    @Param('address') address: string,
    @Query('limit') limit: number = 100,
  ) {
    return this.tokenService.getTokenHolders(address, limit);
  }

  @Get(':address/price')
  @ApiOperation({ summary: 'Get token price information' })
  @ApiResponse({ status: 200, description: 'Token price retrieved successfully' })
  @ApiParam({ name: 'address', description: 'Token contract address' })
  async getTokenPrice(@Param('address') address: string) {
    return this.tokenService.getTokenPrice(address);
  }

  @Get('trending/whale-activity')
  @ApiOperation({ summary: 'Get tokens trending among whales' })
  @ApiResponse({ status: 200, description: 'Trending tokens retrieved successfully' })
  @ApiQuery({ name: 'timeframe', required: false, enum: ['1h', '24h', '7d'] })
  async getTrendingTokens(@Query('timeframe') timeframe: string = '24h') {
    return this.tokenService.getTrendingTokensByWhaleActivity(timeframe);
  }

  @Get('search/:query')
  @ApiOperation({ summary: 'Search tokens by name or symbol' })
  @ApiResponse({ status: 200, description: 'Search results retrieved successfully' })
  @ApiParam({ name: 'query', description: 'Search query (name or symbol)' })
  async searchTokens(@Param('query') query: string) {
    return this.tokenService.searchTokens(query);
  }
}