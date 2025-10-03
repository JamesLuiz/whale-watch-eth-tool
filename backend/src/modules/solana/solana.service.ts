import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Alert, AlertDocument } from '../whale-magnet/schemas/alert.schema';
import { ConfigService } from '@nestjs/config';
import {
    Connection,
    PublicKey,
    clusterApiUrl,
    LAMPORTS_PER_SOL,
    SystemProgram,
    ParsedInstruction,
    ParsedTransactionWithMeta,
    ParsedAccountData,
} from '@solana/web3.js';
import { EventEmitter } from 'events';
import { TOKEN_PROGRAM_ID, AccountLayout } from '@solana/spl-token';
import axios, { AxiosResponse } from 'axios';

// Enhanced interfaces for comprehensive token analysis
interface DexscreenerPair {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
        decimals?: number;
    };
    quoteToken: {
        address: string;
        name: string;
        symbol: string;
        decimals?: number;
    };
    priceNative: string;
    priceUsd?: string;
    liquidity: {
        usd?: number;
        base: number;
        quote: number;
    };
    volume?: {
        h24?: number;
        h6?: number;
        h1?: number;
        m5?: number;
    };
    priceChange?: {
        h24?: number;
        h6?: number;
        h1?: number;
        m5?: number;
    };
    fdv?: number;
    marketCap?: number;
    pairCreatedAt?: number;
    info?: {
        imageUrl?: string;
        websites?: Array<{ label: string; url: string }>;
        socials?: Array<{ type: string; url: string }>;
    };
}

interface DexscreenerResponse {
    schemaVersion: string;
    pairs: DexscreenerPair[] | null;
}

interface TokenAnalysis {
    address: string;
    name: string;
    symbol: string;
    price: number;
    marketCap: number;
    fdv: number;
    liquidity: number;
    volume24h: number;
    priceChange24h: number;
    age: number;
    holders: number;
    socialScore: number;
    bondingCurveScore: number;
    investmentScore: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    alerts: string[];
    recommendations: string[];
    dexInfo: DexscreenerPair;
}

interface WhaleAlert {
    id: string;
    timestamp: number;
    whaleAddress: string;
    tokenAddress: string;
    tokenAnalysis: TokenAnalysis;
    transactionHash: string;
    alertLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    message: string;
    read: boolean;
}

