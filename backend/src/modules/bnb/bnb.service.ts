import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers, JsonRpcProvider, WebSocketProvider, TransactionResponse } from 'ethers';
import axios from 'axios';
import { WhaleGateway } from '../whale/whale.gateway';
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
import { WhaleTransactionQueryDto, WhaleAddressQueryDto } from '../whale/dto/whale-query.dto';

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
export class BnbService { // Class name changed from WhaleService to BnbService
    private readonly logger = new Logger(BnbService.name); // Logger name changed
    private bnbProvider: JsonRpcProvider; // Provider name changed
    private bnbWsProvider: WebSocketProvider; // Provider name changed
    private whaleAddresses: Map<string, IWhaleAddress> = new Map();
    private recentTransactions: WhaleTransactionDto[] = [];
    private bnbPrice: number = 300; // Default BNB price
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
        // Updated to use BNB-specific config keys
        this.minWhaleBalance = this.configService.get<number>('MIN_WHALE_BALANCE_BNB', 100);
        this.minTransactionValue = this.configService.get<number>('MIN_TRANSACTION_VALUE_BNB', 50); // Set to 50 BNB
        this.maxTrackedTransactions = this.configService.get<number>('MAX_TRACKED_TRANSACTIONS', 1000);

        this.initializeProviders();
        this.startMonitoring();
    }

    private initializeProviders() {
        // Using BNB-specific environment variables
        const rpcUrl = this.configService.get<string>('BNB_RPC_URL');
        const wsUrl = this.configService.get<string>('BNB_WS_URL');

        if (rpcUrl) {
            this.bnbProvider = new JsonRpcProvider(rpcUrl);
        }

        if (wsUrl) {
            this.bnbWsProvider = new WebSocketProvider(wsUrl);
        }
    }

    private async startMonitoring() {
        if (!this.bnbWsProvider) {
            this.logger.warn('BNB WebSocket provider not configured, using polling instead');
            return;
        }

        try {
            
            this.bnbWsProvider.removeAllListeners('block');
            this.bnbWsProvider.removeAllListeners('error');

            

            this.bnbWsProvider.on('block', async (blockNumber: number) => {
                await this.processBlockWithCircuitBreaker(blockNumber);
            });

            this.bnbWsProvider.on('error', (error) => {
                this.logger.error('BNB WebSocket provider error:', error.message);
                this.reconnect();
            });

            this.logger.log('Started BNB Chain whale transaction monitoring');

        } catch (error) {
            this.logger.error('Failed to start BNB monitoring:', error.message);
            this.reconnect();
        }
    }

    private reconnect() {
        this.logger.log('Attempting to reconnect to BNB Chain in 3 seconds...');
        setTimeout(() => {
            this.initializeProviders();
            this.startMonitoring();
        }, 3000); 
    }

    private isWhaleTransaction(tx: any): boolean {
        if (!tx.value) return false;
        
        const valueBnb = ethers.formatEther(tx.value);
        const floatValue = parseFloat(valueBnb);
        
        // Check for 50 BNB or more
        return floatValue >= this.minTransactionValue;
    }
    
    private async processWhaleTransaction(tx: any) {
        try {
            const valueBnb = ethers.formatEther(tx.value);
            const valueUsd = EthereumUtil.calculateUsdValue(valueBnb, this.bnbPrice);

            const whaleTransaction: WhaleTransactionDto = {
                hash: tx.hash,
                from: tx.from,
                to: tx.to || '',
                value: valueBnb,
                gasPrice: ethers.formatUnits(tx.gasPrice, 'gwei'),
                timestamp: new Date().getTime(),
                blockNumber: tx.blockNumber || 0,
                transactionType: TransactionType.TRANSFER,
                input: tx.data || '0x',
                status: 'pending',
                chain: 'bnb', // Add chain identifier
            };

            this.logger.log(`Filtered BNB Whale Transaction: 
                Hash: ${whaleTransaction.hash}
                From: ${whaleTransaction.from}
                To: ${whaleTransaction.to}
                Value: ${whaleTransaction.value} BNB
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
            this.whaleGateway.emitNewTransaction(whaleTransaction);
            this.updateWhaleAddress(tx.from);
            if (tx.to) {
                this.updateWhaleAddress(tx.to);
            }
            this.logger.log(`New BNB whale transaction: ${tx.hash} (${valueBnb} BNB)`);
        } catch (error) {
            this.logger.error('Error processing BNB whale transaction:', error.message);
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
            const block = await this.bnbProvider.getBlock(blockNumber, false);
            if (!block || !block.transactions) return;

            this.logger.log(`Processing BNB block ${blockNumber} with ${block.transactions.length} transactions...`);

            const potentialWhaleHashes = (block.transactions as string[]).slice(0, 50);

            this.logger.log(`Found ${potentialWhaleHashes.length} potential whale transactions in BNB block ${blockNumber}`);

            const processingPromises = potentialWhaleHashes.map(txHash =>
                this.rateLimitedProcessor.add(async () => {
                    const tx = await this.bnbProvider.getTransaction(txHash);
                    if (tx && this.isWhaleTransaction(tx)) {
                        await this.processWhaleTransaction(tx);
                    }
                })
            );
            await Promise.allSettled(processingPromises);
            this.logger.log(`Processed BNB block ${blockNumber}`);
        } catch (error) {
            this.logger.error(`Error processing BNB block ${blockNumber}:`, error.message);
            throw error;
        }
    }
    
    private async processBlockWithCircuitBreaker(blockNumber: number) {
        if (this.circuitBreakerOpen) {
            this.logger.warn(`Circuit breaker open, skipping BNB block ${blockNumber}`);
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
        this.logger.error('BNB circuit breaker opened due to too many errors');
        
        this.circuitBreakerTimeout = setTimeout(() => {
            this.circuitBreakerOpen = false;
            this.errorCount = 0;
            this.logger.log('BNB circuit breaker closed, resuming processing');
        }, 5 * 60 * 1000);
    }

    private addTransaction(transaction: WhaleTransactionDto) {
        this.recentTransactions.unshift(transaction);
        
        if (this.recentTransactions.length > this.maxTrackedTransactions) {
            this.recentTransactions = this.recentTransactions.slice(0, this.maxTrackedTransactions);
        }
    }

    private async updateWhaleAddress(address: string) {
        try {
            const balance = await this.bnbProvider.getBalance(address);
            const balanceBnb = ethers.formatEther(balance);
            const balanceUsd = EthereumUtil.calculateUsdValue(balanceBnb, this.bnbPrice);

            if (parseFloat(balanceBnb) >= this.minWhaleBalance) {
                const existing = this.whaleAddresses.get(address);
                const now = new Date();

                const whaleAddress: IWhaleAddress = {
                    address,
                    balance: balanceBnb,
                    balanceUsd,
                    firstSeen: existing?.firstSeen || now,
                    lastActivity: now,
                    transactionCount: (existing?.transactionCount || 0) + 1,
                    tags: existing?.tags || [],
                    isActive: true,
                };

                this.whaleAddresses.set(address, whaleAddress);
               // Notify gateway
            }
        } catch (error) {
            this.logger.error(`Error updating BNB whale address ${address}:`, error.message);
        }
    }

    @Cron(CronExpression.EVERY_30_SECONDS)
    private async updateBnbPrice() {
        try {
            const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
            const newBnbPrice = parseFloat(response.data.binancecoin.usd);
            if (newBnbPrice !== this.bnbPrice) {
                this.bnbPrice = newBnbPrice;
                this.logger.log(`BNB price updated to: $${this.bnbPrice}`);
            }
        } catch (error) {
            this.logger.error('Failed to update BNB price:', error.message);
        }
    }

    // Renamed public methods
    public getBnbTransactions(queryDto: WhaleTransactionQueryDto): PaginatedResponse<WhaleTransactionDto> {
        let transactions = [...this.recentTransactions];
        if (queryDto.minValue) {
            transactions = transactions.filter(tx => parseFloat(tx.value) >= queryDto.minValue);
        }
        if (queryDto.tokenFilter && queryDto.tokenFilter !== 'all') {
            transactions = transactions.filter(tx => tx.tokenInfo?.symbol === queryDto.tokenFilter);
        }
        const total = transactions.length;
        const startIndex = (queryDto.page - 1) * queryDto.limit;
        const endIndex = startIndex + queryDto.limit;
        const paginatedTransactions = transactions.slice(startIndex, endIndex);
        return new PaginatedResponse(paginatedTransactions, total, queryDto.page, queryDto.limit);
    }

    public getBnbAddresses(queryDto: WhaleAddressQueryDto): PaginatedResponse<IWhaleAddress> {
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

    public getBnbAddressDetails(address: string): IWhaleAddress | null {
        const checksumAddress = EthereumUtil.checksumAddress(address);
        return this.whaleAddresses.get(checksumAddress) || null;
    }

    public getAddressTransactions(address: string, paginationDto: PaginationDto): PaginatedResponse<WhaleTransactionDto> {
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

    public getAddressTokenHoldings(address: string): Promise<AddressTokensDto> {
        return this.tokenService.getAddressTokenHoldings(address);
    }
    
    public getBnbWhaleStats(): WhaleStatsDto {
        const totalWhales = this.whaleAddresses.size;
        const totalTransactions = this.recentTransactions.length;
        const totalValueBnb = this.recentTransactions.reduce(
            (sum, tx) => sum + parseFloat(tx.value),
            0
        );
        const totalValueUsd = totalValueBnb * this.bnbPrice;

        const last24hTransactions = this.recentTransactions.filter(
            tx => Date.now() - tx.timestamp < 24 * 60 * 60 * 1000
        );

        return {
            totalWhales,
            totalTransactions,
            totalValueEth: totalValueBnb.toFixed(2), // Keeping the DTO field name for simplicity, but it's BNB
            totalValueUsd: totalValueUsd.toFixed(2),
            last24h: {
                transactions: last24hTransactions.length,
                valueEth: last24hTransactions.reduce((sum, tx) => sum + parseFloat(tx.value), 0).toFixed(2),
            },
            ethPrice: this.bnbPrice, // Keeping the DTO field name for simplicity, but it's BNB
            lastUpdated: new Date().toISOString(),
        };
    }

    public getTrendingTokens(timeframe: string = '24h'): TrendingTokensResponseDto {
        const timeMs = this.getTimeframeMs(timeframe);
        const cutoffTime = Date.now() - timeMs;

        const recentTokenTransactions = this.recentTransactions.filter(
            tx => tx.tokenInfo && tx.timestamp > cutoffTime
        );

        const tokenStats = new Map<string, any>();
        recentTokenTransactions.forEach(tx => {
            if (!tx.tokenInfo) return;
            const key = tx.tokenInfo.address;
            const existing = tokenStats.get(key);
            if (existing) {
                existing.transactionCount++;
                existing.totalVolume += parseFloat(tx.value) * this.bnbPrice;
                existing.uniqueWhales.add(tx.from);
            } else {
                tokenStats.set(key, {
                    ...tx.tokenInfo,
                    transactionCount: 1,
                    totalVolume: parseFloat(tx.value) * this.bnbPrice,
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