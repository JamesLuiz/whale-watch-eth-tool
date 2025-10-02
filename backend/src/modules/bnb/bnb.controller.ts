import { Controller, Get, Query, HttpStatus } from '@nestjs/common';
import { BnbService } from './bnb.service';
import { ApiTags, ApiResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PaginationDto, PaginatedResponse } from '../../common/dto/pagination.dto';
import { WhaleTransactionDto } from '../../common/dto/whale.dto';

@ApiTags('bnb')
@Controller('bnb')
export class BnbController {
  constructor(private readonly bnbService: BnbService) {}

  @Get('transactions')
  @ApiOperation({ summary: 'Get a paginated list of recent BNB whale transactions' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponse, description: 'A list of recent BNB whale transactions' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number', example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page', example: 25 })
  public getBnbTransactions(@Query() query: PaginationDto): PaginatedResponse<WhaleTransactionDto> {
    return this.bnbService.getBnbTransactions(query);
  }
}