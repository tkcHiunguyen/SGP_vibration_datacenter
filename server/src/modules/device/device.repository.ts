import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';

export interface DeviceRepository {
  upsertMetadata(metadata: DeviceMetadata): void;
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
