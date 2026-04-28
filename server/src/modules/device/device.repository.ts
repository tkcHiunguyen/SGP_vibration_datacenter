import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';

export type DeviceDeletionImpact = {
  deviceId: string;
  deviceName?: string;
  deviceRows: number;
  telemetryRows: number;
  spectrumFrames: number;
  spectrumBytes: number;
  socketSessions: number;
  commandRows: number;
  alertRows: number;
  auditLogRows: number;
  totalRows: number;
};

export type DeviceRemovalResult = {
  metadata: DeviceMetadata;
  impact: DeviceDeletionImpact;
};

export interface DeviceRepository {
  upsertMetadata(metadata: DeviceMetadata): Promise<void>;
  inspectRemoval(deviceId: string): Promise<DeviceDeletionImpact | null>;
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
