import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EthConverter = () => {
  const [wei, setWei] = useState("");
  const [gwei, setGwei] = useState("");
  const [eth, setEth] = useState("");
  const [ethPrice, setEthPrice] = useState(0);
  const [usdValue, setUsdValue] = useState(0);

  // Conversion constants
  const WEI_TO_GWEI = 1e9;
  const WEI_TO_ETH = 1e18;
  const GWEI_TO_ETH = 1e9;

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
        setEthPrice(3000); // Fallback price
      }
    };

    fetchEthPrice();
    const interval = setInterval(fetchEthPrice, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Update USD value when ETH changes
  useEffect(() => {
    const ethFloat = parseFloat(eth) || 0;
    setUsdValue(ethFloat * ethPrice);
  }, [eth, ethPrice]);

  const handleWeiChange = (value: string) => {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setWei(value);
      const weiValue = parseFloat(value) || 0;
      setGwei((weiValue / WEI_TO_GWEI).toString());
      setEth((weiValue / WEI_TO_ETH).toString());
    }
  };

  const handleGweiChange = (value: string) => {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setGwei(value);
      const gweiValue = parseFloat(value) || 0;
      setWei((gweiValue * WEI_TO_GWEI).toString());
      setEth((gweiValue / GWEI_TO_ETH).toString());
    }
  };

  const handleEthChange = (value: string) => {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setEth(value);
      const ethValue = parseFloat(value) || 0;
      setWei((ethValue * WEI_TO_ETH).toString());
      setGwei((ethValue * GWEI_TO_ETH).toString());
    }
  };

  const formatNumber = (value: string, decimals = 8) => {
    const num = parseFloat(value);
    if (isNaN(num) || num === 0) return "0";
    if (num < 1e-8) return num.toExponential(3);
    return num.toFixed(decimals).replace(/\.?0+$/, "");
  };

  return (
    <Card className="glass glow border-primary/20 shadow-card">
      <CardHeader className="text-center pb-4 sm:pb-6">
        <CardTitle className="text-xl sm:text-2xl bg-gradient-primary bg-clip-text text-transparent">
          Ethereum Unit Converter
        </CardTitle>
        <p className="text-sm sm:text-base text-muted-foreground">
          Convert between Wei, Gwei, and ETH in real-time
        </p>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6 pt-0">
        <div className="grid gap-3 sm:gap-4">
          <div className="space-y-2">
            <Label htmlFor="wei" className="text-sm font-medium">
              Wei
            </Label>
            <Input
              id="wei"
              type="text"
              placeholder="0"
              value={wei}
              onChange={(e) => handleWeiChange(e.target.value)}
              className="glass border-primary/30 focus:border-primary text-base sm:text-lg font-mono transition-all duration-300"
            />
            <p className="text-xs text-muted-foreground break-all">
              {wei && formatNumber(wei)} Wei
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gwei" className="text-sm font-medium">
              Gwei
            </Label>
            <Input
              id="gwei"
              type="text"
              placeholder="0"
              value={gwei}
              onChange={(e) => handleGweiChange(e.target.value)}
              className="glass border-primary/30 focus:border-primary text-base sm:text-lg font-mono transition-all duration-300"
            />
            <p className="text-xs text-muted-foreground break-all">
              {gwei && formatNumber(gwei)} Gwei
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="eth" className="text-sm font-medium">
              Ether (ETH)
            </Label>
            <Input
              id="eth"
              type="text"
              placeholder="0"
              value={eth}
              onChange={(e) => handleEthChange(e.target.value)}
              className="glass border-primary/30 focus:border-primary text-base sm:text-lg font-mono transition-all duration-300"
            />
            <p className="text-xs text-muted-foreground break-all">
              {eth && formatNumber(eth, 18)} ETH
            </p>
          </div>

          <div className="pt-3 sm:pt-4 border-t border-primary/20">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-0">
              <span className="text-sm text-muted-foreground">USD Value:</span>
              <span className="text-lg sm:text-xl font-semibold text-primary">
                ${usdValue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mt-2 gap-1 sm:gap-0">
              <span className="text-xs text-muted-foreground">ETH Price:</span>
              <span className="text-sm text-muted-foreground">
                ${ethPrice.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EthConverter;