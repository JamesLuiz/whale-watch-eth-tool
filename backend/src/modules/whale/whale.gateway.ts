import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WhaleTransactionDto } from '../../common/dto/whale.dto';

@WebSocketGateway({
  cors: {
    origin: process.env.WS_CORS_ORIGIN || 'http://localhost:8080',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/whale-tracker',
})
export class WhaleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WhaleGateway.name);
  private connectedClients = 0;

  handleConnection(client: Socket) {
    this.connectedClients++;
    this.logger.log(`Client connected: ${client.id} (Total: ${this.connectedClients})`);
    
    client.emit('connection-established', {
      message: 'Connected to Whale Tracker',
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket) {
    this.connectedClients--;
    this.logger.log(`Client disconnected: ${client.id} (Total: ${this.connectedClients})`);
  }

  emitNewTransaction(transaction: WhaleTransactionDto) {
    this.server.emit('new-whale-transaction', transaction);
    this.logger.debug(`Emitted new whale transaction: ${transaction.hash}`);
  }

  emitWhaleStats(stats: any) {
    this.server.emit('whale-stats-update', stats);
  }

  emitTrendingTokens(tokens: any) {
    this.server.emit('trending-tokens-update', tokens);
  }

  getConnectedClientsCount(): number {
    return this.connectedClients;
  }
}