export interface IWhaleAddress {
  address: string;
  balance: string;
  balanceUsd: number;
  firstSeen: Date;
  lastActivity: Date;
  transactionCount: number;
  tags: string[];
  isActive: boolean;
}

export interface IWhaleTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  valueUsd: number;
  gasPrice: string;
  gasUsed: string;
  timestamp: Date;
  blockNumber: number;
  isTokenTransfer: boolean;
  tokenInfo?: ITokenInfo;
  method?: string;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface ITokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
  price?: number;
  marketCap?: number;
  volume24h?: number;
  priceChange24h?: number;
  holders?: number;
  isVerified: boolean;
  tags: string[];
}

export interface ITokenTransfer {
  transactionHash: string;
  from: string;
  to: string;
  tokenAddress: string;
  amount: string;
  amountFormatted: string;
  amountUsd: number;
  timestamp: Date;
  blockNumber: number;
}