import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';
import axios from 'axios';
import { WhaleGateway } from './whale.gateway';
import { TokenService } from '../token/token.service';
import { PaginationDto, PaginatedResponse } from '../../common/dto/pagination.dto';
import { IWhaleAddress, IWhaleTransaction, ITokenTransfer } from '../../common/interfaces/whale.interface';
import { EthereumUtil } from '../../common/utils/ethereum.util';

@Injectable()
export class WhaleService {
  private readonly logger = new Logger(WhaleService.name);
  private provider: ethers.JsonRpcProvider;
  private wsProvider: ethers.WebSocketProvider;
  private whaleAddresses: Map<string, IWhaleAddress> = new Map();
  private recentTransactions: IWhaleTransaction[] = [];
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

      const whaleTransaction: IWhaleTransaction = {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: valueEth,
        valueUsd,
        gasPrice: EthereumUtil.formatGwei(tx.gasPrice?.toString() || '0'),
        gasUsed: '0', // Will be updated when confirmed
        timestamp: new Date(),
        blockNumber: tx.blockNumber || 0,
        isTokenTransfer: false,
        status: 'pending',
      };

      // Check if it's a token transfer
      if (tx.data && tx.data !== '0x') {
        const tokenInfo = await this.tokenService.analyzeTransaction(tx);
        if (tokenInfo) {
          whaleTransaction.isTokenTransfer = true;
          whaleTransaction.tokenInfo = tokenInfo;
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
            existingTx.timestamp = new Date(block.timestamp * 1000);
            
            // Get receipt for gas used
            try {
              const receipt = await this.provider.getTransactionReceipt(tx.hash);
              if (receipt) {
                existingTx.gasUsed = receipt.gasUsed.toString();
              }
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

  private addTransaction(transaction: IWhaleTransaction) {
    this.recentTransactions.unshift(transaction);
    
    // Keep only the most recent transactions
    if (this.recentTransactions.length > this.maxTrackedTransactions) {
      this.recentTransactions = this.recentTransactions.slice(0, this.maxTrackedTransactions);
    }
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
    paginationDto: PaginationDto,
    minValue?: number,
  ): Promise<PaginatedResponse<IWhaleTransaction>> {
    let transactions = [...this.recentTransactions];

    if (minValue) {
      transactions = transactions.filter(tx => parseFloat(tx.value) >= minValue);
    }

    const total = transactions.length;
    const startIndex = (paginationDto.page - 1) * paginationDto.limit;
    const endIndex = startIndex + paginationDto.limit;
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    return new PaginatedResponse(paginatedTransactions, total, paginationDto.page, paginationDto.limit);
  }

  async getWhaleAddresses(
    paginationDto: PaginationDto,
    minBalance?: number,
  ): Promise<PaginatedResponse<IWhaleAddress>> {
    let addresses = Array.from(this.whaleAddresses.values());

    if (minBalance) {
      addresses = addresses.filter(addr => parseFloat(addr.balance) >= minBalance);
    }

    // Sort by balance descending
    addresses.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));

    const total = addresses.length;
    const startIndex = (paginationDto.page - 1) * paginationDto.limit;
    const endIndex = startIndex + paginationDto.limit;
    const paginatedAddresses = addresses.slice(startIndex, endIndex);

    return new PaginatedResponse(paginatedAddresses, total, paginationDto.page, paginationDto.limit);
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
  ): Promise<PaginatedResponse<IWhaleTransaction>> {
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

  async getAddressTokenHoldings(address: string) {
    if (!EthereumUtil.isValidAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }

    return this.tokenService.getAddressTokenHoldings(address);
  }

  async getWhaleStats() {
    const totalWhales = this.whaleAddresses.size;
    const totalTransactions = this.recentTransactions.length;
    const totalValueEth = this.recentTransactions.reduce(
      (sum, tx) => sum + parseFloat(tx.value),
      0
    );
    const totalValueUsd = totalValueEth * this.ethPrice;

    const last24hTransactions = this.recentTransactions.filter(
      tx => Date.now() - tx.timestamp.getTime() < 24 * 60 * 60 * 1000
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

  async getTrendingTokens(timeframe: string = '24h') {
    const timeMs = this.getTimeframeMs(timeframe);
    const cutoffTime = Date.now() - timeMs;

    const recentTokenTransactions = this.recentTransactions.filter(
      tx => tx.isTokenTransfer && 
           tx.tokenInfo && 
           tx.timestamp.getTime() > cutoffTime
    );

    const tokenStats = new Map<string, any>();

    recentTokenTransactions.forEach(tx => {
      if (!tx.tokenInfo) return;

      const key = tx.tokenInfo.address;
      const existing = tokenStats.get(key);

      if (existing) {
        existing.transactionCount++;
        existing.totalVolume += tx.valueUsd;
        existing.uniqueWhales.add(tx.from);
      } else {
        tokenStats.set(key, {
          ...tx.tokenInfo,
          transactionCount: 1,
          totalVolume: tx.valueUsd,
          uniqueWhales: new Set([tx.from]),
        });
      }
    });

    const trending = Array.from(tokenStats.values())
      .map(token => ({
        ...token,
        uniqueWhales: token.uniqueWhales.size,
      }))
      .sort((a, b) => b.transactionCount - a.transactionCount)
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