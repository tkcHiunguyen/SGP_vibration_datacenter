import type { DeviceRepository } from './device.repository.js';
import type { DeviceMetadata, DeviceSession } from '../../shared/types.js';
import type { PostgresAccess } from '../persistence/postgres-access.js';
import { getSharedPostgresAccess } from '../persistence/postgres-access.js';

type DeviceMetadataRow = {
  device_id: string;
  name: string | null;
  site: string | null;
  zone: string | null;
  firmware_version: string | null;
  sensor_version: string | null;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly metadata = new Map<string, DeviceMetadata>();
  private readonly sessions = new Map<string, DeviceSession>();
  private readonly postgres: PostgresAccess | null;

  private constructor(postgres: PostgresAccess | null = getSharedPostgresAccess()) {
    this.postgres = postgres;
  }

  static async create(postgres: PostgresAccess | null = getSharedPostgresAccess()): Promise<InMemoryDeviceRepository> {
    const repository = new InMemoryDeviceRepository(postgres);
    await repository.loadFromPersistence();
    return repository;
  }

  upsertMetadata(metadata: DeviceMetadata): void {
    this.metadata.set(metadata.deviceId, metadata);
    void this.persistMetadata(metadata);
  }

  getMetadata(deviceId: string): DeviceMetadata | null {
    return this.metadata.get(deviceId) || null;
  }

  listMetadata(): DeviceMetadata[] {
    return [...this.metadata.values()];
  }

  upsertSession(session: DeviceSession): void {
    this.sessions.set(session.deviceId, session);
    void this.persistSession(session);
  }

  getSession(deviceId: string): DeviceSession | null {
    return this.sessions.get(deviceId) || null;
  }

  listSessions(): DeviceSession[] {
    return [...this.sessions.values()];
  }

  removeIfSocketMatches(deviceId: string, socketId: string): boolean {
    const found = this.sessions.get(deviceId);
    if (!found || found.socketId !== socketId) {
      return false;
    }
    this.sessions.delete(deviceId);
    void this.deleteSession(deviceId, socketId);
    return true;
  }

  touch(deviceId: string, isoTime: string): void {
    const found = this.sessions.get(deviceId);
    if (!found) {
      return;
    }
    this.sessions.set(deviceId, {
      ...found,
      connectedAt: isoTime,
    });
  }

  isConnected(deviceId: string): boolean {
    return this.sessions.has(deviceId);
  }

  countConnected(): number {
    return this.sessions.size;
  }

  private async persistMetadata(metadata: DeviceMetadata): Promise<void> {
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(
      `
        INSERT INTO device_metadata (
          device_id, name, site, zone, firmware_version, sensor_version, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
        ON CONFLICT (device_id) DO UPDATE SET
          name = EXCLUDED.name,
          site = EXCLUDED.site,
          zone = EXCLUDED.zone,
          firmware_version = EXCLUDED.firmware_version,
          sensor_version = EXCLUDED.sensor_version,
          notes = EXCLUDED.notes,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        metadata.deviceId,
        metadata.name ?? null,
        metadata.site ?? null,
        metadata.zone ?? null,
        metadata.firmwareVersion ?? null,
        metadata.sensorVersion ?? null,
        metadata.notes ?? null,
        metadata.createdAt,
        metadata.updatedAt,
      ],
    );
  }

  private async persistSession(session: DeviceSession): Promise<void> {
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(
      `
        INSERT INTO device_sessions (
          device_id, socket_id, connected_at, last_heartbeat_at
        )
        VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
        ON CONFLICT (device_id) DO UPDATE SET
          socket_id = EXCLUDED.socket_id,
          connected_at = EXCLUDED.connected_at,
          last_heartbeat_at = EXCLUDED.last_heartbeat_at
      `,
      [session.deviceId, session.socketId, session.connectedAt, session.connectedAt],
    );
  }

  private async deleteSession(deviceId: string, socketId: string): Promise<void> {
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute('DELETE FROM device_sessions WHERE device_id = $1 AND socket_id = $2', [
      deviceId,
      socketId,
    ]);
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.postgres) {
      return;
    }

    const metadataRows = await this.postgres.query<DeviceMetadataRow>(
      `
        SELECT device_id, name, site, zone, firmware_version, sensor_version, notes, created_at, updated_at
        FROM device_metadata
        ORDER BY device_id ASC
      `,
    );
    for (const row of metadataRows) {
      this.metadata.set(row.device_id, {
        deviceId: row.device_id,
        name: row.name ?? undefined,
        site: row.site ?? undefined,
        zone: row.zone ?? undefined,
        firmwareVersion: row.firmware_version ?? undefined,
        sensorVersion: row.sensor_version ?? undefined,
        notes: row.notes ?? undefined,
        createdAt: toIsoTimestamp(row.created_at),
        updatedAt: toIsoTimestamp(row.updated_at),
      });
    }

    // Device sessions are runtime-only. Clearing them on boot avoids stale "online" state after restart.
    await this.postgres.execute('DELETE FROM device_sessions');
  }
}
