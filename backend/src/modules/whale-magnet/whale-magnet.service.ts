import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Alert, AlertDocument } from './schemas/alert.schema';
import { Launch, LaunchDocument } from './schemas/launch.schema';
import axios from 'axios';
import { EventEmitter } from 'events';

// Define the structure for a Dexscreener token pair
interface DexscreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url: string;
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
  priceUsd: string;
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
}

// Enhanced event structure with new tracking features
export interface WhaleMagnetEvent {
  chainId: string;
  tokenAddress: string;
  tokenSymbol: string;
  pairUrl: string;
  pairAgeMinutes: number;
  liquidityUsd: number;
  recentBuys: number;
  recentSells: number;
  buySellRatio: number;
  isPotentialHoneypot: boolean;
  volatilityH24: number;
  isWhaleInvested: boolean;
  priceUsd: string;
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  createdTime: string;
  // New fields for enhanced tracking
  isNewLaunch: boolean;
  whaleTransactions: WhaleTransaction[];
  bondingCurveStatus: BondingCurveStatus;
  liquidityTrend: LiquidityTrend;
  priceMovement: PriceMovement;
  riskScore: number;
}

export interface WhaleTransaction {
  txHash: string;
  timestamp: number;
  type: 'buy' | 'sell';
  amountUsd: number;
  priceImpact: number;
  walletAddress: string;
  isKnownWhale: boolean;
}

export interface BondingCurveStatus {
  progress: number; // 0-100%
  isCompleted: boolean;
  liquidityMigrated: boolean;
  estimatedCompletionTime?: number;
  curveType: 'pump.fun' | 'sunpump' | 'moonshot' | 'standard' | 'unknown';
}

export interface LiquidityTrend {
  current: number;
  change1h: number;
  change6h: number;
  change24h: number;
  isIncreasing: boolean;
  majorChanges: Array<{
    timestamp: number;
    change: number;
    type: 'add' | 'remove';
  }>;
}

export interface PriceMovement {
  currentPrice: number;
  change5m: number;
  change1h: number;
  change6h: number;
  change24h: number;
  volatilityIndex: number;
  isRapidMovement: boolean;
}

@Injectable()
export class WhaleMagnetService {
  private readonly logger = new Logger(WhaleMagnetService.name);
  private eventEmitter = new EventEmitter();
  
  // Polling intervals
  private readonly POLLING_INTERVAL = 30000; // Poll every 30 seconds for new launches
  private readonly WHALE_MONITORING_INTERVAL = 15000; // Monitor whale transactions every 15 seconds
  private readonly BONDING_CURVE_INTERVAL = 20000; // Check bonding curves every 20 seconds
  
  // Thresholds
  private readonly LIQUIDITY_THRESHOLD_USD = 5000; // Lower threshold for new launches
  private readonly BUYS_THRESHOLD_H1 = 15; // Lower threshold for new launches
  private readonly WHALE_INVESTMENT_THRESHOLD_USD = 5000;
  private readonly WHALE_TRANSACTION_THRESHOLD = 1000; // Minimum USD for whale transaction
  private readonly HONEYPOT_RISK_RATIO = 50;
  private readonly MAX_AGE_HOURS = 2; // Focus on tokens launched within 2 hours
  private readonly NEW_LAUNCH_THRESHOLD_MINUTES = 120; // 2 hours
  
  // Target configurations
  private readonly TARGET_CHAINS = ['ethereum', 'solana', 'bsc', 'base', 'polygon'];
  private readonly TARGET_QUOTE_SYMBOLS = ['WETH', 'WBNB', 'SOL', 'USDC', 'USDT', 'MATIC'];
  
  // Tracking sets and maps
  private analyzedTokens = new Set<string>();
  private trackedTokens = new Map<string, WhaleMagnetEvent>();
  private whaleWallets = new Set<string>(); // Known whale wallets
  private bondingCurveTokens = new Map<string, BondingCurveStatus>();

  constructor(
    @InjectModel(Alert.name) private alertModel: Model<AlertDocument>,
    @InjectModel(Launch.name) private launchModel: Model<LaunchDocument>,
  ) {
    this.initializeKnownWhaleWallets();
    this.startWhaleHunting();
    this.startNewLaunchTracking();
    this.startWhaleTransactionMonitoring();
    this.startBondingCurveMonitoring();
  }

