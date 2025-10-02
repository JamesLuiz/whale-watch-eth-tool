import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    Connection,
    PublicKey,
    clusterApiUrl,
    LAMPORTS_PER_SOL,
    SystemProgram,
    ParsedInstruction,
} from '@solana/web3.js';
import { EventEmitter } from 'events';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import axios, { AxiosResponse } from 'axios';

// Interfaces for Dexscreener API responses to ensure type safety
interface DexscreenerPair {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceNative: string;
    priceUsd?: string;
    liquidity: {
        usd?: number;
        base: number;
        quote: number;
    };
}

interface DexscreenerResponse {
    schemaVersion: string;
    pairs: DexscreenerPair[] | null;
}

@Injectable()
export class SolanaService {
    private readonly logger = new Logger(SolanaService.name);
    private connection: Connection;
    private rpcUrl: string;
    private eventEmitter = new EventEmitter();
    private slotSubscriptionId: number | null = null;
    private whaleMonitoringInterval: NodeJS.Timeout | null = null;
    private lastProcessedSlot: number | null = null;
    private readonly WHALE_THRESHOLD_SOL = 50;
    private whaleMonitor = new Map<string, {
        initialTokens: Set<string>;
        amountSol: number;
        monitoringTimeout: NodeJS.Timeout;
    }>();

    constructor(private configService: ConfigService) {
        this.rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
        const wsUrl = this.rpcUrl.replace('https', 'wss').replace('http', 'ws');

        this.connection = new Connection(this.rpcUrl, {
            commitment: 'confirmed',
            wsEndpoint: wsUrl,
        });
        this.logger.log(`Initialized Solana service with RPC URL: ${this.rpcUrl}`);
    }

    /**
     * Pings the Solana cluster to check for connection status.
     * @returns The current slot number of the network.
     */
    async getStatus(): Promise<{ status: string; slot: number | null }> {
        try {
            const slot = await this.connection.getSlot();
            return { status: 'Connected to Solana', slot };
        } catch (error) {
            this.logger.error('Failed to connect to Solana cluster:', error.message);
            return { status: 'Disconnected', slot: null };
        }
    }

    /**
     * Fetches the balance of a given Solana public key.
     * @param publicKeyStr The public key as a string.
     * @returns The balance in SOL and Lamports.
     */
    async getBalance(publicKeyStr: string): Promise<{ balanceSol: number; balanceLamports: number }> {
        try {
            const publicKey = new PublicKey(publicKeyStr);
            const balanceLamports = await this.connection.getBalance(publicKey);
            const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
            return { balanceSol, balanceLamports };
        } catch (error) {
            this.logger.error('Failed to get balance for public key:', error.message);
            throw new Error('Invalid public key or failed to fetch balance.');
        }
    }

    /**
     * Starts monitoring for new blocks to detect "whale" transactions.
     */
    async startWhaleMonitoring(): Promise<void> {
        if (this.whaleMonitoringInterval !== null) {
            this.logger.warn('Whale monitoring is already active.');
            return;
        }

        this.lastProcessedSlot = await this.connection.getSlot();
        this.logger.log(`Starting whale monitoring from slot: ${this.lastProcessedSlot}`);

        this.whaleMonitoringInterval = setInterval(async () => {
            try {
                const currentSlot = await this.connection.getSlot();
                if (currentSlot > this.lastProcessedSlot) {
                    this.logger.log(`New slot detected: ${currentSlot}. Fetching block...`);
                    for (let slotToProcess = this.lastProcessedSlot + 1; slotToProcess <= currentSlot; slotToProcess++) {
                        const block = await this.connection.getParsedBlock(slotToProcess, {
                            commitment: 'confirmed',
                            maxSupportedTransactionVersion: 0,
                            transactionDetails: 'full',
                        });
                        if (block) {
                            this.processBlock(block, slotToProcess);
                        } else {
                            this.logger.warn(`Failed to retrieve block for slot ${slotToProcess}`);
                        }
                    }
                    this.lastProcessedSlot = currentSlot;
                }
            } catch (error) {
                this.logger.error(`Error during whale monitoring poll:`, error.message);
            }
        }, 4000);
        
        this.logger.log('Started polling for new slots to detect whale transactions.');
    }

