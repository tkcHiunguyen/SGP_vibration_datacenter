import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import type { AlertRecord, DeviceCommand, TelemetryMessage } from '../../shared/types.js';
import type { RealtimeGateway } from './realtime.gateway.js';

export class SocketIoGateway implements RealtimeGateway {
  private static readonly DASHBOARD_ROOM = 'dashboard:live';
  private readonly io: SocketIOServer;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: { origin: true, credentials: true },
      transports: ['websocket', 'polling'],
    });
  }

  broadcastTelemetry(message: TelemetryMessage): void {
    this.io.to(SocketIoGateway.DASHBOARD_ROOM).emit('telemetry', message);
  }

  broadcastAlert(record: AlertRecord): void {
    this.io.to(SocketIoGateway.DASHBOARD_ROOM).emit('alert', record);
  }

  sendCommand(deviceId: string, command: DeviceCommand): void {
    this.io.to(`device:${deviceId}`).emit('device:command', command);
  }

  onConnection(handler: (socket: Socket) => void): void {
    this.io.on('connection', handler);
  }

  joinDashboardRoom(socket: Socket): void {
    socket.join(SocketIoGateway.DASHBOARD_ROOM);
  }

  connectedClientsCount(): number {
    return this.io.engine.clientsCount;
  }

  close(): void {
    this.io.close();
  }
}
