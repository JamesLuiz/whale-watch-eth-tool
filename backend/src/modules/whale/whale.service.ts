import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
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

@Injectable()
export class WhaleService {
  private readonly logger = new Logger(WhaleService.name);
  private provider: ethers.JsonRpcProvider;
  private wsProvider: ethers.WebSocketProvider;
  private whaleAddresses: Map<string, IWhaleAddress> = new Map();
  private recentTransactions: WhaleTransactionDto[] = [];
  private ethPrice: number = 3000; // Default ETH price
  private readonly minWhaleBalance: number;
  private readonly minTransactionValue: number;
  private readonly maxTrackedTransactions: number;

  constructor(
    private configService: ConfigService,
    private whaleGateway: WhaleGateway,
    private tokenService: TokenService,
  ) {
    this.minWhaleBalance = this.configService.get<number>('MIN_WHALE_BALANCE_ETH', 100);
    this.minTransactionValue = this.configService.get<number>('MIN_TRANSACTION_VALUE_ETH', 50);
    this.maxTrackedTransactions = this.configService.get<number>('MAX_TRACKED_TRANSACTIONS', 1000);

    this.initializeProviders();
    this.startMonitoring();
    this.generateMockData(); // Generate initial mock data
  }

  private initializeProviders() {
    const rpcUrl = this.configService.get<string>('ETHEREUM_RPC_URL');
    const wsUrl = this.configService.get<string>('ETHEREUM_WS_URL');

    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    if (wsUrl) {
      this.wsProvider = new ethers.WebSocketProvider(wsUrl);
    }
  }

  private generateMockData() {
    // Generate initial mock transactions
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
        timestamp: Date.now() - (i * 300000), // 5 minutes apart
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
      // Monitor pending transactions
      this.wsProvider.on('pending', async (txHash) => {
        try {
          const tx = await this.provider.getTransaction(txHash);
          if (tx && this.isWhaleTransaction(tx)) {
            await this.processWhaleTransaction(tx);
          }
        } catch (error) {
          // Ignore errors for pending transactions
        }
      });

      // Monitor new blocks for confirmed transactions
      this.wsProvider.on('block', async (blockNumber) => {
        await this.processBlock(blockNumber);
      });

      this.logger.log('Started monitoring whale transactions');
    } catch (error) {
      this.logger.error('Failed to start monitoring:', error.message);
    }
  }

  private isWhaleTransaction(tx: any): boolean {
    if (!tx.value) return false;
    
    const valueEth = EthereumUtil.formatEther(tx.value.toString());
    return EthereumUtil.isWhaleTransaction(valueEth, this.minTransactionValue);
  }

  private async processWhaleTransaction(tx: any) {
    try {
      const valueEth = EthereumUtil.formatEther(tx.value.toString());
      const valueUsd = EthereumUtil.calculateUsdValue(valueEth, this.ethPrice);

      const whaleTransaction: WhaleTransactionDto = {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: valueEth,
        gasPrice: EthereumUtil.formatGwei(tx.gasPrice?.toString() || '0'),
        timestamp: new Date(),
        blockNumber: tx.blockNumber || 0,
        transactionType: TransactionType.TRANSFER,
        input: tx.data || '0x',
        status: 'pending'
      };

      // Check if it's a token transfer
      if (tx.data && tx.data !== '0x') {
        const tokenInfo = await this.tokenService.analyzeTransaction(tx);
        if (tokenInfo) {
          whaleTransaction.tokenInfo = tokenInfo;
          whaleTransaction.transactionType = this.determineTransactionType(tx.data);
        }
      }

      // Add to recent transactions
      this.addTransaction(whaleTransaction);

      // Update whale addresses
      await this.updateWhaleAddress(tx.from);
      if (tx.to) {
        await this.updateWhaleAddress(tx.to);
      }

      // Emit to WebSocket clients
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
      case '0x40c10f19': // mint
        return TransactionType.MINT;
      case '0x38ed1739': // swap
        return TransactionType.SWAP;
      default:
        return TransactionType.TRANSFER;
    }
  }
  private async processBlock(blockNumber: number) {
    try {
      const block = await this.provider.getBlock(blockNumber, true);
      if (!block || !block.transactions) return;

      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue;
        
        if (this.isWhaleTransaction(tx)) {
          // Update existing pending transaction or create new one
          const existingTx = this.recentTransactions.find(t => t.hash === tx.hash);
          if (existingTx) {
            existingTx.status = 'confirmed';
            existingTx.blockNumber = blockNumber;
            existingTx.timestamp = block.timestamp * 1000;
            
            // Get receipt for gas used
            try {
              const receipt = await this.provider.getTransactionReceipt(tx.hash);
            } catch (error) {
              // Ignore receipt errors
            }
          } else {
            await this.processWhaleTransaction(tx);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error processing block ${blockNumber}:`, error.message);
    }
  }

  private addTransaction(transaction: WhaleTransactionDto) {
    this.recentTransactions.unshift(transaction);
    
    // Keep only the most recent transactions
    if (this.recentTransactions.length > this.maxTrackedTransactions) {
      this.recentTransactions = this.recentTransactions.slice(0, this.maxTrackedTransactions);
    }
    
    // Generate a new mock transaction periodically
    if (Math.random() < 0.1) { // 10% chance
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
      const balanceEth = EthereumUtil.formatEther(balance.toString());
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
    try {
      const response = await axios.get(
        `${this.configService.get('COINGECKO_API_URL')}/simple/price?ids=ethereum&vs_currencies=usd`
      );
      this.ethPrice = response.data.ethereum.usd;
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

    // Sort by balance descending
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
        priceChange24h: (Math.random() - 0.5) * 20, // Mock price change
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