import type { Socket } from 'socket.io';

import type {
  AlertRecord,
  DeviceCommand,
  DeviceHeartbeat,
  DeviceMetadata,
  TelemetryMessage,
  TelemetrySpectrumMessage,
} from '../../shared/types.js';
import { DASHBOARD_ROOM, type RealtimeGateway } from './realtime.gateway.js';

export class CompositeRealtimeGateway implements RealtimeGateway {
  constructor(private readonly gateways: RealtimeGateway[]) {
    if (gateways.length === 0) {
      throw new Error('At least one realtime gateway is required');
    }
  }

  broadcastTelemetry(message: TelemetryMessage): void {
    this.forEachGateway((gateway) => gateway.broadcastTelemetry(message));
  }

  broadcastTelemetrySpectrum(message: TelemetrySpectrumMessage): void {
    this.forEachGateway((gateway) => gateway.broadcastTelemetrySpectrum(message));
  }

  broadcastAlert(record: AlertRecord): void {
    this.forEachGateway((gateway) => gateway.broadcastAlert(record));
  }

  broadcastDeviceHeartbeat(payload: {
    deviceId: string;
    connectedAt?: string;
    lastHeartbeatAt?: string;
    heartbeat?: DeviceHeartbeat;
  }): void {
    this.forEachGateway((gateway) => gateway.broadcastDeviceHeartbeat(payload));
  }

  broadcastDeviceMetadata(payload: { deviceId: string; metadata: DeviceMetadata }): void {
    this.forEachGateway((gateway) => gateway.broadcastDeviceMetadata(payload));
  }

  sendCommand(deviceId: string, command: DeviceCommand): void {
    this.forEachGateway((gateway) => gateway.sendCommand(deviceId, command));
  }

  disconnectDevice(deviceId: string): void {
    this.forEachGateway((gateway) => gateway.disconnectDevice(deviceId));
  }

  onConnection(handler: (socket: Socket) => void): void {
    this.forEachGateway((gateway) => gateway.onConnection(handler));
  }

  joinDashboardRoom(socket: Socket): void {
    socket.join(DASHBOARD_ROOM);
  }

  connectedClientsCount(): number {
    return this.gateways.reduce(
      (connectedClients, gateway) => connectedClients + gateway.connectedClientsCount(),
      0,
    );
  }

  close(): void {
    this.forEachGateway((gateway) => gateway.close());
  }

  private forEachGateway(action: (gateway: RealtimeGateway) => void): void {
    for (const gateway of this.gateways) {
      action(gateway);
    }
  }
}
