import type { AlertRecord, DeviceCommand, TelemetryMessage } from '../../shared/types.js';
import type { Socket } from 'socket.io';

export interface RealtimeGateway {
  broadcastTelemetry(message: TelemetryMessage): void;
  broadcastAlert(record: AlertRecord): void;
  sendCommand(deviceId: string, command: DeviceCommand): void;
  onConnection(handler: (socket: Socket) => void): void;
  joinDashboardRoom(socket: Socket): void;
  connectedClientsCount(): number;
  close(): void;
}