    /**
     * Stops the ongoing whale monitoring.
     */
    async stopWhaleMonitoring(): Promise<void> {
        if (this.whaleMonitoringInterval !== null) {
            clearInterval(this.whaleMonitoringInterval);
            this.whaleMonitoringInterval = null;
            this.logger.log('Stopped whale transaction monitoring.');
        }
    }

    /**
     * Processes a confirmed block to find transactions above the whale threshold.
     * @param block The confirmed block to process.
     * @param slot The slot number of the block.
     */
    private async processBlock(block: any, slot: number): Promise<void> {
        if (!block || !block.transactions) {
            this.logger.warn('Received a malformed block response. Skipping processing.');
            return;
        }
        
        this.logger.log(`Processing block with ${block.transactions.length} transactions.`);
        for (const transaction of block.transactions) {
            if (transaction.meta?.err) {
                continue;
            }

            if (!transaction.transaction.message || !transaction.transaction.message.instructions) {
                this.logger.warn('Skipping transaction without a valid message or instructions.');
                continue;
            }

            for (const instruction of transaction.transaction.message.instructions) {
                if ('parsed' in instruction) {
                    const parsedInstruction = instruction as ParsedInstruction;
                    if (parsedInstruction.programId.equals(SystemProgram.programId) && parsedInstruction.parsed?.type === 'transfer') {
                        const transferAmount = parsedInstruction.parsed.info.lamports;
                        const transferAmountSol = transferAmount / LAMPORTS_PER_SOL;

                        if (transferAmountSol >= this.WHALE_THRESHOLD_SOL) {
                            const from = parsedInstruction.parsed.info.source;
                            const to = parsedInstruction.parsed.info.destination;
                            this.logger.warn(`Whale transaction detected! ${transferAmountSol} SOL from ${from} to ${to}`);
                            this.eventEmitter.emit('whale_transaction', {
                                from,
                                to,
                                amountSol: transferAmountSol,
                                signature: transaction.transaction.signatures[0],
                                slot: slot,
                            });
                            this.monitorWhaleAddress(to, transferAmountSol);
                        }
                    }
                }
            }
        }
    }

