import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';

export type DeviceRemovalResult = {
  metadata: DeviceMetadata;
  telemetryDeleted: number;
};

export interface DeviceRepository {
  upsertMetadata(metadata: DeviceMetadata): Promise<void>;
  removeMetadata(deviceId: string): Promise<DeviceRemovalResult | null>;
  clearTelemetryData(deviceId: string): Promise<number>;
  getMetadata(deviceId: string): DeviceMetadata | null;
  listMetadata(): DeviceMetadata[];

  upsertSession(session: DeviceSession): void;
  getSession(deviceId: string): DeviceSession | null;
  listSessions(): DeviceSession[];
  removeIfSocketMatches(deviceId: string, socketId: string): boolean;
  touch(deviceId: string, isoTime: string, heartbeat?: DeviceHeartbeat): DeviceSession | null;
  isConnected(deviceId: string): boolean;
  countConnected(): number;
}
