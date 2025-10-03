import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type AlertLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface WhaleAlert {
  id: string;
  timestamp: number;
  whaleAddress: string;
  tokenAddress: string;
  alertLevel: AlertLevel;
  message: string;
  read: boolean;
  tokenAnalysis: {
    name: string;
    symbol: string;
    price: number;
    marketCap: number;
    liquidity: number;
    investmentScore: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    alerts: string[];
    recommendations: string[];
  };
}

const WS_SOL_URL = (import.meta.env.VITE_BACKEND_WS ?? 'ws://localhost:3001') + '/solana-alerts';
const WS_WM_URL = (import.meta.env.VITE_BACKEND_WS ?? 'ws://localhost:3001') + '/whale-magnet';
const API_URL = (import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001') + '/api/v1/solana/alerts';

function alertBadge(level: AlertLevel) {
  switch (level) {
    case 'CRITICAL': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'HIGH': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'MEDIUM': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  }
}

export default function SolanaAlerts() {
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  // Initial load
  useEffect(() => {
    fetch(`${API_URL}`)
      .then(r => r.json())
      .then(data => setAlerts(data.alerts || []))
      .catch(() => {});
  }, []);

  // WebSocket live updates with retry
  useEffect(() => {
    let retry = 0;
    function connect() {
      const ws = new WebSocket(WS_SOL_URL.replace('http', 'ws').replace('https', 'wss'));
      socketRef.current = ws;
      ws.onopen = () => { setConnected(true); retry = 0; };
      ws.onclose = () => {
        setConnected(false);
        const delay = Math.min(1000 * Math.pow(2, retry++), 15000);
        setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'whale_alert' && msg.data) {
            setAlerts(prev => [msg.data as WhaleAlert, ...prev].slice(0, 200));
          }
          if (msg.type === 'alerts_response' && Array.isArray(msg.data)) {
            setAlerts(msg.data as WhaleAlert[]);
          }
        } catch {}
      };
    }
    connect();
    return () => { socketRef.current?.close(); };
  }, []);

  // Listen to whale magnet new launches
  useEffect(() => {
    const ws = new WebSocket(WS_WM_URL.replace('http', 'ws').replace('https', 'wss'));
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'new_launch' && msg.data) {
          const launch = msg.data;
          const alert: WhaleAlert = {
            id: `launch_${launch.chainId}_${launch.tokenAddress}_${msg.timestamp}`,
            timestamp: msg.timestamp,
            whaleAddress: 'new_launch',
            tokenAddress: launch.tokenAddress,
            alertLevel: 'MEDIUM',
            message: `New launch: ${launch.tokenSymbol} on ${launch.chainId}`,
            read: false,
            tokenAnalysis: {
              name: launch.tokenSymbol,
              symbol: launch.tokenSymbol,
              price: parseFloat(launch.priceUsd || '0') || 0,
              marketCap: launch.marketCap || 0,
              liquidity: launch.liquidityUsd || 0,
              investmentScore: 50,
              riskLevel: 'HIGH',
              alerts: ['New token launch'],
              recommendations: ['Monitor bonding curve and liquidity']
            }
          };
          setAlerts(prev => [alert, ...prev].slice(0, 200));
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const stats = useMemo(() => {
    const unread = alerts.filter(a => !a.read).length;
    const critical = alerts.filter(a => a.alertLevel === 'CRITICAL').length;
    const highScore = alerts.filter(a => (a.tokenAnalysis?.investmentScore ?? 0) >= 80).length;
    return { unread, critical, highScore, total: alerts.length };
  }, [alerts]);

  const markRead = async (id: string) => {
    try {
      await fetch(`${API_URL}/${id}/read`, { method: 'PATCH' });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));
    } catch {}
  };

  return (
    <Card className="glass glow border-primary/20 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Solana Whale Alerts
          <Badge variant="secondary">{connected ? 'Live' : 'Reconnecting...'}</Badge>
          <Badge variant="outline">{stats.total} alerts</Badge>
          <Badge variant="outline">{stats.unread} unread</Badge>
          <Badge variant="outline">{stats.critical} critical</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-96 overflow-y-auto">
        {alerts.map(alert => (
          <div key={alert.id} className="p-3 rounded-lg border border-primary/10 bg-card/50">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-xs ${alertBadge(alert.alertLevel)}`}>{alert.alertLevel}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(alert.timestamp).toLocaleTimeString()}</span>
              </div>
              {!alert.read && (
                <Button size="sm" variant="ghost" className="h-7" onClick={() => markRead(alert.id)}>Mark read</Button>
              )}
            </div>
            <div className="mt-2 text-sm">
              <div className="font-medium">{alert.tokenAnalysis?.name} ({alert.tokenAnalysis?.symbol})</div>
              <div className="text-xs text-muted-foreground">{alert.message}</div>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>Liquidity: ${alert.tokenAnalysis?.liquidity?.toLocaleString?.() || 0}</div>
                <div>Market Cap: ${alert.tokenAnalysis?.marketCap?.toLocaleString?.() || 0}</div>
                <div>Score: {alert.tokenAnalysis?.investmentScore?.toFixed?.(1) || 0}/100</div>
                <div>Risk: {alert.tokenAnalysis?.riskLevel}</div>
              </div>
              {alert.tokenAnalysis?.alerts?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {alert.tokenAnalysis.alerts.slice(0, 4).map((a, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{a}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="text-xs text-muted-foreground">No alerts yet. Waiting for whale activity...</div>
        )}
      </CardContent>
    </Card>
  );
}


