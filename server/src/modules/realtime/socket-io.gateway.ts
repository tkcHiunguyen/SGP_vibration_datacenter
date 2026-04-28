import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import type {
  AlertRecord,
  DeviceCommand,
  DeviceHeartbeat,
  DeviceMetadata,
  TelemetryMessage,
  TelemetrySpectrumMessage,
} from '../../shared/types.js';
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

  broadcastTelemetrySpectrum(message: TelemetrySpectrumMessage): void {
    this.io.to(SocketIoGateway.DASHBOARD_ROOM).emit('telemetry:spectrum', message);
  }

  broadcastAlert(record: AlertRecord): void {
    this.io.to(SocketIoGateway.DASHBOARD_ROOM).emit('alert', record);
  }

  broadcastDeviceHeartbeat(payload: {
    deviceId: string;
    connectedAt?: string;
    lastHeartbeatAt?: string;
    heartbeat?: DeviceHeartbeat;
  }): void {
    this.io.to(SocketIoGateway.DASHBOARD_ROOM).emit('device:heartbeat', payload);
  }

  broadcastDeviceMetadata(payload: { deviceId: string; metadata: DeviceMetadata }): void {
    this.io.to(SocketIoGateway.DASHBOARD_ROOM).emit('device:metadata', payload);
  }

  sendCommand(deviceId: string, command: DeviceCommand): void {
    const payload =
      command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload)
        ? command.payload
        : {};
    const payloadCommand =
      typeof payload.command === 'string' && payload.command.trim()
        ? payload.command.trim()
        : command.type;
    const payloadType =
      typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : command.type;
    const payloadDeviceId =
      typeof payload.deviceId === 'string' && payload.deviceId.trim() ? payload.deviceId.trim() : deviceId;
    const wirePayload: Record<string, unknown> = {
      ...payload,
      commandId: command.commandId,
      command: payloadCommand,
      type: payloadType,
      deviceId: payloadDeviceId,
    };
    this.io.to(`device:${deviceId}`).emit('device:command', wirePayload);
  }

  disconnectDevice(deviceId: string): void {
    this.io.in(`device:${deviceId}`).disconnectSockets(true);
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
