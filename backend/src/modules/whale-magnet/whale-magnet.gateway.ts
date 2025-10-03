import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { WhaleMagnetService } from './whale-magnet.service';

@WebSocketGateway({
  cors: {
    origin: process.env.WS_CORS_ORIGIN || 'http://localhost:8080',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  namespace: '/whale-magnet',
})
export class WhaleMagnetGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WhaleMagnetGateway.name);

  constructor(private readonly whaleMagnetService: WhaleMagnetService) {
    const emitter = this.whaleMagnetService.whaleMagnetEmitter;
    emitter.on('new_launch', (event) => {
      this.server.emit('new_launch', { type: 'new_launch', data: event, timestamp: Date.now() });
    });
    emitter.on('whale_magnet', (event) => {
      this.server.emit('whale_magnet', { type: 'whale_magnet', data: event, timestamp: Date.now() });
    });
    emitter.on('bonding_curve_progress', (payload) => {
      this.server.emit('bonding_curve_progress', { type: 'bonding_curve_progress', data: payload, timestamp: Date.now() });
    });
    emitter.on('bonding_curve_completed', (payload) => {
      this.server.emit('bonding_curve_completed', { type: 'bonding_curve_completed', data: payload, timestamp: Date.now() });
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
}


