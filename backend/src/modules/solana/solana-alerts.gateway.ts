import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SolanaService } from './solana.service';

@WebSocketGateway({
    cors: {
        origin: process.env.WS_CORS_ORIGIN || 'http://localhost:8080',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    namespace: '/solana-alerts',
})
export class SolanaAlertsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(SolanaAlertsGateway.name);
    private connectedClients = 0;

    constructor(private readonly solanaService: SolanaService) {
        // Subscribe to Solana service events
        this.solanaService.whaleTransactionsEmitter.on('whale_transaction', (data) => {
            this.server.emit('whale_transaction', {
                type: 'whale_transaction',
                data,
                timestamp: new Date().toISOString(),
            });
        });

        this.solanaService.whaleTransactionsEmitter.on('whale_alert', (alert) => {
            this.server.emit('whale_alert', {
                type: 'whale_alert',
                data: alert,
                timestamp: new Date().toISOString(),
            });
            
            // Send specific alert level events
            this.server.emit(`alert_${alert.alertLevel.toLowerCase()}`, {
                type: `alert_${alert.alertLevel.toLowerCase()}`,
                data: alert,
                timestamp: new Date().toISOString(),
            });
        });

        this.solanaService.whaleTransactionsEmitter.on('token_analysis', (data) => {
            this.server.emit('token_analysis', {
                type: 'token_analysis',
                data,
                timestamp: new Date().toISOString(),
            });
        });

        this.solanaService.whaleTransactionsEmitter.on('token_buy_analysis', (data) => {
            this.server.emit('token_buy_analysis', {
                type: 'token_buy_analysis',
                data,
                timestamp: new Date().toISOString(),
            });
        });
    }

    handleConnection(client: Socket) {
        this.connectedClients++;
        this.logger.log(`Client connected: ${client.id} (Total: ${this.connectedClients})`);
        
        client.emit('connection-established', {
            message: 'Connected to Solana Whale Alerts',
            timestamp: new Date().toISOString(),
            clientId: client.id,
        });

        // Send current stats on connection
        this.sendCurrentStats(client);
    }

    handleDisconnect(client: Socket) {
        this.connectedClients--;
        this.logger.log(`Client disconnected: ${client.id} (Total: ${this.connectedClients})`);
    }

    @SubscribeMessage('get_alerts')
    handleGetAlerts(client: Socket) {
        const alerts = this.solanaService.getActiveAlerts();
        client.emit('alerts_response', {
            type: 'alerts_response',
            data: alerts,
            timestamp: new Date().toISOString(),
        });
    }

    @SubscribeMessage('get_monitored_whales')
    handleGetMonitoredWhales(client: Socket) {
        const whales = this.solanaService.getMonitoredWhales();
        client.emit('monitored_whales_response', {
            type: 'monitored_whales_response',
            data: whales,
            timestamp: new Date().toISOString(),
        });
    }

    @SubscribeMessage('get_stats')
    handleGetStats(client: Socket) {
        this.sendCurrentStats(client);
    }

    @SubscribeMessage('mark_alert_read')
    handleMarkAlertRead(client: Socket, @MessageBody() data: { alertId: string }) {
        const success = this.solanaService.markAlertAsRead(data.alertId);
        client.emit('mark_alert_read_response', {
            type: 'mark_alert_read_response',
            success,
            alertId: data.alertId,
            timestamp: new Date().toISOString(),
        });
    }

    @SubscribeMessage('subscribe_alerts')
    handleSubscribeAlerts(client: Socket, @MessageBody() data: { alertLevels?: string[] }) {
        // Join specific alert level rooms
        if (data.alertLevels) {
            data.alertLevels.forEach(level => {
                client.join(`alert_${level.toLowerCase()}`);
            });
        }
        
        client.emit('subscription_confirmed', {
            type: 'subscription_confirmed',
            message: 'Successfully subscribed to alerts',
            alertLevels: data.alertLevels || ['all'],
            timestamp: new Date().toISOString(),
        });
    }

    @SubscribeMessage('unsubscribe_alerts')
    handleUnsubscribeAlerts(client: Socket, @MessageBody() data: { alertLevels?: string[] }) {
        // Leave specific alert level rooms
        if (data.alertLevels) {
            data.alertLevels.forEach(level => {
                client.leave(`alert_${level.toLowerCase()}`);
            });
        }
        
        client.emit('unsubscription_confirmed', {
            type: 'unsubscription_confirmed',
            message: 'Successfully unsubscribed from alerts',
            alertLevels: data.alertLevels || ['all'],
            timestamp: new Date().toISOString(),
        });
    }

    private sendCurrentStats(client: Socket) {
        const alerts = this.solanaService.getActiveAlerts();
        const whales = this.solanaService.getMonitoredWhales();
        
        const unreadAlerts = alerts.filter(alert => !alert.read).length;
        const criticalAlerts = alerts.filter(alert => alert.alertLevel === 'CRITICAL').length;
        const highScoreTokens = alerts.filter(alert => 
            alert.tokenAnalysis.investmentScore >= 80
        ).length;

        const stats = {
            totalAlerts: alerts.length,
            activeWhales: whales.length,
            unreadAlerts,
            criticalAlerts,
            highScoreTokens,
            connectedClients: this.connectedClients,
            timestamp: new Date().toISOString(),
        };

        client.emit('stats_response', {
            type: 'stats_response',
            data: stats,
            timestamp: new Date().toISOString(),
        });
    }

    // Broadcast methods for external use
    broadcastAlert(alert: any) {
        this.server.emit('whale_alert', {
            type: 'whale_alert',
            data: alert,
            timestamp: new Date().toISOString(),
        });
    }

    broadcastWhaleTransaction(transaction: any) {
        this.server.emit('whale_transaction', {
            type: 'whale_transaction',
            data: transaction,
            timestamp: new Date().toISOString(),
        });
    }

    broadcastTokenAnalysis(analysis: any) {
        this.server.emit('token_analysis', {
            type: 'token_analysis',
            data: analysis,
            timestamp: new Date().toISOString(),
        });
    }

    getConnectedClientsCount(): number {
        return this.connectedClients;
    }
}
