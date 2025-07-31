import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Waves } from "lucide-react";

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  gasPrice?: string;
}

const WhaleTracker = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ethPrice, setEthPrice] = useState(3000);

  // Mock whale transactions for demo (in real app, you'd use Ethereum API)
  useEffect(() => {
    const generateMockTransaction = (): Transaction => {
      const value = (Math.random() * 1000 + 100).toFixed(4); // 100-1100 ETH
      return {
        hash: `0x${Math.random().toString(16).substring(2, 66)}`,
        from: `0x${Math.random().toString(16).substring(2, 42)}`,
        to: `0x${Math.random().toString(16).substring(2, 42)}`,
        value,
        timestamp: Date.now(),
        gasPrice: (Math.random() * 100 + 20).toFixed(2),
      };
    };

    // Initial transactions
    const initialTxs = Array.from({ length: 5 }, generateMockTransaction);
    setTransactions(initialTxs);
    setIsLoading(false);

    // Simulate real-time updates
    const interval = setInterval(() => {
      const newTx = generateMockTransaction();
      setTransactions((prev) => [newTx, ...prev.slice(0, 9)]); // Keep latest 10
    }, 8000 + Math.random() * 7000); // Random interval 8-15 seconds

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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Waves className="h-5 w-5 text-primary animate-glow-pulse" />
          Whale Tracker
          <Badge variant="secondary" className="ml-auto">
            Live
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Real-time tracking of large ETH transactions (100+ ETH)
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {transactions.map((tx, index) => {
            const { eth, usd } = getTransactionValue(tx.value);
            return (
              <div
                key={tx.hash}
                className={`p-4 rounded-lg border border-primary/10 bg-card/50 backdrop-blur-sm transition-all duration-500 ${
                  index === 0 ? "animate-slide-up ring-1 ring-primary/30" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-xs">
                        {formatTimeAgo(tx.timestamp)}
                      </Badge>
                      <a
                        href={`https://etherscan.io/tx/${tx.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">From:</span>
                        <code className="text-xs bg-muted/20 px-1 rounded">
                          {formatAddress(tx.from)}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">To:</span>
                        <code className="text-xs bg-muted/20 px-1 rounded">
                          {formatAddress(tx.to)}
                        </code>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-primary">
                      {eth.toFixed(2)} ETH
                    </div>
                    <div className="text-sm text-muted-foreground">
                      ${usd.toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </div>
                    {tx.gasPrice && (
                      <div className="text-xs text-muted-foreground">
                        {tx.gasPrice} Gwei
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default WhaleTracker;