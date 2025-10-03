import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers, JsonRpcProvider, WebSocketProvider, TransactionResponse } from 'ethers';
import axios from 'axios';
import { WhaleGateway } from './whale.gateway';
import { TokenService } from '../token/token.service';
import { PaginationDto, PaginatedResponse } from '../../common/dto/pagination.dto';
import { IWhaleAddress, IWhaleTransaction, ITokenTransfer, ITokenInfo } from '../../common/interfaces/whale.interface';
import { EthereumUtil } from '../../common/utils/ethereum.util';
import { 
  WhaleTransactionDto, 
  AddressTokensDto, 
  WhaleStatsDto, 
  TrendingTokensResponseDto,
  TransactionType,
  TokenInfoDto
} from '../../common/dto/whale.dto';
import { WhaleTransactionQueryDto, WhaleAddressQueryDto } from './dto/whale-query.dto';

class RateLimitedBatchProcessor {
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private readonly batchSize: number;
  private readonly delayMs: number;
  private readonly logger = new Logger(RateLimitedBatchProcessor.name);

  constructor(batchSize: number = 10, delayMs: number = 100) {
    this.batchSize = batchSize;
    this.delayMs = delayMs;
  }

  async add<T>(asyncOperation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await asyncOperation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.processing = true;
    this.logger.log(`Starting to process queue with ${this.queue.length} items...`);

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      
      try {
        await Promise.all(batch.map(operation => operation()));
        
        if (this.queue.length > 0) {
          this.logger.log(`Processed batch of ${batch.length}. Waiting for ${this.delayMs}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, this.delayMs));
        }
      } catch (error) {
        this.logger.error('Batch processing error:', error);
      }
    }

    this.processing = false;
    this.logger.log('Finished processing queue.');
  }
}

@Injectable()
export class WhaleService {
  private readonly logger = new Logger(WhaleService.name);
  private provider: JsonRpcProvider;
  private wsProvider: WebSocketProvider;
  private whaleAddresses: Map<string, IWhaleAddress> = new Map();
  private recentTransactions: WhaleTransactionDto[] = [];
  private ethPrice: number = 3000;
  private readonly minWhaleBalance: number;
  private readonly minTransactionValue: number;
  private readonly maxTrackedTransactions: number;

  private rateLimitedProcessor = new RateLimitedBatchProcessor(10, 1000); 
  private errorCount = 0;
  private readonly maxErrors = 10;
  private circuitBreakerOpen = false;
  private circuitBreakerTimeout: NodeJS.Timeout | null = null; 
  constructor(
    private configService: ConfigService,
    private whaleGateway: WhaleGateway,
    private tokenService: TokenService,
  ) {
    this.minWhaleBalance = this.configService.get<number>('MIN_WHALE_BALANCE_ETH', 100);
    this.minTransactionValue = this.configService.get<number>('MIN_TRANSACTION_VALUE_ETH', 5);
    this.maxTrackedTransactions = this.configService.get<number>('MAX_TRACKED_TRANSACTIONS', 1000);

    this.initializeProviders();
    this.startMonitoring();
    this.generateMockData();
  }

  private initializeProviders() {
    const rpcUrl = this.configService.get<string>('ETHEREUM_RPC_URL');
    const wsUrl = this.configService.get<string>('ETHEREUM_WS_URL');

    if (rpcUrl) {
      this.provider = new JsonRpcProvider(rpcUrl);
    }

    if (wsUrl) {
      this.wsProvider = new WebSocketProvider(wsUrl);
    }
  }

  private generateMockData() {
    const mockTransactions: WhaleTransactionDto[] = [];
    const transactionTypes = [TransactionType.TRANSFER, TransactionType.MINT, TransactionType.SWAP];
    
    const mockTokens: TokenInfoDto[] = [
      { address: '0xA0b86a33E6441', name: 'Uniswap', symbol: 'UNI', decimals: 18 },
      { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18 },
      { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'Tether USD', symbol: 'USDT', decimals: 6 },
      { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', name: 'Shiba Inu', symbol: 'SHIB', decimals: 18 },
      { 
        address: '0x1234567890abcdef', 
        name: 'MoonRocket', 
        symbol: 'MOON', 
        decimals: 18, 
        isNewlyLaunched: true, 
        launchDate: Date.now() - 86400000,
        marketCap: 2500000 
      },
    ];

    for (let i = 0; i < 10; i++) {
      const ethValue = (Math.random() * 1000 + 100).toFixed(4);
      const transactionType = transactionTypes[Math.floor(Math.random() * transactionTypes.length)];
      const tokenInfo = Math.random() > 0.3 ? mockTokens[Math.floor(Math.random() * mockTokens.length)] : undefined;
      
      const transaction: WhaleTransactionDto = {
        hash: `0x${Math.random().toString(16).substring(2, 66)}`,
        from: `0x${Math.random().toString(16).substring(2, 42)}`,
        to: `0x${Math.random().toString(16).substring(2, 42)}`,
        value: ethValue,
        timestamp: Date.now() - (i * 300000),
        gasPrice: (Math.random() * 100 + 20).toFixed(2),
        transactionType,
        tokenInfo,
        input: tokenInfo ? (transactionType === TransactionType.MINT ? "0x40c10f19" : "0xa9059cbb") : "0x",
        ethInvested: transactionType !== TransactionType.TRANSFER ? ethValue : undefined,
        tokenAmount: tokenInfo ? (Math.random() * 1000000 + 10000).toFixed(2) : undefined,
        blockNumber: 18500000 + i,
        status: 'confirmed'
      };
      
      mockTransactions.push(transaction);
    }
    
    this.recentTransactions = mockTransactions;
  }
  
 private async startMonitoring() {
  if (!this.wsProvider) {
    this.logger.warn('WebSocket provider not configured, using polling instead');
    return;
  }

  try {
    // Clear existing listeners to prevent memory leaks on restart
    this.wsProvider.removeAllListeners('pending');
    this.wsProvider.removeAllListeners('block');
    this.wsProvider.removeAllListeners('error');

    this.wsProvider.on('pending', async (txHash) => {
      try {
        this.rateLimitedProcessor.add(async () => {
          const tx = await this.provider.getTransaction(txHash);
          if (tx && this.isWhaleTransaction(tx)) {
            await this.processWhaleTransaction(tx);
          }
        });
      } catch (error) {
        this.logger.warn('Error processing pending transaction:', error.message);
      }
    });

    this.wsProvider.on('block', async (blockNumber: number) => {
      await this.processBlockWithCircuitBreaker(blockNumber);
    });

    // Add an error listener to the WebSocket provider itself
    this.wsProvider.on('error', (error) => {
        this.logger.error('WebSocket provider error:', error.message);
        this.reconnect();
    });

    this.logger.log('Started optimized whale transaction monitoring');

  } catch (error) {
    this.logger.error('Failed to start monitoring:', error.message);
    this.reconnect();
  }
}

private reconnect() {
    this.logger.log('Attempting to reconnect in 10 seconds...');
    setTimeout(() => {
        this.initializeProviders();
        this.startMonitoring();
    }, 3000); // 3-second delay before attempting to reconnect
}

  private isWhaleTransaction(tx: any): boolean {
    if (!tx.value) return false;
    
    const valueEth = ethers.formatEther(tx.value);
    const floatValue = parseFloat(valueEth);
    
    return floatValue >= this.minTransactionValue && floatValue <= 100;
  }
  
  private async processWhaleTransaction(tx: any) {
    try {
      const valueEth = ethers.formatEther(tx.value);
      const valueUsd = EthereumUtil.calculateUsdValue(valueEth, this.ethPrice);

      const whaleTransaction: WhaleTransactionDto = {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: valueEth,
        gasPrice: ethers.formatUnits(tx.gasPrice, 'gwei'),
        timestamp: new Date().getTime(),
        blockNumber: tx.blockNumber || 0,
        transactionType: TransactionType.TRANSFER,
        input: tx.data || '0x',
        status: 'pending'
      };

      this.logger.log(`Filtered Whale Transaction: 
        Hash: ${whaleTransaction.hash}
        From: ${whaleTransaction.from}
        To: ${whaleTransaction.to}
        Value: ${whaleTransaction.value} ETH
        Timestamp: ${new Date(whaleTransaction.timestamp).toISOString()}`
      );

      if (tx.data && tx.data !== '0x') {
        const tokenInfo = await this.tokenService.analyzeTransaction(tx);
        if (tokenInfo) {
          whaleTransaction.tokenInfo = tokenInfo;
          whaleTransaction.transactionType = this.determineTransactionType(tx.data);
        }
      }

      this.addTransaction(whaleTransaction);

      await this.updateWhaleAddress(tx.from);
      if (tx.to) {
        await this.updateWhaleAddress(tx.to);
      }

      this.whaleGateway.emitNewTransaction(whaleTransaction);

      this.logger.log(`New whale transaction: ${tx.hash} (${valueEth} ETH)`);
    } catch (error) {
      this.logger.error('Error processing whale transaction:', error.message);
    }
  }
  
  private determineTransactionType(data: string): TransactionType {
    if (!data || data === '0x') return TransactionType.TRANSFER;
    
    const methodSig = data.slice(0, 10);
    switch (methodSig) {
      case '0x40c10f19':
        return TransactionType.MINT;
      case '0x38ed1739':
        return TransactionType.SWAP;
      default:
        return TransactionType.TRANSFER;
    }
  }
  
  private async processBlock(blockNumber: number) {
    try {
        const block = await this.provider.getBlock(blockNumber, false);
        if (!block || !block.transactions) return;

        this.logger.log(`Processing block ${blockNumber} with ${block.transactions.length} transactions...`);

        // Limit to the first 50 transactions
        const potentialWhaleHashes = (block.transactions as string[]).slice(0, 50);

        this.logger.log(`Found ${potentialWhaleHashes.length} potential whale transactions in block ${blockNumber}`);

        const processingPromises = potentialWhaleHashes.map(txHash =>
            this.rateLimitedProcessor.add(async () => {
                const tx = await this.provider.getTransaction(txHash);
                if (tx && this.isWhaleTransaction(tx)) {
                    await this.processWhaleTransaction(tx);
                }
            })
        );

        await Promise.allSettled(processingPromises);

        this.logger.log(`Processed block ${blockNumber}`);

    } catch (error) {
        this.logger.error(`Error processing block ${blockNumber}:`, error.message);
        throw error;
    }
}
  
  private async processBlockWithCircuitBreaker(blockNumber: number) {
    if (this.circuitBreakerOpen) {
      this.logger.warn(`Circuit breaker open, skipping block ${blockNumber}`);
      return;
    }
    
    try {
      await this.processBlock(blockNumber);
      this.errorCount = 0;
    } catch (error) {
      this.errorCount++;
      
      if (error.code === 'BAD_DATA' && this.errorCount >= this.maxErrors) {
        this.openCircuitBreaker();
      }
    }
  }

  private openCircuitBreaker() {
    this.circuitBreakerOpen = true;
    this.logger.error('Circuit breaker opened due to too many errors');
    
    this.circuitBreakerTimeout = setTimeout(() => {
      this.circuitBreakerOpen = false;
      this.errorCount = 0;
      this.logger.log('Circuit breaker closed, resuming processing');
    }, 5 * 60 * 1000);
  }

  private addTransaction(transaction: WhaleTransactionDto) {
    this.recentTransactions.unshift(transaction);
    
    if (this.recentTransactions.length > this.maxTrackedTransactions) {
      this.recentTransactions = this.recentTransactions.slice(0, this.maxTrackedTransactions);
    }
    
    if (Math.random() < 0.1) {
      setTimeout(() => this.generateNewMockTransaction(), Math.random() * 10000 + 5000);
    }
  }

  private generateNewMockTransaction() {
    const mockTokens: TokenInfoDto[] = [
      { address: '0xA0b86a33E6441', name: 'Uniswap', symbol: 'UNI', decimals: 18 },
      { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', name: 'Shiba Inu', symbol: 'SHIB', decimals: 18 },
      { 
        address: '0x1234567890abcdef', 
        name: 'MoonRocket', 
        symbol: 'MOON', 
        decimals: 18, 
        isNewlyLaunched: true, 
        launchDate: Date.now() - 86400000,
        marketCap: 2500000 
      },
    ];

    const ethValue = (Math.random() * 1000 + 100).toFixed(4);
    const transactionTypes = [TransactionType.TRANSFER, TransactionType.MINT, TransactionType.SWAP];
    const transactionType = transactionTypes[Math.floor(Math.random() * transactionTypes.length)];
    const tokenInfo = Math.random() > 0.4 ? mockTokens[Math.floor(Math.random() * mockTokens.length)] : undefined;
    
    const newTransaction: WhaleTransactionDto = {
      hash: `0x${Math.random().toString(16).substring(2, 66)}`,
      from: `0x${Math.random().toString(16).substring(2, 42)}`,
      to: `0x${Math.random().toString(16).substring(2, 42)}`,
      value: ethValue,
      timestamp: Date.now(),
      gasPrice: (Math.random() * 100 + 20).toFixed(2),
      transactionType,
      tokenInfo,
      input: tokenInfo ? (transactionType === TransactionType.MINT ? "0x40c10f19" : "0xa9059cbb") : "0x",
      ethInvested: transactionType !== TransactionType.TRANSFER ? ethValue : undefined,
      tokenAmount: tokenInfo ? (Math.random() * 1000000 + 10000).toFixed(2) : undefined,
      blockNumber: 18500000 + Math.floor(Math.random() * 1000),
      status: 'confirmed'
    };
    
    this.addTransaction(newTransaction);
    this.whaleGateway.emitNewTransaction(newTransaction);
  }

  private async updateWhaleAddress(address: string) {
    try {
      const balance = await this.provider.getBalance(address);
      const balanceEth = ethers.formatEther(balance);
      const balanceUsd = EthereumUtil.calculateUsdValue(balanceEth, this.ethPrice);

      if (parseFloat(balanceEth) >= this.minWhaleBalance) {
        const existing = this.whaleAddresses.get(address);
        const now = new Date();

        const whaleAddress: IWhaleAddress = {
          address,
          balance: balanceEth,
          balanceUsd,
          firstSeen: existing?.firstSeen || now,
          lastActivity: now,
          transactionCount: (existing?.transactionCount || 0) + 1,
          tags: existing?.tags || [],
          isActive: true,
        };

        this.whaleAddresses.set(address, whaleAddress);
      }
    } catch (error) {
      this.logger.error(`Error updating whale address ${address}:`, error.message);
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  private async updateEthPrice() {
    const etherscanApiKey = this.configService.get('ETHERSCAN_API_KEY');
    try {
      // Try Etherscan first
      const response = await axios.get(
        `https://api.etherscan.io/api?module=stats&action=ethprice&apikey=${etherscanApiKey}`,
        { timeout: 8000 }
      );

      let newEthPrice = parseFloat(response?.data?.result?.ethusd);

      // Fallback to CoinGecko if invalid or NaN
      if (!isFinite(newEthPrice) || newEthPrice <= 0) {
        const cg = await axios.get(
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
          { timeout: 8000 }
        );
        newEthPrice = parseFloat(cg?.data?.ethereum?.usd);
      }

      if (isFinite(newEthPrice) && newEthPrice > 0 && newEthPrice !== this.ethPrice) {
        this.ethPrice = newEthPrice;
        this.logger.log(`ETH price updated to: ${this.ethPrice}`);
      }
    } catch (error) {
      this.logger.error('Failed to update ETH price:', error.message);
    }
  }

  async getWhaleTransactions(
    queryDto: WhaleTransactionQueryDto,
  ): Promise<PaginatedResponse<WhaleTransactionDto>> {
    let transactions = [...this.recentTransactions];

    if (queryDto.minValue) {
      transactions = transactions.filter(tx => parseFloat(tx.value) >= queryDto.minValue);
    }

    if (queryDto.tokenFilter && queryDto.tokenFilter !== 'all') {
      if (queryDto.tokenFilter === 'newly-launched') {
        transactions = transactions.filter(tx => tx.tokenInfo?.isNewlyLaunched === true);
      } else {
        transactions = transactions.filter(tx => tx.tokenInfo?.symbol === queryDto.tokenFilter);
      }
    }

    const total = transactions.length;
    const startIndex = (queryDto.page - 1) * queryDto.limit;
    const endIndex = startIndex + queryDto.limit;
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    return new PaginatedResponse(paginatedTransactions, total, queryDto.page, queryDto.limit);
  }

  async getWhaleAddresses(
    queryDto: WhaleAddressQueryDto,
  ): Promise<PaginatedResponse<IWhaleAddress>> {
    let addresses = Array.from(this.whaleAddresses.values());

    if (queryDto.minBalance) {
      addresses = addresses.filter(addr => parseFloat(addr.balance) >= queryDto.minBalance);
    }

    addresses.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));