  // Simple exponential backoff with jitter for 429/5xx handling
  private async fetchWithBackoff<T>(fn: () => Promise<T>, attempts: number = 5, baseDelayMs: number = 500): Promise<T> {
    let lastError: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const status = error?.response?.status;
        if (status && status !== 429 && status < 500) {
          // Non-retryable
          break;
        }
        const jitter = Math.floor(Math.random() * 250);
        const delay = baseDelayMs * Math.pow(2, i) + jitter;
        await new Promise(res => setTimeout(res, delay));
      }
    }
    throw lastError;
  }

  private initializeKnownWhaleWallets() {
    // Add known whale wallet addresses (you can expand this list)
    const knownWhales = [
      // Ethereum whales
      '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a', // Bitfinex
      '0x28C6c06298d514Db089934071355E5743bf21d60', // Binance
      '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', // Binance 2
      // Solana whales (add more as needed)
      'A1phaBetSoup111111111111111111111111111111',
      // Add more whale addresses here
    ];
    
    knownWhales.forEach(wallet => this.whaleWallets.add(wallet.toLowerCase()));
    this.logger.log(`Initialized ${this.whaleWallets.size} known whale wallets`);
  }

  private startWhaleHunting() {
    this.logger.log('Starting enhanced whale hunting service...');
    setInterval(() => this.findWhaleMagnets(), this.POLLING_INTERVAL);
  }

  private startNewLaunchTracking() {
    this.logger.log('Starting new token launch tracking...');
    setInterval(() => this.trackNewLaunches(), this.POLLING_INTERVAL);
  }

  private startWhaleTransactionMonitoring() {
    this.logger.log('Starting whale transaction monitoring...');
    setInterval(() => this.monitorWhaleTransactions(), this.WHALE_MONITORING_INTERVAL);
  }

  private startBondingCurveMonitoring() {
    this.logger.log('Starting bonding curve monitoring...');
    setInterval(() => this.monitorBondingCurves(), this.BONDING_CURVE_INTERVAL);
  }

  public get whaleMagnetEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  // Track newly launched tokens within 4 hours
  private async trackNewLaunches() {
    try {
      this.logger.log('Scanning for new token launches...');
      
      // Fetch latest pairs from multiple sources
      const newPairs = await this.fetchNewlyLaunchedPairs();
      
      for (const pair of newPairs) {
        const pairAgeMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
        
        // Only process tokens launched within our threshold
        if (pairAgeMinutes <= this.NEW_LAUNCH_THRESHOLD_MINUTES) {
          await this.analyzeNewLaunch(pair);
        }
      }
    } catch (error) {
      this.logger.error('Error tracking new launches:', error.message);
    }
  }

  private async fetchNewlyLaunchedPairs(): Promise<DexscreenerPair[]> {
    try {
      // Use valid Dexscreener endpoints to discover candidate tokens,
      // then fetch their pairs and filter by recent creation time.
      const sources = [
        'https://api.dexscreener.com/token-boosts/latest/v1',
        'https://api.dexscreener.com/token-boosts/top/v1',
        'https://api.dexscreener.com/token-profiles/latest/v1'
      ];

      const sourceResults = await Promise.all(
        sources.map(async (url) => {
          try {
            const res = await this.fetchWithBackoff(() => axios.get(`${url}?timestamp=${Date.now()}`, { timeout: 10000 }));
            return Array.isArray(res.data) ? res.data : [];
          } catch (error: any) {
            this.logger.warn(`Failed to fetch discovery source ${url}:`, error.message || error);
            return [];
          }
        })
      );

      // Build a set of unique (chainId, tokenAddress)
      const unique: Array<{ chainId: string; tokenAddress: string }> = [];
      const seen = new Set<string>();
      for (const arr of sourceResults) {
        for (const item of arr) {
          if (!item || !item.tokenAddress || !item.chainId) continue;
          const key = `${item.chainId}:${item.tokenAddress}`;
          if (!seen.has(key)) {
            seen.add(key);
            unique.push({ chainId: item.chainId, tokenAddress: item.tokenAddress });
          }
        }
      }

      if (unique.length === 0) {
        this.logger.log('No candidate tokens discovered from boosted/profile sources.');
        return [];
      }

      // Fetch pairs for each unique token, filter to the matching chain
      // Throttle pair fetches to avoid 429
      const concurrency = 5;
      const pairResults: DexscreenerPair[][] = [];
      for (let i = 0; i < unique.length; i += concurrency) {
        const batch = unique.slice(i, i + concurrency);
        const results = await Promise.all(batch.map(async ({ chainId, tokenAddress }) => {
          try {
            const pairs = await this.fetchTokenPairs(chainId, tokenAddress);
            return pairs.filter(p => p.chainId === chainId);
          } catch {
            return [];
          }
        }));
        pairResults.push(...results);
        // small pause between batches
        await new Promise(res => setTimeout(res, 300));
      }

      const allPairs = pairResults.flat();

      // Filter for recent pairs
      const cutoffMs = this.NEW_LAUNCH_THRESHOLD_MINUTES * 60 * 1000;
      const now = Date.now();
      const recentPairs = allPairs.filter(pair => {
        if (!pair.pairCreatedAt) return false;
        return (now - pair.pairCreatedAt) <= cutoffMs;
      });

      this.logger.log(`Found ${recentPairs.length} recently launched pairs from boosted/profile discovery`);
      return recentPairs;
    } catch (error) {
      this.logger.error('Error fetching newly launched pairs:', error.message);
      return [];
    }
  }

  private async analyzeNewLaunch(pair: DexscreenerPair) {
    const tokenKey = `${pair.chainId}-${pair.baseToken.address}`;
    
    if (this.analyzedTokens.has(tokenKey)) {
      return;
    }

    try {
      const isTargetPair = this.TARGET_QUOTE_SYMBOLS.includes(pair.quoteToken.symbol);
      if (!isTargetPair) return;

      const liquidity = pair.liquidity?.usd || 0;
      const recentBuys = pair.txns?.h1?.buys || 0;
      const recentSells = pair.txns?.h1?.sells || 0;
      const pairAgeMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
      
      // Analyze the new launch
      const whaleMagnet = await this.createWhaleMagnetEvent(pair, true);
      
      if (whaleMagnet && this.shouldAlertNewLaunch(whaleMagnet)) {
        this.trackedTokens.set(tokenKey, whaleMagnet);
        this.analyzedTokens.add(tokenKey);
        
        this.logger.warn(`🚨 NEW LAUNCH ALERT! ${whaleMagnet.tokenSymbol} on ${whaleMagnet.chainId}`);
        this.logTokenDetails(whaleMagnet, 'NEW_LAUNCH');
        
        this.eventEmitter.emit('new_launch', whaleMagnet);
        // persist launch
        try { await this.launchModel.create({
          chainId: whaleMagnet.chainId,
          tokenAddress: whaleMagnet.tokenAddress,
          tokenSymbol: whaleMagnet.tokenSymbol,
          pairUrl: whaleMagnet.pairUrl,
          pairAgeMinutes: whaleMagnet.pairAgeMinutes,
          liquidityUsd: whaleMagnet.liquidityUsd,
          marketCap: whaleMagnet.marketCap,
          fdv: whaleMagnet.fdv,
          pairCreatedAt: whaleMagnet.pairCreatedAt,
          snapshot: whaleMagnet,
        }); } catch {}
        this.eventEmitter.emit('whale_magnet', whaleMagnet);
      }
    } catch (error) {
      this.logger.error(`Error analyzing new launch ${pair.baseToken.symbol}:`, error.message);
    }
  }

  private shouldAlertNewLaunch(event: WhaleMagnetEvent): boolean {
    return (
      event.liquidityUsd >= this.LIQUIDITY_THRESHOLD_USD * 0.5 && // Lower threshold for new launches
      event.recentBuys >= this.BUYS_THRESHOLD_H1 * 0.7 && // Lower threshold for new launches
      event.pairAgeMinutes <= this.NEW_LAUNCH_THRESHOLD_MINUTES &&
      event.riskScore <= 70 // Don't alert on very high risk tokens
    );
  }

  // Monitor whale transactions on tracked tokens
  private async monitorWhaleTransactions() {
    try {
      for (const [tokenKey, tokenEvent] of this.trackedTokens.entries()) {
        const whaleTransactions = await this.fetchWhaleTransactions(tokenEvent);
        
        if (whaleTransactions.length > 0) {
          tokenEvent.whaleTransactions = whaleTransactions;
          
          this.logger.warn(`🐋 WHALE ACTIVITY: ${whaleTransactions.length} transactions on ${tokenEvent.tokenSymbol}`);
          whaleTransactions.forEach(tx => {
            this.logger.log(`  ${tx.type.toUpperCase()}: $${tx.amountUsd.toLocaleString()} (Impact: ${tx.priceImpact}%)`);
          });
          
          this.eventEmitter.emit('whale_transaction', {
            token: tokenEvent,
            transactions: whaleTransactions
          });
        }
      }
    } catch (error) {
      this.logger.error('Error monitoring whale transactions:', error.message);
    }
  }

  private async fetchWhaleTransactions(tokenEvent: WhaleMagnetEvent): Promise<WhaleTransaction[]> {
    // This would typically integrate with blockchain scanners like Etherscan, Solscan, etc.
    // For now, we'll simulate whale detection based on transaction volume and patterns
    
    try {
      const pairs = await this.fetchTokenPairs(tokenEvent.chainId, tokenEvent.tokenAddress);
      const whaleTransactions: WhaleTransaction[] = [];
      
      for (const pair of pairs) {
        // Detect potential whale transactions based on volume spikes
        const recent5mVolume = pair.volume?.m5 || 0;
        const recent1hVolume = pair.volume?.h1 || 0;
        
        // If 5-minute volume is > 20% of 1-hour volume, likely whale activity
        if (recent5mVolume > (recent1hVolume * 0.2) && recent5mVolume > this.WHALE_TRANSACTION_THRESHOLD) {
          const transaction: WhaleTransaction = {
            txHash: `simulated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            type: pair.txns?.m5?.buys > pair.txns?.m5?.sells ? 'buy' : 'sell',
            amountUsd: recent5mVolume,
            priceImpact: Math.abs(pair.priceChange?.m5 || 0),
            walletAddress: 'detected_whale_wallet',
            isKnownWhale: false // Would check against known whale addresses
          };
          
          whaleTransactions.push(transaction);
        }
      }
      
      return whaleTransactions;
    } catch (error) {
      this.logger.error(`Error fetching whale transactions for ${tokenEvent.tokenSymbol}:`, error.message);
      return [];
    }
  }

  // Monitor bonding curve progress
  private async monitorBondingCurves() {
    try {
      for (const [tokenKey, tokenEvent] of this.trackedTokens.entries()) {
        const bondingCurveStatus = await this.analyzeBondingCurve(tokenEvent);
        
        if (bondingCurveStatus && bondingCurveStatus.progress > 0) {
          tokenEvent.bondingCurveStatus = bondingCurveStatus;
          this.bondingCurveTokens.set(tokenKey, bondingCurveStatus);
          
          // Alert on significant bonding curve progress
          if (bondingCurveStatus.progress >= 80 && !bondingCurveStatus.isCompleted) {
            this.logger.warn(`📈 BONDING CURVE ALERT: ${tokenEvent.tokenSymbol} is ${bondingCurveStatus.progress}% complete!`);
            this.eventEmitter.emit('bonding_curve_progress', {
              token: tokenEvent,
              status: bondingCurveStatus
            });
          }
          
          if (bondingCurveStatus.isCompleted && bondingCurveStatus.liquidityMigrated) {
            this.logger.warn(`✅ BONDING CURVE COMPLETED: ${tokenEvent.tokenSymbol} - Liquidity migrated!`);
            this.eventEmitter.emit('bonding_curve_completed', {
              token: tokenEvent,
              status: bondingCurveStatus
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Error monitoring bonding curves:', error.message);
    }
  }

  private async analyzeBondingCurve(tokenEvent: WhaleMagnetEvent): Promise<BondingCurveStatus | null> {
    try {
      // Analyze bonding curve based on chain and token characteristics
      const curveType = this.detectBondingCurveType(tokenEvent);
      
      if (curveType === 'unknown') {
        return null;
      }

      // Simulate bonding curve analysis (in real implementation, this would query specific APIs)
      const marketCap = tokenEvent.marketCap || 0;
      const liquidity = tokenEvent.liquidityUsd || 0;
      
      // Different completion thresholds for different curve types
      const completionThresholds = {
        'pump.fun': 69000, // Pump.fun typically completes at ~$69k market cap
        'sunpump': 50000,  // Sunpump completion threshold
        'moonshot': 100000, // Moonshot completion threshold
        'standard': 500000  // Standard bonding curve
      };
      
      const threshold = completionThresholds[curveType];
      const progress = Math.min((marketCap / threshold) * 100, 100);
      
      return {
        progress: Math.round(progress),
        isCompleted: progress >= 100,
        liquidityMigrated: progress >= 100 && liquidity > threshold * 0.1,
        curveType,
        estimatedCompletionTime: progress < 100 ? this.estimateCompletionTime(progress, tokenEvent) : undefined
      };
    } catch (error) {
      this.logger.error(`Error analyzing bonding curve for ${tokenEvent.tokenSymbol}:`, error.message);
      return null;
    }
  }

  private detectBondingCurveType(tokenEvent: WhaleMagnetEvent): BondingCurveStatus['curveType'] {
    // Detect bonding curve type based on chain and characteristics
    if (tokenEvent.chainId === 'solana') {
      // Check if it's a pump.fun token (common pattern)
      if (tokenEvent.liquidityUsd < 100000 && tokenEvent.pairAgeMinutes < 1440) {
        return 'pump.fun';
      }
    }
    
    if (tokenEvent.chainId === 'ethereum' || tokenEvent.chainId === 'base') {
      // Check for moonshot pattern
      if (tokenEvent.liquidityUsd < 200000) {
        return 'moonshot';
      }
    }
    
    // Default detection logic
    if (tokenEvent.liquidityUsd < 100000 && tokenEvent.fdv < 1000000) {
      return 'standard';
    }
    
    return 'unknown';
  }

  private estimateCompletionTime(progress: number, tokenEvent: WhaleMagnetEvent): number {
    // Simple estimation based on current progress and age
    const remainingProgress = 100 - progress;
    const progressRate = progress / tokenEvent.pairAgeMinutes;
    const estimatedMinutes = remainingProgress / Math.max(progressRate, 0.1);
    
    return Date.now() + (estimatedMinutes * 60 * 1000);
  }

  // Enhanced analysis with all new features
  public async findWhaleMagnets() {
    this.logger.log('Searching for whale magnets with enhanced analysis...');
    
    try {
      const latestBoostedTokens = await this.fetchBoostedTokens('https://api.dexscreener.com/token-boosts/latest/v1');
      const topBoostedTokens = await this.fetchBoostedTokens('https://api.dexscreener.com/token-boosts/top/v1');
      const latestTokenProfiles = await this.fetchBoostedTokens('https://api.dexscreener.com/token-profiles/latest/v1');
      const allBoostedTokens = [...latestBoostedTokens, ...topBoostedTokens, ...latestTokenProfiles];
      
      const uniqueTokensMap = new Map();
      allBoostedTokens.forEach(token => {
        if (token && token.tokenAddress) {
          uniqueTokensMap.set(token.tokenAddress, token);
        }
      });
      
      const uniqueTokens = Array.from(uniqueTokensMap.values());
      this.logger.log(`Found ${uniqueTokens.length} unique tokens to analyze.`);
      
      for (const token of uniqueTokens) {
        if (this.TARGET_CHAINS.includes(token.chainId)) {
          await this.analyzeToken(token);
        }
      }
    } catch (error) {
      this.logger.error('Error during enhanced whale hunting:', error.message);
    }
  }

  private async analyzeToken(token: any) {
    const tokenKey = `${token.chainId}-${token.tokenAddress}`;
    
    if (this.analyzedTokens.has(tokenKey)) {
      return;
    }
    
    try {
      const pairs: DexscreenerPair[] = await this.fetchTokenPairs(token.chainId, token.tokenAddress);

      for (const pair of pairs) {
        const isTargetPair = this.TARGET_QUOTE_SYMBOLS.includes(pair.quoteToken.symbol);
        if (!isTargetPair) continue;

        const pairAgeHours = ((Date.now() - pair.pairCreatedAt) / 60000) / 60;
        
        if (pairAgeHours > this.MAX_AGE_HOURS) {
          continue;
        }

        const whaleMagnet = await this.createWhaleMagnetEvent(pair, false);
        
        if (whaleMagnet && this.shouldAlert(whaleMagnet)) {
          this.trackedTokens.set(tokenKey, whaleMagnet);
          this.analyzedTokens.add(tokenKey);
          
          this.logger.warn(`🚀 WHALE MAGNET ALERT! ${whaleMagnet.tokenSymbol} on ${whaleMagnet.chainId}`);
          this.logTokenDetails(whaleMagnet, 'WHALE_MAGNET');
          
          this.eventEmitter.emit('whale_magnet', whaleMagnet);
          // persist launch if first time
          try { await this.launchModel.updateOne(
            { chainId: whaleMagnet.chainId, tokenAddress: whaleMagnet.tokenAddress },
            { $setOnInsert: {
              chainId: whaleMagnet.chainId,
              tokenAddress: whaleMagnet.tokenAddress,
              tokenSymbol: whaleMagnet.tokenSymbol,
              pairUrl: whaleMagnet.pairUrl,
              pairAgeMinutes: whaleMagnet.pairAgeMinutes,
              liquidityUsd: whaleMagnet.liquidityUsd,
              marketCap: whaleMagnet.marketCap,
              fdv: whaleMagnet.fdv,
              pairCreatedAt: whaleMagnet.pairCreatedAt,
              snapshot: whaleMagnet,
            } },
            { upsert: true }
          ); } catch {}
        }
      }
    } catch (error) {
      this.logger.error(`Error analyzing token ${token.tokenAddress}:`, error.message);
    }
  }

  private async createWhaleMagnetEvent(pair: DexscreenerPair, isNewLaunch: boolean): Promise<WhaleMagnetEvent | null> {
    try {
      const liquidity = pair.liquidity?.usd || 0;
      const recentBuys = pair.txns?.h1?.buys || 0;
      const recentSells = pair.txns?.h1?.sells || 0;
      const pairAgeMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
      const buySellRatio = recentSells > 0 ? recentBuys / recentSells : recentBuys;
      const isWhaleInvested = pair.volume?.h1 > this.WHALE_INVESTMENT_THRESHOLD_USD;
      const isPotentialHoneypot = buySellRatio > this.HONEYPOT_RISK_RATIO && recentSells === 0;
      const volatilityH24 = Math.abs(pair.priceChange?.h24 || 0);
      const createdDate = new Date(pair.pairCreatedAt);
      const createdTime = createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Calculate liquidity trend
      const liquidityTrend: LiquidityTrend = {
        current: liquidity,
        change1h: 0, // Would calculate from historical data
        change6h: 0,
        change24h: 0,
        isIncreasing: true,
        majorChanges: []
      };

      // Calculate price movement
      const priceMovement: PriceMovement = {
        currentPrice: parseFloat(pair.priceUsd),
        change5m: pair.priceChange?.m5 || 0,
        change1h: pair.priceChange?.h1 || 0,
        change6h: pair.priceChange?.h6 || 0,
        change24h: pair.priceChange?.h24 || 0,
        volatilityIndex: volatilityH24,
        isRapidMovement: Math.abs(pair.priceChange?.m5 || 0) > 10
      };

      // Calculate risk score (0-100, higher is riskier)
      const riskScore = this.calculateRiskScore(pair, isNewLaunch, isPotentialHoneypot);

      const whaleMagnet: WhaleMagnetEvent = {
        chainId: pair.chainId,
        tokenAddress: pair.baseToken.address,
        tokenSymbol: pair.baseToken.symbol,
        pairUrl: pair.url,
        pairAgeMinutes: Math.round(pairAgeMinutes),
        liquidityUsd: liquidity,
        recentBuys: recentBuys,
        recentSells: recentSells,
        buySellRatio: parseFloat(buySellRatio.toFixed(2)),
        isPotentialHoneypot,
        volatilityH24,
        isWhaleInvested,
        priceUsd: pair.priceUsd,
        fdv: pair.fdv,
        marketCap: pair.marketCap,
        pairCreatedAt: pair.pairCreatedAt,
        createdTime: createdTime,
        isNewLaunch,
        whaleTransactions: [],
        bondingCurveStatus: {
          progress: 0,
          isCompleted: false,
          liquidityMigrated: false,
          curveType: 'unknown'
        },
        liquidityTrend,
        priceMovement,
        riskScore
      };

      return whaleMagnet;
    } catch (error) {
      this.logger.error('Error creating whale magnet event:', error.message);
      return null;
    }
  }

  private calculateRiskScore(pair: DexscreenerPair, isNewLaunch: boolean, isPotentialHoneypot: boolean): number {
    let riskScore = 0;
    
    // Age risk (newer = riskier)
    const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
    if (ageMinutes < 60) riskScore += 30;
    else if (ageMinutes < 240) riskScore += 20;
    else if (ageMinutes < 1440) riskScore += 10;
    
    // Liquidity risk
    const liquidity = pair.liquidity?.usd || 0;
    if (liquidity < 5000) riskScore += 25;
    else if (liquidity < 20000) riskScore += 15;
    else if (liquidity < 50000) riskScore += 5;
    
    // Honeypot risk
    if (isPotentialHoneypot) riskScore += 40;
    
    // Transaction pattern risk
    const buys = pair.txns?.h1?.buys || 0;
    const sells = pair.txns?.h1?.sells || 0;
    if (sells === 0 && buys > 10) riskScore += 20;
    
    // Volatility risk
    const volatility = Math.abs(pair.priceChange?.h24 || 0);
    if (volatility > 100) riskScore += 15;
    else if (volatility > 50) riskScore += 10;
    
    return Math.min(riskScore, 100);
  }

  private shouldAlert(event: WhaleMagnetEvent): boolean {
    return (
      event.liquidityUsd >= this.LIQUIDITY_THRESHOLD_USD &&
      event.recentBuys >= this.BUYS_THRESHOLD_H1 &&
      event.pairAgeMinutes <= (this.MAX_AGE_HOURS * 60) &&
      event.riskScore <= 80 // Don't alert on extremely high risk
    );
  }

  private logTokenDetails(event: WhaleMagnetEvent, type: string) {
    this.logger.log(`🔗 URL: ${event.pairUrl}`);
    this.logger.log(`💰 Liquidity: $${event.liquidityUsd.toLocaleString()}`);
    this.logger.log(`📈 1H Buys/Sells: ${event.recentBuys} / ${event.recentSells}`);
    this.logger.log(`💵 Price: $${event.priceUsd} | FDV: $${event.fdv?.toLocaleString()} | MC: $${event.marketCap?.toLocaleString()}`);
    this.logger.log(`⏳ Age: ${event.pairAgeMinutes} minutes (${event.createdTime})`);
    this.logger.log(`⚖️ Buy/Sell Ratio: ${event.buySellRatio}`);
    this.logger.log(`🎯 Risk Score: ${event.riskScore}/100`);
    this.logger.log(`⚠️ Honeypot Risk: ${event.isPotentialHoneypot ? 'High' : 'Low'}`);
    this.logger.log(`🐋 Whale Interest: ${event.isWhaleInvested ? 'Yes' : 'No'}`);
    this.logger.log(`📊 Volatility (24h): ${event.volatilityH24.toFixed(2)}%`);
    
    if (event.bondingCurveStatus.progress > 0) {
      this.logger.log(`📈 Bonding Curve: ${event.bondingCurveStatus.progress}% (${event.bondingCurveStatus.curveType})`);
    }
  }

  // Enhanced getSingleTokenDetails method
  public async getSingleTokenDetails(chainId: string, tokenAddress: string): Promise<WhaleMagnetEvent | null> {
    try {
      const pairs: DexscreenerPair[] = await this.fetchTokenPairs(chainId, tokenAddress);

      for (const pair of pairs) {
        const isTargetPair = this.TARGET_QUOTE_SYMBOLS.includes(pair.quoteToken.symbol);

        if (isTargetPair) {
          const pairAgeMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
          const isNewLaunch = pairAgeMinutes <= this.NEW_LAUNCH_THRESHOLD_MINUTES;
          
          const tokenDetails = await this.createWhaleMagnetEvent(pair, isNewLaunch);
          
          if (tokenDetails) {
            // Fetch additional real-time data
            tokenDetails.whaleTransactions = await this.fetchWhaleTransactions(tokenDetails);
            tokenDetails.bondingCurveStatus = await this.analyzeBondingCurve(tokenDetails) || tokenDetails.bondingCurveStatus;
            
            this.logger.log(`🔍 Fetched enhanced details for ${tokenDetails.tokenSymbol} on ${tokenDetails.chainId}`);
            this.logTokenDetails(tokenDetails, 'SINGLE_TOKEN_LOOKUP');
            
            return tokenDetails;
          }
        }
      }
      return null;
    } catch (error) {
      this.logger.error(`Error fetching enhanced token details for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  private async fetchBoostedTokens(url: string): Promise<any[]> {
    try {
      const cacheBustingUrl = `${url}?timestamp=${Date.now()}`;
      const response = await axios.get(cacheBustingUrl, { timeout: 10000 });
      if (response.data && Array.isArray(response.data)) {
        return response.data;
      }
      
      this.logger.warn(`API at ${url} did not return an array as expected.`);
      return [];
    } catch (error) {
      this.logger.error(`Failed to fetch boosted tokens from ${url}:`, error.message);
      return [];
    }
  }

  private async fetchTokenPairs(chainId: string, tokenAddress: string): Promise<DexscreenerPair[]> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const response = await this.fetchWithBackoff(() => axios.get(url, { timeout: 10000 }));
      return response.data?.pairs?.filter((p: DexscreenerPair) => p.chainId === chainId) || [];
    } catch (error: any) {
      this.logger.error(`Failed to fetch pairs for ${tokenAddress} on ${chainId}:`, error?.message || error);
      return [];
    }
  }

  // Public methods for external access
  public getTrackedTokens(): Map<string, WhaleMagnetEvent> {
    return new Map(this.trackedTokens);
  }

  public getTokenDetails(chainId: string, tokenAddress: string): WhaleMagnetEvent | null {
    const tokenKey = `${chainId}-${tokenAddress}`;
    return this.trackedTokens.get(tokenKey) || null;
  }

  public getBondingCurveStatus(chainId: string, tokenAddress: string): BondingCurveStatus | null {
    const tokenKey = `${chainId}-${tokenAddress}`;
    return this.bondingCurveTokens.get(tokenKey) || null;
  }

  // Manual trigger methods for testing/debugging
  public async triggerNewLaunchScan(): Promise<void> {
    await this.trackNewLaunches();
  }

  public async triggerWhaleTransactionScan(): Promise<void> {
    await this.monitorWhaleTransactions();
  }

  public async triggerBondingCurveScan(): Promise<void> {
    await this.monitorBondingCurves();
  }

  // Configuration methods
  public updateThresholds(config: {
    liquidityThreshold?: number;
    buysThreshold?: number;
    whaleThreshold?: number;
    maxAgeHours?: number;
  }): void {
    if (config.liquidityThreshold) {
      (this as any).LIQUIDITY_THRESHOLD_USD = config.liquidityThreshold;
    }
    if (config.buysThreshold) {
      (this as any).BUYS_THRESHOLD_H1 = config.buysThreshold;
    }
    if (config.whaleThreshold) {
      (this as any).WHALE_INVESTMENT_THRESHOLD_USD = config.whaleThreshold;
    }
    if (config.maxAgeHours) {
      (this as any).MAX_AGE_HOURS = config.maxAgeHours;
    }
    
    this.logger.log('Updated thresholds:', config);
  }

  public addWhaleWallet(walletAddress: string): void {
    this.whaleWallets.add(walletAddress.toLowerCase());
    this.logger.log(`Added whale wallet: ${walletAddress}`);
  }

  public removeWhaleWallet(walletAddress: string): void {
    this.whaleWallets.delete(walletAddress.toLowerCase());
    this.logger.log(`Removed whale wallet: ${walletAddress}`);
  }

  // Cleanup methods
  public clearAnalyzedTokens(): void {
    this.analyzedTokens.clear();
    this.logger.log('Cleared analyzed tokens cache');
  }

  public removeOldTrackedTokens(maxAgeHours: number = 24): void {
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    let removedCount = 0;
    
    for (const [tokenKey, tokenEvent] of this.trackedTokens.entries()) {
      if (tokenEvent.pairCreatedAt < cutoffTime) {
        this.trackedTokens.delete(tokenKey);
        this.bondingCurveTokens.delete(tokenKey);
        removedCount++;
      }
    }
    
    this.logger.log(`Removed ${removedCount} old tracked tokens (older than ${maxAgeHours}h)`);
  }

  // Statistics methods
  public getStatistics(): {
    analyzedTokensCount: number;
    trackedTokensCount: number;
    bondingCurveTokensCount: number;
    whaleWalletsCount: number;
    newLaunchesCount: number;
    completedBondingCurvesCount: number;
  } {
    const newLaunchesCount = Array.from(this.trackedTokens.values()).filter(t => t.isNewLaunch).length;
    const completedBondingCurvesCount = Array.from(this.bondingCurveTokens.values()).filter(bc => bc.isCompleted).length;
    
    return {
      analyzedTokensCount: this.analyzedTokens.size,
      trackedTokensCount: this.trackedTokens.size,
      bondingCurveTokensCount: this.bondingCurveTokens.size,
      whaleWalletsCount: this.whaleWallets.size,
      newLaunchesCount,
      completedBondingCurvesCount
    };
  }
}