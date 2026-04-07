import type { DeviceRepository } from './device.repository.js';
import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import { getSharedMySqlAccess } from '../persistence/mysql-access.js';

type DeviceMetadataRow = {
  device_id: string;
  uuid: string | null;
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
  private readonly mysql: MySqlAccess | null;

  private constructor(mysql: MySqlAccess | null = getSharedMySqlAccess()) {
    this.mysql = mysql;
  }

  static async create(mysql: MySqlAccess | null = getSharedMySqlAccess()): Promise<InMemoryDeviceRepository> {
    const repository = new InMemoryDeviceRepository(mysql);
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

  touch(deviceId: string, isoTime: string, heartbeat?: DeviceHeartbeat): DeviceSession | null {
    const found = this.sessions.get(deviceId);
    if (!found) {
      return null;
    }

    const next: DeviceSession = {
      ...found,
      lastHeartbeatAt: isoTime,
      heartbeat: heartbeat ? { ...(found.heartbeat ?? {}), ...heartbeat } : found.heartbeat,
    };
    this.sessions.set(deviceId, next);
    void this.persistSession(next);
    return next;
  }

  isConnected(deviceId: string): boolean {
    return this.sessions.has(deviceId);
  }

  countConnected(): number {
    return this.sessions.size;
  }

  private async persistMetadata(metadata: DeviceMetadata): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute(
      `
        INSERT INTO device_metadata (
          device_id, uuid, name, site, zone, firmware_version, sensor_version, notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          uuid = VALUES(uuid),
          name = VALUES(name),
          site = VALUES(site),
          zone = VALUES(zone),
          firmware_version = VALUES(firmware_version),
          sensor_version = VALUES(sensor_version),
          notes = VALUES(notes),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at)
      `,
      [
        metadata.deviceId,
        metadata.uuid ?? null,
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
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute(
      `
        INSERT INTO device_sessions (
          device_id, socket_id, client_ip, connected_at, last_heartbeat_at, socket_connected, sta_connected, signal_strength, uptime_sec
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          socket_id = VALUES(socket_id),
          client_ip = VALUES(client_ip),
          connected_at = VALUES(connected_at),
          last_heartbeat_at = VALUES(last_heartbeat_at),
          socket_connected = VALUES(socket_connected),
          sta_connected = VALUES(sta_connected),
          signal_strength = VALUES(signal_strength),
          uptime_sec = VALUES(uptime_sec)
      `,
      [
        session.deviceId,
        session.socketId,
        session.clientIp ?? null,
        session.connectedAt,
        session.lastHeartbeatAt,
        session.heartbeat?.socketConnected ?? null,
        session.heartbeat?.staConnected ?? null,
        session.heartbeat?.signal ?? null,
        session.heartbeat?.uptimeSec ?? null,
      ],
    );
  }

  private async deleteSession(deviceId: string, socketId: string): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute('DELETE FROM device_sessions WHERE device_id = ? AND socket_id = ?', [
      deviceId,
      socketId,
    ]);
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.mysql) {
      return;
    }

    const metadataRows = await this.mysql.query<DeviceMetadataRow>(
      `
        SELECT device_id, uuid, name, site, zone, firmware_version, sensor_version, notes, created_at, updated_at
        FROM device_metadata
        ORDER BY device_id ASC
      `,
    );
    for (const row of metadataRows) {
      this.metadata.set(row.device_id, {
        deviceId: row.device_id,
        uuid: row.uuid ?? undefined,
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
    await this.mysql.execute('DELETE FROM device_sessions');
  }
}