    const total = addresses.length;
    const startIndex = (queryDto.page - 1) * queryDto.limit;
    const endIndex = startIndex + queryDto.limit;
    const paginatedAddresses = addresses.slice(startIndex, endIndex);

    return new PaginatedResponse(paginatedAddresses, total, queryDto.page, queryDto.limit);
  }

  async getWhaleAddressDetails(address: string): Promise<IWhaleAddress | null> {
    if (!EthereumUtil.isValidAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }

    const checksumAddress = EthereumUtil.checksumAddress(address);
    return this.whaleAddresses.get(checksumAddress) || null;
  }

  async getAddressTransactions(
    address: string,
    paginationDto: PaginationDto,
  ): Promise<PaginatedResponse<WhaleTransactionDto>> {
    if (!EthereumUtil.isValidAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }

    const checksumAddress = EthereumUtil.checksumAddress(address);
    const transactions = this.recentTransactions.filter(
      tx => tx.from === checksumAddress || tx.to === checksumAddress
    );

    const total = transactions.length;
    const startIndex = (paginationDto.page - 1) * paginationDto.limit;
    const endIndex = startIndex + paginationDto.limit;
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    return new PaginatedResponse(paginatedTransactions, total, paginationDto.page, paginationDto.limit);
  }

  async getAddressTokenHoldings(address: string): Promise<AddressTokensDto> {
    if (!EthereumUtil.isValidAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }

    return this.tokenService.getAddressTokenHoldings(address);
  }

  async getWhaleStats(): Promise<WhaleStatsDto> {
    const totalWhales = this.whaleAddresses.size;
    const totalTransactions = this.recentTransactions.length;
    const totalValueEth = this.recentTransactions.reduce(
      (sum, tx) => sum + parseFloat(tx.value),
      0
    );
    const totalValueUsd = totalValueEth * this.ethPrice;

    const last24hTransactions = this.recentTransactions.filter(
      tx => Date.now() - tx.timestamp < 24 * 60 * 60 * 1000
    );

    return {
      totalWhales,
      totalTransactions,
      totalValueEth: totalValueEth.toFixed(2),
      totalValueUsd: totalValueUsd.toFixed(2),
      last24h: {
        transactions: last24hTransactions.length,
        valueEth: last24hTransactions.reduce((sum, tx) => sum + parseFloat(tx.value), 0).toFixed(2),
      },
      ethPrice: this.ethPrice,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getTrendingTokens(timeframe: string = '24h'): Promise<TrendingTokensResponseDto> {
    const timeMs = this.getTimeframeMs(timeframe);
    const cutoffTime = Date.now() - timeMs;

    const recentTokenTransactions = this.recentTransactions.filter(
      tx => tx.tokenInfo && 
            tx.tokenInfo && 
            tx.timestamp > cutoffTime
    );

    const tokenStats = new Map<string, any>();

    recentTokenTransactions.forEach(tx => {
      if (!tx.tokenInfo) return;

      const key = tx.tokenInfo.address;
      const existing = tokenStats.get(key);

      if (existing) {
        existing.transactionCount++;
        existing.totalVolume += parseFloat(tx.value) * this.ethPrice;
        existing.uniqueWhales.add(tx.from);
      } else {
        tokenStats.set(key, {
          ...tx.tokenInfo,
          transactionCount: 1,
          totalVolume: parseFloat(tx.value) * this.ethPrice,
          uniqueWhales: new Set([tx.from]),
        });
      }
    });

    const trending = Array.from(tokenStats.values())
      .map(token => ({
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        whaleTransactions: token.transactionCount,
        totalVolume: token.totalVolume,
        uniqueWhales: token.uniqueWhales.size,
        priceChange24h: (Math.random() - 0.5) * 20,
      }))
      .sort((a, b) => b.whaleTransactions - a.whaleTransactions)
      .slice(0, 20);

    return {
      timeframe,
      tokens: trending,
      lastUpdated: new Date().toISOString(),
    };
  }

  private getTimeframeMs(timeframe: string): number {
    switch (timeframe) {
      case '1h': return 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d': return 7 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }
}