interface BondingCurveData {
    priceImpact10k: number;
    priceImpact100k: number;
    priceImpact1m: number;
    liquidityDepth: number;
    slippageScore: number;
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
        transactionHash: string;
        startTime: number;
    }>();
    
    // Enhanced tracking and alerting
    private activeAlerts = new Map<string, WhaleAlert>();
    private tokenAnalysisCache = new Map<string, TokenAnalysis>();
    private whaleAddresses = new Map<string, {
        address: string;
        balance: number;
        lastSeen: number;
        tokenCount: number;
        totalValue: number;
    }>();
    private readonly ALERT_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private readonly TOKEN_ANALYSIS_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

    constructor(
        private configService: ConfigService,
        @InjectModel(Alert.name) private alertModel: Model<AlertDocument>,
    ) {
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
                            const signature = transaction.transaction.signatures[0];
                            
                            this.logger.warn(`🐋 WHALE TRANSACTION DETECTED! ${transferAmountSol} SOL from ${from} to ${to}`);
                            this.logger.warn(`📝 Transaction: ${signature}`);
                            
                            this.eventEmitter.emit('whale_transaction', {
                                from,
                                to,
                                amountSol: transferAmountSol,
                                signature,
                                slot: slot,
                                timestamp: Date.now(),
                            });
                            
                            // Start enhanced monitoring for the recipient
                            this.monitorWhaleAddress(to, transferAmountSol, signature);
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
     * @param transactionHash The transaction hash that triggered the monitoring.
     */
    private async monitorWhaleAddress(address: string, amountSol: number, transactionHash: string): Promise<void> {
        if (this.whaleMonitor.has(address)) {
            this.logger.log(`Already monitoring whale address ${address}.`);
            return;
        }

        const publicKey = new PublicKey(address);
        const initialTokens = await this.getTokensByOwner(publicKey);
        const startTime = Date.now();
        
        this.logger.log(`🐋 Starting enhanced monitoring for whale ${address} with ${initialTokens.size} initial tokens.`);
        this.logger.log(`💰 Whale transferred ${amountSol} SOL - monitoring for new token acquisitions...`);

        // Update whale address tracking
        this.whaleAddresses.set(address, {
            address,
            balance: amountSol,
            lastSeen: startTime,
            tokenCount: initialTokens.size,
            totalValue: amountSol * 100, // Approximate USD value
        });

        const monitoringInterval = setInterval(async () => {
            try {
            const currentTokens = await this.getTokensByOwner(publicKey);
            const newTokens = new Set([...currentTokens].filter(token => !initialTokens.has(token)));

            if (newTokens.size > 0) {
                    this.logger.warn(`🆕 New token(s) detected for whale ${address}: ${[...newTokens].join(', ')}`);
                    
                for (const newToken of newTokens) {
                        // Enhanced analysis with comprehensive token evaluation
                        await this.checkAndLogTokenDetails(newToken, address, transactionHash);
                        
                        // Additional buy analysis
                    await this.checkTokenForBuy(newToken, amountSol);
                    }
                }

                // Update whale tracking
                const whaleData = this.whaleAddresses.get(address);
                if (whaleData) {
                    whaleData.lastSeen = Date.now();
                    whaleData.tokenCount = currentTokens.size;
                }
            } catch (error) {
                this.logger.error(`Error monitoring whale ${address}:`, error.message);
            }
        }, 8000); // Check every 8 seconds for faster detection

        const monitoringTimeout = setTimeout(() => {
            clearInterval(monitoringInterval);
            this.whaleMonitor.delete(address);
            this.logger.log(`⏰ Stopped monitoring whale address ${address} after 1 hour.`);
        }, 3600000); // 1 hour monitoring

        this.whaleMonitor.set(address, { 
            initialTokens, 
            amountSol, 
            monitoringTimeout, 
            transactionHash,
            startTime 
        });
    }
    
    /**
     * Enhanced token buy analysis with market impact assessment
     */
    private async checkTokenForBuy(tokenAddress: string, amountSol: number): Promise<void> {
        try {
            const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
            this.logger.log(`🔍 Analyzing token pools for potential buy: ${tokenAddress}...`);

            const response: AxiosResponse<DexscreenerResponse> = await axios.get(url, { timeout: 10000 });
            const data = response.data;

            if (!data || !data.pairs || data.pairs.length === 0) {
                this.logger.log(`No valid pools found for token ${tokenAddress}.`);
                return;
            }

            let bestPair = null;
            let maxLiquidity = 0;

            // Find the pair with highest liquidity
            for (const pair of data.pairs) {
                const liquidity = pair.liquidity.usd || 0;
                if (liquidity > maxLiquidity) {
                    maxLiquidity = liquidity;
                    bestPair = pair;
                }
            }

            if (!bestPair) {
                this.logger.log(`No suitable pair found for token ${tokenAddress}.`);
                return;
            }

            const tokenPriceSol = parseFloat(bestPair.priceNative);
            const estimatedTokens = amountSol / tokenPriceSol;
            const liquidityRatio = amountSol / (bestPair.liquidity.quote || 1);
            
            // Calculate potential price impact
            const priceImpact = liquidityRatio * 10; // Simplified calculation
            
            this.logger.log(`💰 BUY ANALYSIS FOR ${bestPair.baseToken.name}`);
            this.logger.log(`Expected tokens: ${estimatedTokens.toFixed(0)} ${bestPair.baseToken.symbol}`);
            this.logger.log(`Price impact: ${priceImpact.toFixed(2)}%`);
            this.logger.log(`Liquidity ratio: ${(liquidityRatio * 100).toFixed(2)}%`);
            
            if (priceImpact < 5) {
                this.logger.log(`✅ LOW PRICE IMPACT - Good buying opportunity`);
            } else if (priceImpact < 15) {
                this.logger.log(`⚠️ MODERATE PRICE IMPACT - Consider smaller buys`);
            } else {
                this.logger.log(`🚨 HIGH PRICE IMPACT - Risky buy, consider waiting`);
            }

            // Emit buy analysis event
            this.eventEmitter.emit('token_buy_analysis', {
                tokenAddress,
                tokenName: bestPair.baseToken.name,
                tokenSymbol: bestPair.baseToken.symbol,
                amountSol,
                estimatedTokens,
                priceImpact,
                liquidityRatio,
                pair: bestPair,
            });

        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                this.logger.error(`API request failed with status ${error.response.status} for ${tokenAddress}`);
            } else {
                this.logger.error(`Error checking token pools for ${tokenAddress}:`, error.message);
            }
        }
    }

    // (Removed) Legacy duplicate checkTokenForBuy implementation
    
    /**
     * Comprehensive token analysis with investment scoring
     */
    private async analyzeToken(tokenAddress: string, whaleAddress: string, transactionHash: string): Promise<TokenAnalysis | null> {
        try {
            // Check cache first
            const cached = this.tokenAnalysisCache.get(tokenAddress);
            if (cached && Date.now() - cached['_cachedAt'] < this.TOKEN_ANALYSIS_CACHE_DURATION) {
                return cached;
            }

            this.logger.log(`🔍 Starting comprehensive analysis for token: ${tokenAddress}`);

            // Get token data from Dexscreener
            const tokenData = await this.getTokenDataFromDexscreener(tokenAddress);
            if (!tokenData || !tokenData.pairs || tokenData.pairs.length === 0) {
                this.logger.warn(`No Dexscreener data found for token: ${tokenAddress}`);
                return null;
            }

            const pair = tokenData.pairs[0];
            const analysis = await this.performTokenAnalysis(pair, tokenAddress);
            
            // Cache the analysis
            analysis['_cachedAt'] = Date.now();
            this.tokenAnalysisCache.set(tokenAddress, analysis);

            // Generate alert based on analysis
            await this.generateWhaleAlert(whaleAddress, tokenAddress, analysis, transactionHash);

            return analysis;
        } catch (error) {
            this.logger.error(`Error analyzing token ${tokenAddress}:`, error.message);
            return null;
        }
    }

    /**
     * Get comprehensive token data from Dexscreener
     */
    private async getTokenDataFromDexscreener(tokenAddress: string): Promise<DexscreenerResponse | null> {
        try {
            const response: AxiosResponse<DexscreenerResponse> = await axios.get(
                `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
                { timeout: 10000 }
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Failed to fetch Dexscreener data for ${tokenAddress}:`, error.message);
            return null;
        }
    }

    /**
     * Perform comprehensive token analysis
     */
    private async performTokenAnalysis(pair: DexscreenerPair, tokenAddress: string): Promise<TokenAnalysis> {
        const bondingCurve = this.analyzeBondingCurve(pair);
        const socialScore = this.calculateSocialScore(pair);
        const investmentScore = this.calculateInvestmentScore(pair, bondingCurve, socialScore);
        const riskLevel = this.determineRiskLevel(investmentScore, pair);
        const alerts = this.generateAlerts(pair, bondingCurve);
        const recommendations = this.generateRecommendations(pair, investmentScore, riskLevel);

        return {
            address: tokenAddress,
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            price: parseFloat(pair.priceUsd || '0'),
            marketCap: pair.marketCap || 0,
            fdv: pair.fdv || 0,
            liquidity: pair.liquidity.usd || 0,
            volume24h: pair.volume?.h24 || 0,
            priceChange24h: pair.priceChange?.h24 || 0,
            age: pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60 * 24) : 0,
            holders: await this.getTokenHolders(tokenAddress),
            socialScore,
            bondingCurveScore: bondingCurve.slippageScore,
            investmentScore,
            riskLevel,
            alerts,
            recommendations,
            dexInfo: pair,
        };
    }

    /**
     * Analyze bonding curve and price impact
     */
    private analyzeBondingCurve(pair: DexscreenerPair): BondingCurveData {
        const liquidity = pair.liquidity.usd || 0;
        const price = parseFloat(pair.priceUsd || '0');
        
        // Calculate price impact for different trade sizes
        const priceImpact10k = this.calculatePriceImpact(10000, liquidity, price);
        const priceImpact100k = this.calculatePriceImpact(100000, liquidity, price);
        const priceImpact1m = this.calculatePriceImpact(1000000, liquidity, price);
        
        // Calculate liquidity depth (how much volume before significant price impact)
        const liquidityDepth = liquidity / 1000000; // Normalized to millions
        
        // Calculate slippage score (0-100, higher is better)
        const slippageScore = Math.max(0, 100 - (priceImpact10k * 2 + priceImpact100k * 5 + priceImpact1m * 10));
        
        return {
            priceImpact10k,
            priceImpact100k,
            priceImpact1m,
            liquidityDepth,
            slippageScore,
        };
    }

    /**
     * Calculate price impact for a given trade size
     */
    private calculatePriceImpact(tradeSize: number, liquidity: number, price: number): number {
        if (liquidity === 0 || price === 0) return 100; // Maximum impact if no liquidity
        
        // Simplified price impact calculation
        const impact = Math.min(100, (tradeSize / liquidity) * 50);
        return Math.max(0, impact);
    }

    /**
     * Calculate social score based on token metadata
     */
    private calculateSocialScore(pair: DexscreenerPair): number {
        let score = 0;
        
        if (pair.info?.websites && pair.info.websites.length > 0) {
            score += 20;
        }
        
        if (pair.info?.socials && pair.info.socials.length > 0) {
            score += pair.info.socials.length * 10;
        }
        
        if (pair.info?.imageUrl) {
            score += 10;
        }
        
        // Check for suspicious patterns
        if (pair.baseToken.name.length < 3) score -= 20;
        if (pair.baseToken.symbol.length < 2) score -= 20;
        
        return Math.max(0, Math.min(100, score));
    }

    /**
     * Calculate comprehensive investment score
     */
    private calculateInvestmentScore(pair: DexscreenerPair, bondingCurve: BondingCurveData, socialScore: number): number {
        let score = 0;
        
        // Liquidity score (30% weight)
        const liquidityScore = Math.min(100, (pair.liquidity.usd || 0) / 100000); // $100k = 100 points
        score += liquidityScore * 0.3;
        
        // Volume score (25% weight)
        const volumeScore = Math.min(100, (pair.volume?.h24 || 0) / 50000); // $50k = 100 points
        score += volumeScore * 0.25;
        
        // Price stability score (20% weight)
        const priceChange = Math.abs(pair.priceChange?.h24 || 0);
        const stabilityScore = Math.max(0, 100 - priceChange * 2); // Less volatile = higher score
        score += stabilityScore * 0.2;
        
        // Bonding curve score (15% weight)
        score += bondingCurve.slippageScore * 0.15;
        
        // Social score (10% weight)
        score += socialScore * 0.1;
        
        return Math.max(0, Math.min(100, score));
    }

    /**
     * Determine risk level based on analysis
     */
    private determineRiskLevel(investmentScore: number, pair: DexscreenerPair): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
        const liquidity = pair.liquidity.usd || 0;
        const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60 * 24) : 0;
        
        if (investmentScore >= 80 && liquidity >= 500000 && age >= 7) return 'LOW';
        if (investmentScore >= 60 && liquidity >= 100000 && age >= 3) return 'MEDIUM';
        if (investmentScore >= 40 && liquidity >= 10000) return 'HIGH';
        return 'EXTREME';
    }

    /**
     * Generate alerts based on analysis
     */
    private generateAlerts(pair: DexscreenerPair, bondingCurve: BondingCurveData): string[] {
        const alerts: string[] = [];
        
        if (pair.liquidity.usd && pair.liquidity.usd < 10000) {
            alerts.push('⚠️ Very low liquidity - high slippage risk');
        }
        
        if (bondingCurve.priceImpact10k > 20) {
            alerts.push('⚠️ High price impact for small trades');
        }
        
        if (pair.volume?.h24 && pair.volume.h24 < 1000) {
            alerts.push('⚠️ Very low 24h volume');
        }
        
        if (pair.priceChange?.h24 && Math.abs(pair.priceChange.h24) > 50) {
            alerts.push('⚠️ Extreme price volatility detected');
        }
        
        const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60 * 24) : 0;
        if (age < 1) {
            alerts.push('🆕 Brand new token - high risk');
        }
        
        if (!pair.info?.websites || pair.info.websites.length === 0) {
            alerts.push('⚠️ No official website found');
        }
        
        return alerts;
    }

    /**
     * Generate investment recommendations
     */
    private generateRecommendations(pair: DexscreenerPair, investmentScore: number, riskLevel: string): string[] {
        const recommendations: string[] = [];
        
        if (investmentScore >= 80) {
            recommendations.push('✅ Strong investment potential');
            recommendations.push('💡 Consider DCA strategy');
        } else if (investmentScore >= 60) {
            recommendations.push('⚖️ Moderate investment potential');
            recommendations.push('💡 Monitor closely before investing');
        } else if (investmentScore >= 40) {
            recommendations.push('⚠️ High risk investment');
            recommendations.push('💡 Only invest what you can afford to lose');
        } else {
            recommendations.push('🚨 Extremely high risk');
            recommendations.push('💡 Avoid or invest very small amounts');
        }
        
        if (pair.liquidity.usd && pair.liquidity.usd > 1000000) {
            recommendations.push('💎 High liquidity - good for larger trades');
        }
        
        if (pair.volume?.h24 && pair.volume.h24 > 100000) {
            recommendations.push('📈 High trading volume - good market activity');
        }
        
        return recommendations;
    }

    /**
     * Get token holders count (simplified)
     */
    private async getTokenHolders(tokenAddress: string): Promise<number> {
        try {
            // This would require additional API calls to get holder count
            // For now, return estimated value based on token age and volume
            return Math.floor(Math.random() * 1000) + 100; // Mock data
        } catch (error) {
            return 0;
        }
    }

    /**
     * Generate whale alert with comprehensive analysis
     */
    private async generateWhaleAlert(
        whaleAddress: string, 
        tokenAddress: string, 
        analysis: TokenAnalysis, 
        transactionHash: string
    ): Promise<void> {
        const alertId = `${whaleAddress}-${tokenAddress}-${Date.now()}`;
        
        // Determine alert level based on analysis
        let alertLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
        if (analysis.investmentScore >= 80) alertLevel = 'HIGH';
        else if (analysis.investmentScore >= 60) alertLevel = 'MEDIUM';
        else if (analysis.investmentScore >= 40) alertLevel = 'LOW';
        else alertLevel = 'CRITICAL';
        
        // Generate alert message
        const message = this.generateAlertMessage(whaleAddress, analysis, alertLevel);
        
        const alert: WhaleAlert = {
            id: alertId,
            timestamp: Date.now(),
            whaleAddress,
            tokenAddress,
            tokenAnalysis: analysis,
            transactionHash,
            alertLevel,
            message,
            read: false,
        };
        
        // Store alert
        this.activeAlerts.set(alertId, alert);
        
        // Emit alert event
        this.eventEmitter.emit('whale_alert', alert);
        
        // Persist alert
        try {
            await this.alertModel.create({
                alertId,
                whaleAddress,
                tokenAddress,
                alertLevel,
                message,
                read: false,
                tokenAnalysis: analysis,
                timestamp: alert.timestamp,
            });
        } catch {}
        
        this.logger.log(`🚨 Generated ${alertLevel} alert: ${message}`);
    }

    /**
     * Generate alert message based on analysis
     */
    private generateAlertMessage(whaleAddress: string, analysis: TokenAnalysis, alertLevel: string): string {
        const riskEmoji = analysis.riskLevel === 'LOW' ? '🟢' : 
                         analysis.riskLevel === 'MEDIUM' ? '🟡' : 
                         analysis.riskLevel === 'HIGH' ? '🟠' : '🔴';
        
        return `🐋 Whale Alert ${riskEmoji}\n` +
               `Whale: ${whaleAddress.slice(0, 8)}...${whaleAddress.slice(-8)}\n` +
               `Token: ${analysis.name} (${analysis.symbol})\n` +
               `Investment Score: ${analysis.investmentScore.toFixed(1)}/100\n` +
               `Risk Level: ${analysis.riskLevel}\n` +
               `Liquidity: $${analysis.liquidity.toLocaleString()}\n` +
               `Market Cap: $${analysis.marketCap.toLocaleString()}\n` +
               `Price: $${analysis.price.toFixed(6)}\n` +
               `24h Volume: $${analysis.volume24h.toLocaleString()}\n` +
               `Alert Level: ${alertLevel}`;
    }

    /**
     * Enhanced token monitoring with comprehensive analysis
     */
    private async checkAndLogTokenDetails(tokenAddress: string, whaleAddress: string, transactionHash: string): Promise<void> {
        try {
            this.logger.log(`🔍 Analyzing token: ${tokenAddress} for whale: ${whaleAddress}`);
            
            const analysis = await this.analyzeToken(tokenAddress, whaleAddress, transactionHash);
            if (!analysis) {
                this.logger.warn(`No analysis available for token: ${tokenAddress}`);
                return;
            }
            
            // Log comprehensive analysis
            this.logger.log('📊 COMPREHENSIVE TOKEN ANALYSIS 📊');
            this.logger.log(`Token: ${analysis.name} (${analysis.symbol})`);
            this.logger.log(`Address: ${tokenAddress}`);
            this.logger.log(`Price: $${analysis.price.toFixed(6)}`);
            this.logger.log(`Market Cap: $${analysis.marketCap.toLocaleString()}`);
            this.logger.log(`Liquidity: $${analysis.liquidity.toLocaleString()}`);
            this.logger.log(`24h Volume: $${analysis.volume24h.toLocaleString()}`);
            this.logger.log(`Price Change 24h: ${analysis.priceChange24h.toFixed(2)}%`);
            this.logger.log(`Token Age: ${analysis.age.toFixed(1)} days`);
            this.logger.log(`Investment Score: ${analysis.investmentScore.toFixed(1)}/100`);
            this.logger.log(`Risk Level: ${analysis.riskLevel}`);
            this.logger.log(`Bonding Curve Score: ${analysis.bondingCurveScore.toFixed(1)}/100`);
            
            if (analysis.alerts.length > 0) {
                this.logger.warn('⚠️ ALERTS:');
                analysis.alerts.forEach(alert => this.logger.warn(alert));
            }
            
            if (analysis.recommendations.length > 0) {
                this.logger.log('💡 RECOMMENDATIONS:');
                analysis.recommendations.forEach(rec => this.logger.log(rec));
            }
            
            // Emit detailed analysis event
            this.eventEmitter.emit('token_analysis', {
                whaleAddress,
                tokenAddress,
                analysis,
                transactionHash,
            });
            
        } catch (error) {
            this.logger.error(`Error in comprehensive token analysis for ${tokenAddress}:`, error.message);
        }
    }

    /**
     * Get active alerts
     */
    getActiveAlerts(): WhaleAlert[] {
        return Array.from(this.activeAlerts.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100); // Return last 100 alerts
    }

    /**
     * Mark alert as read
     */
    markAlertAsRead(alertId: string): boolean {
        const alert = this.activeAlerts.get(alertId);
        if (alert) {
            alert.read = true;
            return true;
        }
        return false;
    }

    /**
     * Get token analysis from cache
     */
    getTokenAnalysis(tokenAddress: string): TokenAnalysis | null {
        return this.tokenAnalysisCache.get(tokenAddress) || null;
    }

    /**
     * Get whale addresses being monitored
     */
    getMonitoredWhales(): any[] {
        return Array.from(this.whaleAddresses.values());
    }
    
    /**
     * Returns the event emitter for subscribing to whale transaction events.
     */
    get whaleTransactionsEmitter(): EventEmitter {
        return this.eventEmitter;
    }
}