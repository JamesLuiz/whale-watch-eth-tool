import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Waves, Coins, TrendingUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balance?: string;
}

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  gasPrice?: string;
  isTokenTransfer?: boolean;
  tokenInfo?: TokenInfo;
  input?: string;
}

interface AddressTokens {
  [address: string]: TokenInfo[];
}

const WhaleTracker = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ethPrice, setEthPrice] = useState(3000);
  const [addressTokens, setAddressTokens] = useState<AddressTokens>({});
  const [expandedTx, setExpandedTx] = useState<string | null>(null);

  // Popular token addresses for demo
  const popularTokens: TokenInfo[] = [
    { address: "0xA0b86a33E6441",  name: "Uniswap", symbol: "UNI", decimals: 18 },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", name: "Dai Stablecoin", symbol: "DAI", decimals: 18 },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", name: "Tether USD", symbol: "USDT", decimals: 6 },
    { address: "0xA0b86a33E6441", name: "Wrapped Bitcoin", symbol: "WBTC", decimals: 8 },
    { address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", name: "Shiba Inu", symbol: "SHIB", decimals: 18 },
  ];

  // Enhanced mock whale transactions with token data
  useEffect(() => {
    const generateMockTransaction = (): Transaction => {
      const value = (Math.random() * 1000 + 100).toFixed(4);
      const isTokenTransfer = Math.random() > 0.6; // 40% chance of token transfer
      const tokenInfo = isTokenTransfer ? popularTokens[Math.floor(Math.random() * popularTokens.length)] : undefined;
      
      return {
        hash: `0x${Math.random().toString(16).substring(2, 66)}`,
        from: `0x${Math.random().toString(16).substring(2, 42)}`,
        to: `0x${Math.random().toString(16).substring(2, 42)}`,
        value,
        timestamp: Date.now(),
        gasPrice: (Math.random() * 100 + 20).toFixed(2),
        isTokenTransfer,
        tokenInfo,
        input: isTokenTransfer ? "0xa9059cbb" : "0x", // transfer method signature for tokens
      };
    };

    // Generate mock address token holdings
    const generateAddressTokens = (address: string): TokenInfo[] => {
      const numTokens = Math.floor(Math.random() * 5) + 1;
      return Array.from({ length: numTokens }, () => {
        const token = popularTokens[Math.floor(Math.random() * popularTokens.length)];
        return {
          ...token,
          balance: (Math.random() * 1000000).toFixed(2),
        };
      });
    };

    const initialTxs = Array.from({ length: 5 }, generateMockTransaction);
    setTransactions(initialTxs);
    
    // Generate token holdings for each address
    const tokenHoldings: AddressTokens = {};
    initialTxs.forEach(tx => {
      if (!tokenHoldings[tx.from]) {
        tokenHoldings[tx.from] = generateAddressTokens(tx.from);
      }
      if (!tokenHoldings[tx.to]) {
        tokenHoldings[tx.to] = generateAddressTokens(tx.to);
      }
    });
    setAddressTokens(tokenHoldings);
    setIsLoading(false);

    // Simulate real-time updates
    const interval = setInterval(() => {
      const newTx = generateMockTransaction();
      setTransactions((prev) => [newTx, ...prev.slice(0, 9)]);
      
      // Add token holdings for new addresses
      setAddressTokens(prev => ({
        ...prev,
        [newTx.from]: prev[newTx.from] || generateAddressTokens(newTx.from),
        [newTx.to]: prev[newTx.to] || generateAddressTokens(newTx.to),
      }));
    }, 8000 + Math.random() * 7000);

    return () => clearInterval(interval);
  }, []);

  // Fetch ETH price
  useEffect(() => {
    const fetchEthPrice = async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
        );
        const data = await response.json();
        setEthPrice(data.ethereum.usd);
      } catch (error) {
        console.error("Failed to fetch ETH price:", error);
      }
    };

    fetchEthPrice();
  }, []);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const getTransactionValue = (ethValue: string) => {
    const eth = parseFloat(ethValue);
    const usd = eth * ethPrice;
    return { eth, usd };
  };

  if (isLoading) {
    return (
      <Card className="glass glow border-primary/20 shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Waves className="h-5 w-5 text-primary" />
            Whale Tracker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-muted/20 rounded-lg"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass glow border-primary/20 shadow-card">
      <CardHeader className="pb-4 sm:pb-6">
        <CardTitle className="flex flex-col sm:flex-row sm:items-center gap-2 text-lg sm:text-xl">
          <div className="flex items-center gap-2">
            <Waves className="h-5 w-5 text-primary animate-glow-pulse" />
            Whale Tracker
          </div>
          <Badge variant="secondary" className="w-fit sm:ml-auto">
            Live
          </Badge>
        </CardTitle>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Real-time tracking of large ETH transactions (100+ ETH)
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3 max-h-72 sm:max-h-80 lg:max-h-96 overflow-y-auto">{transactions.map((tx, index) => {
            const { eth, usd } = getTransactionValue(tx.value);
            const isExpanded = expandedTx === tx.hash;
            return (
              <Collapsible key={tx.hash} open={isExpanded} onOpenChange={(open) => setExpandedTx(open ? tx.hash : null)}>
                <div
                  className={`p-3 sm:p-4 rounded-lg border border-primary/10 bg-card/50 backdrop-blur-sm transition-all duration-500 ${
                    index === 0 ? "animate-slide-up ring-1 ring-primary/30" : ""
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {formatTimeAgo(tx.timestamp)}
                        </Badge>
                        {tx.isTokenTransfer && tx.tokenInfo && (
                          <Badge variant="secondary" className="text-xs flex items-center gap-1">
                            <Coins className="h-3 w-3" />
                            <span className="hidden xs:inline">{tx.tokenInfo.symbol}</span>
                            <span className="xs:hidden">{tx.tokenInfo.symbol.slice(0, 4)}</span>
                          </Badge>
                        )}
                        <a
                          href={`https://etherscan.io/tx/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <div className="text-xs sm:text-sm space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">From:</span>
                          <code className="text-xs bg-muted/20 px-1 rounded break-all">
                            {formatAddress(tx.from)}
                          </code>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">To:</span>
                          <code className="text-xs bg-muted/20 px-1 rounded break-all">
                            {formatAddress(tx.to)}
                          </code>
                        </div>
                        {tx.isTokenTransfer && tx.tokenInfo && (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Token:</span>
                            <span className="text-xs font-medium text-primary">
                              <span className="hidden sm:inline">{tx.tokenInfo.name} ({tx.tokenInfo.symbol})</span>
                              <span className="sm:hidden">{tx.tokenInfo.symbol}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right sm:text-left flex sm:block justify-between items-center sm:items-start">
                      <div className="text-base sm:text-lg font-semibold text-primary">
                        {eth.toFixed(2)} ETH
                      </div>
                      <div className="text-xs sm:text-sm text-muted-foreground">
                        ${usd.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </div>
                      {tx.gasPrice && (
                        <div className="text-xs text-muted-foreground hidden sm:block">
                          {tx.gasPrice} Gwei
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <CollapsibleTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full mt-3 h-8 text-xs"
                    >
                      <span className="hidden sm:inline">
                        {isExpanded ? "Hide Details" : "Show Details & Address Tokens"}
                      </span>
                      <span className="sm:hidden">
                        {isExpanded ? "Hide" : "Details"}
                      </span>
                      <TrendingUp className="h-3 w-3 ml-2" />
                    </Button>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent className="mt-3 space-y-3">
                    <div className="border-t border-primary/10 pt-3">
                      <h4 className="text-sm font-medium mb-2">Transaction Details</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Hash:</span>
                          <p className="font-mono text-xs break-all">{tx.hash}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Input Data:</span>
                          <p className="font-mono text-xs break-all">{tx.input}</p>
                        </div>
                        {tx.gasPrice && (
                          <div className="sm:hidden">
                            <span className="text-muted-foreground">Gas Price:</span>
                            <p className="text-xs">{tx.gasPrice} Gwei</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* From Address Tokens */}
                    <div className="border-t border-primary/10 pt-3">
                      <h4 className="text-xs sm:text-sm font-medium mb-2 flex items-center gap-1">
                        <Coins className="h-3 sm:h-4 w-3 sm:w-4" />
                        <span className="hidden sm:inline">From Address Tokens</span>
                        <span className="sm:hidden">From Tokens</span>
                      </h4>
                      <div className="space-y-1 max-h-24 sm:max-h-32 overflow-y-auto">
                        {addressTokens[tx.from]?.map((token, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2 bg-muted/10 rounded text-xs">
                            <span className="font-medium">{token.symbol}</span>
                            <span className="text-muted-foreground text-right">
                              {parseFloat(token.balance || "0").toLocaleString(undefined, {
                                maximumFractionDigits: 0
                              })}
                            </span>
                          </div>
                        )) || <p className="text-xs text-muted-foreground">No tokens found</p>}
                      </div>
                    </div>
                    
                    {/* To Address Tokens */}
                    <div className="border-t border-primary/10 pt-3">
                      <h4 className="text-xs sm:text-sm font-medium mb-2 flex items-center gap-1">
                        <Coins className="h-3 sm:h-4 w-3 sm:w-4" />
                        <span className="hidden sm:inline">To Address Tokens</span>
                        <span className="sm:hidden">To Tokens</span>
                      </h4>
                      <div className="space-y-1 max-h-24 sm:max-h-32 overflow-y-auto">
                        {addressTokens[tx.to]?.map((token, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2 bg-muted/10 rounded text-xs">
                            <span className="font-medium">{token.symbol}</span>
                            <span className="text-muted-foreground text-right">
                              {parseFloat(token.balance || "0").toLocaleString(undefined, {
                                maximumFractionDigits: 0
                              })}
                            </span>
                          </div>
                        )) || <p className="text-xs text-muted-foreground">No tokens found</p>}
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default WhaleTracker;