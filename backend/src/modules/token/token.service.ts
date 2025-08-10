import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import axios from 'axios';
import { ITokenInfo } from '../../common/interfaces/whale.interface';
import { EthereumUtil } from '../../common/utils/ethereum.util';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private provider: ethers.JsonRpcProvider;
  private tokenCache: Map<string, ITokenInfo> = new Map();
  private priceCache: Map<string, any> = new Map();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  // Standard ERC-20 ABI for basic token operations
  private readonly erc20Abi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
  ];

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('ETHEREUM_RPC_URL');
    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async getTokenInfo(address: string): Promise<ITokenInfo | null> {
    try {
      if (!EthereumUtil.isValidAddress(address)) {
        throw new Error('Invalid token contract address');
      }

      const checksumAddress = EthereumUtil.checksumAddress(address);
      
      // Check cache first
      const cached = this.tokenCache.get(checksumAddress);
      if (cached) {
        return cached;
      }

      const contract = new ethers.Contract(checksumAddress, this.erc20Abi, this.provider);

      const [name, symbol, decimals, totalSupply] = await Promise.allSettled([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply(),
      ]);

      const tokenInfo: ITokenInfo = {
        address: checksumAddress,
        name: name.status === 'fulfilled' ? name.value : 'Unknown',
        symbol: symbol.status === 'fulfilled' ? symbol.value : 'UNKNOWN',
        decimals: decimals.status === 'fulfilled' ? decimals.value : 18,
        totalSupply: totalSupply.status === 'fulfilled' ? totalSupply.value.toString() : '0',
        isVerified: false,
        tags: [],
      };

      // Try to get additional info from external APIs
      await this.enrichTokenInfo(tokenInfo);

      // Cache the result
      this.tokenCache.set(checksumAddress, tokenInfo);

      return tokenInfo;
    } catch (error) {
      this.logger.error(`Error getting token info for ${address}:`, error.message);
      return null;
    }
  }

  async analyzeTransaction(tx: any): Promise<ITokenInfo | null> {
    try {
      if (!tx.to || !tx.data || tx.data === '0x') {
        return null;
      }

      // Check if it's a token transfer
      const methodSig = tx.data.slice(0, 10);
      const isTokenTransfer = [
        '0xa9059cbb', // transfer
        '0x23b872dd', // transferFrom
      ].includes(methodSig);

      if (!isTokenTransfer) {
        return null;
      }

      return this.getTokenInfo(tx.to);
    } catch (error) {
      this.logger.error('Error analyzing transaction for token info:', error.message);
      return null;
    }
  }

  async getTokenPrice(address: string) {
    try {
      const checksumAddress = EthereumUtil.checksumAddress(address);
      
      // Check cache first
      const cached = this.priceCache.get(checksumAddress);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }

      // Try multiple price sources
      const priceData = await this.fetchTokenPrice(checksumAddress);
      
      // Cache the result
      this.priceCache.set(checksumAddress, {
        data: priceData,
        timestamp: Date.now(),
      });

      return priceData;
    } catch (error) {
      this.logger.error(`Error getting token price for ${address}:`, error.message);
      return null;
    }
  }

  async getTokenHolders(address: string, limit: number = 100) {
    try {
      // This would typically require a service like Etherscan or Moralis
      // For now, return a placeholder response
      return {
        tokenAddress: address,
        totalHolders: 0,
        topHolders: [],
        message: 'Token holder data requires external API integration',
      };
    } catch (error) {
      this.logger.error(`Error getting token holders for ${address}:`, error.message);
      return null;
    }
  }

  async getAddressTokenHoldings(address: string) {
    try {
      if (!EthereumUtil.isValidAddress(address)) {
        throw new Error('Invalid Ethereum address');
      }

      // This would typically require scanning for token transfers
      // or using a service like Moralis, Alchemy, etc.
      // For now, return popular tokens with mock balances
      const popularTokens = [
        { address: '0xA0b86a33E6441', name: 'Uniswap', symbol: 'UNI', decimals: 18 },
        { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18 },
        { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'Tether USD', symbol: 'USDT', decimals: 6 },
        { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', name: 'Shiba Inu', symbol: 'SHIB', decimals: 18 },
      ];

      const holdings = popularTokens.map(token => ({
        ...token,
        balance: (Math.random() * 1000000).toFixed(2),
        balanceFormatted: (Math.random() * 1000000).toFixed(2),
        balanceUsd: Math.random() * 50000,
      }));

      return {
        address,
        tokens: holdings,
        totalValueUsd: holdings.reduce((sum, token) => sum + token.balanceUsd, 0),
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error getting token holdings for ${address}:`, error.message);
      return null;
    }
  }

  async getTrendingTokensByWhaleActivity(timeframe: string = '24h') {
    // This would analyze recent whale transactions for token trends
    // For now, return mock trending tokens
    const mockTrendingTokens = [
      {
        address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
        name: 'Shiba Inu',
        symbol: 'SHIB',
        whaleTransactions: Math.floor(Math.random() * 50) + 10,
        totalVolume: Math.random() * 1000000,
        uniqueWhales: Math.floor(Math.random() * 20) + 5,
        priceChange24h: (Math.random() - 0.5) * 20,
      },
      {
        address: '0xA0b86a33E6441',
        name: 'Uniswap',
        symbol: 'UNI',
        whaleTransactions: Math.floor(Math.random() * 30) + 5,
        totalVolume: Math.random() * 500000,
        uniqueWhales: Math.floor(Math.random() * 15) + 3,
        priceChange24h: (Math.random() - 0.5) * 15,
      },
    ];

    return {
      timeframe,
      tokens: mockTrendingTokens,
      lastUpdated: new Date().toISOString(),
    };
  }

  async searchTokens(query: string) {
    try {
      // This would typically search through a token database
      // For now, return mock search results
      const mockResults = [
        {
          address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
          name: 'Shiba Inu',
          symbol: 'SHIB',
          decimals: 18,
          isVerified: true,
        },
        {
          address: '0xA0b86a33E6441',
          name: 'Uniswap',
          symbol: 'UNI',
          decimals: 18,
          isVerified: true,
        },
      ].filter(token => 
        token.name.toLowerCase().includes(query.toLowerCase()) ||
        token.symbol.toLowerCase().includes(query.toLowerCase())
      );

      return {
        query,
        results: mockResults,
        count: mockResults.length,
      };
    } catch (error) {
      this.logger.error(`Error searching tokens with query "${query}":`, error.message);
      return { query, results: [], count: 0 };
    }
  }

  private async enrichTokenInfo(tokenInfo: ITokenInfo) {
    try {
      // Try to get price and market data from CoinGecko
      const coingeckoData = await this.fetchFromCoinGecko(tokenInfo.address);
      if (coingeckoData) {
        tokenInfo.price = coingeckoData.current_price;
        tokenInfo.marketCap = coingeckoData.market_cap;
        tokenInfo.volume24h = coingeckoData.total_volume;
        tokenInfo.priceChange24h = coingeckoData.price_change_percentage_24h;
        tokenInfo.isVerified = true;
      }
    } catch (error) {
      this.logger.debug('Could not enrich token info from external APIs:', error.message);
    }
  }

  private async fetchFromCoinGecko(address: string) {
    try {
      const response = await axios.get(
        `${this.configService.get('COINGECKO_API_URL')}/coins/ethereum/contract/${address}`,
        { timeout: 5000 }
      );
      return response.data.market_data;
    } catch (error) {
      return null;
    }
  }

  private async fetchTokenPrice(address: string) {
    try {
      // Try DexScreener first (good for new/small tokens)
      const dexResponse = await axios.get(
        `${this.configService.get('DEXSCREENER_API_URL')}/dex/tokens/${address}`,
        { timeout: 5000 }
      );

      if (dexResponse.data.pairs && dexResponse.data.pairs.length > 0) {
        const pair = dexResponse.data.pairs[0];
        return {
          price: parseFloat(pair.priceUsd),
          priceChange24h: parseFloat(pair.priceChange.h24),
          volume24h: parseFloat(pair.volume.h24),
          liquidity: parseFloat(pair.liquidity?.usd || 0),
          source: 'DexScreener',
        };
      }

      // Fallback to CoinGecko
      const coingeckoData = await this.fetchFromCoinGecko(address);
      if (coingeckoData) {
        return {
          price: coingeckoData.current_price?.usd || 0,
          priceChange24h: coingeckoData.price_change_percentage_24h || 0,
          volume24h: coingeckoData.total_volume?.usd || 0,
          marketCap: coingeckoData.market_cap?.usd || 0,
          source: 'CoinGecko',
        };
      }

      return {
        price: 0,
        priceChange24h: 0,
        volume24h: 0,
        source: 'unavailable',
      };
    } catch (error) {
      this.logger.error('Error fetching token price:', error.message);
      return null;
    }
  }
}