    /**
     * Fetches a list of all SPL tokens held by a given public key.
     * @param publicKey The public key of the address.
     * @returns A Set of token mint addresses.
     */
    private async getTokensByOwner(publicKey: PublicKey): Promise<Set<string>> {
        const tokens = new Set<string>();
        try {
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                publicKey,
                { programId: TOKEN_PROGRAM_ID }
            );
            for (const account of tokenAccounts.value) {
                const mint = account.account.data.parsed.info.mint;
                if (account.account.data.parsed.info.tokenAmount.uiAmount > 0) {
                    tokens.add(mint);
                }
            }
        } catch (error) {
            this.logger.error(`Error fetching tokens for ${publicKey.toBase58()}:`, error.message);
        }
        return tokens;
    }

    /**
     * Starts monitoring a whale address for new token acquisitions.
     * @param address The whale address to monitor.
     * @param amountSol The amount of SOL transferred in the initial transaction.
     */
    private async monitorWhaleAddress(address: string, amountSol: number): Promise<void> {
        if (this.whaleMonitor.has(address)) {
            this.logger.log(`Already monitoring whale address ${address}.`);
            return;
        }

        const publicKey = new PublicKey(address);
        const initialTokens = await this.getTokensByOwner(publicKey);
        this.logger.log(`Starting 1hr monitoring for whale ${address} with ${initialTokens.size} initial tokens.`);

        const monitoringInterval = setInterval(async () => {
            const currentTokens = await this.getTokensByOwner(publicKey);
            const newTokens = new Set([...currentTokens].filter(token => !initialTokens.has(token)));

            if (newTokens.size > 0) {
                this.logger.warn(`New token(s) detected for whale ${address}: ${[...newTokens].join(', ')}`);
                for (const newToken of newTokens) {
                    await this.checkAndLogTokenDetails(newToken);
                    await this.checkTokenForBuy(newToken, amountSol);
                }
            }
        }, 10000);

        const monitoringTimeout = setTimeout(() => {
            clearInterval(monitoringInterval);
            this.whaleMonitor.delete(address);
            this.logger.log(`Stopped monitoring whale address ${address}.`);
        }, 3600000);

        this.whaleMonitor.set(address, { initialTokens, amountSol, monitoringTimeout });
    }
    
    /**
     * Fetches token details from Dexscreener API and logs them.
     * @param tokenAddress The address of the new token.
     * @param chainId The chain ID (defaults to 'solana').
     */
    private async checkAndLogTokenDetails(tokenAddress: string, chainId: string = 'solana'): Promise<void> {
        try {
            const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
            this.logger.log(`Fetching details for token: ${tokenAddress}`);

            const response: AxiosResponse<DexscreenerResponse> = await axios.get(url, { timeout: 10000 });
            const data = response.data;

            if (!data || !data.pairs || data.pairs.length === 0) {
                this.logger.log(`No Dexscreener pairs found for token: ${tokenAddress}.`);
                return;
            }

            const firstPair = data.pairs[0];
            const tokenName = firstPair.baseToken.name;
            const tokenSymbol = firstPair.baseToken.symbol;
            const priceUsd = firstPair.priceUsd ? `$${parseFloat(firstPair.priceUsd).toFixed(4)}` : 'N/A';
            const liquidityUsd = firstPair.liquidity.usd ? `$${firstPair.liquidity.usd.toFixed(2)}` : 'N/A';

            this.logger.log('✨ Token Details Found! ✨');
            this.logger.log(`Name: ${tokenName} (${tokenSymbol})`);
            this.logger.log(`Token Address: ${tokenAddress}`);
            this.logger.log(`Chain ID: ${firstPair.chainId}`);
            this.logger.log(`DEX: ${firstPair.dexId}`);
            this.logger.log(`Current Price (USD): ${priceUsd}`);
            this.logger.log(`Total Liquidity (USD): ${liquidityUsd}`);
            this.logger.log(`Dexscreener URL: ${firstPair.url}`);

        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`Failed to fetch token details for ${tokenAddress}: Status ${error.response.status}`);
            } else {
                this.logger.error(`An error occurred while fetching token details for ${tokenAddress}:`, error.message);
            }
        }
    }

    /**
     * Checks if a new token acquisition matches the initial SOL transfer amount.
     * @param tokenAddress The address of the new token.
     * @param amountSol The SOL amount of the whale's transfer.
     */
    private async checkTokenForBuy(tokenAddress: string, amountSol: number): Promise<void> {
        try {
            const url = `https://api.dexscreener.com/token-pairs/v1/solana/${tokenAddress}`;
            this.logger.log(`Checking token pools for ${tokenAddress}...`);
            const response: AxiosResponse<DexscreenerResponse> = await axios.get(url, { timeout: 10000 });
            const data = response.data;

            if (!data || !data.pairs || data.pairs.length === 0) {
                this.logger.log(`No valid pools found for token ${tokenAddress}.`);
                return;
            }

            for (const pair of data.pairs) {
                const tokenPriceSol = parseFloat(pair.priceNative);
                const solValueInPool = pair.liquidity.quote;

                // A basic comparison to check for a potential large buy
                if (solValueInPool >= amountSol) {
                    this.logger.log(`Potential token buy detected for ${tokenAddress}! Getting full details.`);
                    this.eventEmitter.emit('potential_buy', {
                        whaleAddress: this.whaleMonitor.get(tokenAddress),
                        tokenAddress,
                        tokenDetails: pair,
                        amountSol,
                        pair,
                    });
                    // Exit the function after the first potential buy is found
                    return;
                }
            }
        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`API request failed with status ${error.response.status} for ${tokenAddress}`);
            } else {
                this.logger.error(`Error checking token pools for ${tokenAddress}:`, error.message);
            }
        }
    }
    
    /**
     * Returns the event emitter for subscribing to whale transaction events.
     */
    get whaleTransactionsEmitter(): EventEmitter {
        return this.eventEmitter;
    }
}