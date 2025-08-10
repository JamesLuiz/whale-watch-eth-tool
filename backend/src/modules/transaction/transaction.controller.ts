import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TransactionService } from './transaction.service';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Get(':hash')
  @ApiOperation({ summary: 'Get transaction details by hash' })
  @ApiResponse({ status: 200, description: 'Transaction details retrieved successfully' })
  @ApiParam({ name: 'hash', description: 'Transaction hash' })
  async getTransaction(@Param('hash') hash: string) {
    return this.transactionService.getTransactionDetails(hash);
  }

  @Get(':hash/analysis')
  @ApiOperation({ summary: 'Get detailed transaction analysis' })
  @ApiResponse({ status: 200, description: 'Transaction analysis retrieved successfully' })
  @ApiParam({ name: 'hash', description: 'Transaction hash' })
  async getTransactionAnalysis(@Param('hash') hash: string) {
    return this.transactionService.analyzeTransaction(hash);
  }

  @Get('address/:address')
  @ApiOperation({ summary: 'Get transactions for an address' })
  @ApiResponse({ status: 200, description: 'Address transactions retrieved successfully' })
  @ApiParam({ name: 'address', description: 'Ethereum address' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAddressTransactions(
    @Param('address') address: string,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.transactionService.getAddressTransactions(address, paginationDto);
  }
}