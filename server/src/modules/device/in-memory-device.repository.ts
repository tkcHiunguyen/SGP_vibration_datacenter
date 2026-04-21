import type { DeviceRemovalResult, DeviceRepository } from './device.repository.js';
import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import { getSharedMySqlAccess } from '../persistence/mysql-access.js';
import { randomUUID } from 'node:crypto';

type DeviceMetadataRow = {
  device_id: string;
  uuid: string | null;
  name: string | null;
  site: string | null;
  zone: string | null;
  firmware_version: string | null;
  sensor_version: string | null;
  notes: string | null;
  archived_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

type MySqlErrorLike = {
  code?: string;
  errno?: number;
};

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

  async upsertMetadata(metadata: DeviceMetadata): Promise<void> {
    this.metadata.set(metadata.deviceId, metadata);
    await this.persistMetadata(metadata);
  }

  async removeMetadata(deviceId: string): Promise<DeviceRemovalResult | null> {
    const existing = this.metadata.get(deviceId) ?? null;
    if (!existing) {
      return null;
    }

    let telemetryDeleted = 0;
    if (this.mysql) {
      const now = new Date().toISOString();
      await this.mysql.execute(
        `
          UPDATE devices
          SET archived_at = ?, updated_at = ?
          WHERE device_id = ?
        `,
        [now, now, deviceId],
      );
      telemetryDeleted = await this.mysql.execute('DELETE FROM device_datas WHERE device_id = ?', [deviceId]);
      await this.mysql.execute('DELETE FROM socket_datas WHERE device_id = ?', [deviceId]);
    }

    this.metadata.delete(deviceId);
    this.sessions.delete(deviceId);
    return {
      metadata: existing,
      telemetryDeleted,
    };
  }

  async clearTelemetryData(deviceId: string): Promise<number> {
    if (!this.metadata.has(deviceId)) {
      return 0;
    }
    if (!this.mysql) {
      return 0;
    }
    return await this.mysql.execute('DELETE FROM device_datas WHERE device_id = ?', [deviceId]);
  }

  getMetadata(deviceId: string): DeviceMetadata | null {
    return this.metadata.get(deviceId) || null;
  }

  listMetadata(): DeviceMetadata[] {
    return [...this.metadata.values()];
  }

  upsertSession(session: DeviceSession): void {
    this.sessions.set(session.deviceId, session);
    this.runPersistence(this.persistSession(session), `persistSession(${session.deviceId})`);
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
    this.runPersistence(this.deleteSession(deviceId, socketId), `deleteSession(${deviceId})`);
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
    this.runPersistence(this.persistSession(next), `touch(${deviceId})`);
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
        INSERT INTO devices (
          device_id, uuid, name, site, zone, firmware_version, sensor_version, notes, archived_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          uuid = VALUES(uuid),
          name = VALUES(name),
          site = VALUES(site),
          zone = VALUES(zone),
          firmware_version = VALUES(firmware_version),
          sensor_version = VALUES(sensor_version),
          notes = VALUES(notes),
          archived_at = VALUES(archived_at),
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
        null,
        metadata.createdAt,
        metadata.updatedAt,
      ],
    );
  }

  private async persistSession(session: DeviceSession): Promise<void> {
    if (!this.mysql) {
      return;
    }

    try {
      await this.mysql.execute(
        `
          INSERT INTO socket_datas (
            device_id, socket_id, connected_at, last_heartbeat_at
          )
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            socket_id = VALUES(socket_id),
            connected_at = VALUES(connected_at),
            last_heartbeat_at = VALUES(last_heartbeat_at)
        `,
        [
          session.deviceId,
          session.socketId,
          session.connectedAt,
          session.lastHeartbeatAt,
        ],
      );
    } catch (error) {
      if (!this.isMissingDeviceForeignKeyError(error)) {
        throw error;
      }

      await this.ensureDeviceRowForSession(session.deviceId, session.connectedAt);
      await this.mysql.execute(
        `
          INSERT INTO socket_datas (
            device_id, socket_id, connected_at, last_heartbeat_at
          )
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            socket_id = VALUES(socket_id),
            connected_at = VALUES(connected_at),
            last_heartbeat_at = VALUES(last_heartbeat_at)
        `,
        [
          session.deviceId,
          session.socketId,
          session.connectedAt,
          session.lastHeartbeatAt,
        ],
      );
    }
  }

  private async deleteSession(deviceId: string, socketId: string): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute('DELETE FROM socket_datas WHERE device_id = ? AND socket_id = ?', [
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
        SELECT device_id, uuid, name, site, zone, firmware_version, sensor_version, notes, archived_at, created_at, updated_at
        FROM devices
        WHERE archived_at IS NULL
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
    await this.mysql.execute('DELETE FROM socket_datas');
  }

  private runPersistence(task: Promise<void>, context: string): void {
    void task.catch((error) => {
      console.error(`[device-repository] ${context} failed`, error);
    });
  }

  private isMissingDeviceForeignKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const mysqlError = error as MySqlErrorLike;
    return mysqlError.code === 'ER_NO_REFERENCED_ROW_2' || mysqlError.errno === 1452;
  }

  private async ensureDeviceRowForSession(deviceId: string, connectedAtIso: string): Promise<void> {
    if (!this.mysql) {
      return;
    }

    const metadata = this.metadata.get(deviceId);
    const nowIso = connectedAtIso || new Date().toISOString();
    const createdAt = metadata?.createdAt ?? nowIso;
    const updatedAt = nowIso;
    const uuid = metadata?.uuid ?? randomUUID();
    const name = metadata?.name ?? deviceId;

    if (!metadata) {
      this.metadata.set(deviceId, {
        deviceId,
        uuid,
        name,
        createdAt,
        updatedAt,
      });
    }

    await this.mysql.execute(
      `
        INSERT INTO devices (
          device_id, uuid, name, site, zone, firmware_version, sensor_version, notes, archived_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          archived_at = VALUES(archived_at),
          updated_at = VALUES(updated_at)
      `,
      [
        deviceId,
        uuid,
        metadata?.name ?? name,
        metadata?.site ?? null,
        metadata?.zone ?? null,
        metadata?.firmwareVersion ?? null,
        metadata?.sensorVersion ?? null,
        metadata?.notes ?? null,
        null,
        createdAt,
        updatedAt,
      ],
    );
  }
}
