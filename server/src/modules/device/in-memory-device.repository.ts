import type { DeviceDeletionImpact, DeviceRemovalResult, DeviceRepository } from './device.repository.js';
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
  notes: string | null;
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

type CountRow = {
  total: number | string;
};

type SpectrumSummaryRow = {
  total_frames: number | string;
  total_bytes: number | string | null;
};

type DeviceCountTable = 'devices' | 'device_datas' | 'socket_datas' | 'device_commands' | 'alerts' | 'audit_logs';

function toCount(row: CountRow | undefined): number {
  return Math.max(0, Math.floor(Number(row?.total ?? 0)));
}

function createTotalRows(impact: Omit<DeviceDeletionImpact, 'totalRows'>): number {
  return (
    impact.deviceRows +
    impact.telemetryRows +
    impact.spectrumFrames +
    impact.socketSessions +
    impact.commandRows +
    impact.alertRows +
    impact.auditLogRows
  );
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

  async upsertMetadata(metadata: DeviceMetadata): Promise<void> {
    this.metadata.set(metadata.deviceId, metadata);
    await this.persistMetadata(metadata);
  }

  async inspectRemoval(deviceId: string): Promise<DeviceDeletionImpact | null> {
    const existing = this.metadata.get(deviceId) ?? null;
    if (!existing) {
      return null;
    }

    if (!this.mysql) {
      return this.createInMemoryImpact(deviceId, existing);
    }

    const [deviceRows, telemetryRows, socketSessions, commandRows, alertRows, auditLogRows, spectrumSummary] =
      await Promise.all([
        this.countRows('devices', deviceId),
        this.countRows('device_datas', deviceId),
        this.countRows('socket_datas', deviceId),
        this.countRows('device_commands', deviceId),
        this.countRows('alerts', deviceId),
        this.countRows('audit_logs', deviceId),
        this.countSpectrumRows(deviceId),
      ]);

    const impactWithoutTotal: Omit<DeviceDeletionImpact, 'totalRows'> = {
      deviceId,
      deviceName: existing.name,
      deviceRows,
      telemetryRows,
      spectrumFrames: spectrumSummary.frames,
      spectrumBytes: spectrumSummary.bytes,
      socketSessions,
      commandRows,
      alertRows,
      auditLogRows,
    };

    return {
      ...impactWithoutTotal,
      totalRows: createTotalRows(impactWithoutTotal),
    };
  }

  async removeMetadata(deviceId: string): Promise<DeviceRemovalResult | null> {
    const existing = this.metadata.get(deviceId) ?? null;
    if (!existing) {
      return null;
    }

    let impact = await this.inspectRemoval(deviceId);
    if (!impact) {
      impact = this.createInMemoryImpact(deviceId, existing);
    }

    if (this.mysql) {
      const auditLogRows = await this.mysql.execute('DELETE FROM audit_logs WHERE device_id = ?', [deviceId]);
      const alertRows = await this.mysql.execute('DELETE FROM alerts WHERE device_id = ?', [deviceId]);
      const commandRows = await this.mysql.execute('DELETE FROM device_commands WHERE device_id = ?', [deviceId]);
      const spectrumFrames = await this.mysql.execute('DELETE FROM device_spectrum_frames WHERE device_id = ?', [deviceId]);
      const telemetryRows = await this.mysql.execute('DELETE FROM device_datas WHERE device_id = ?', [deviceId]);
      const socketSessions = await this.mysql.execute('DELETE FROM socket_datas WHERE device_id = ?', [deviceId]);
      const deviceRows = await this.mysql.execute('DELETE FROM devices WHERE device_id = ?', [deviceId]);

      const actualImpactWithoutTotal: Omit<DeviceDeletionImpact, 'totalRows'> = {
        ...impact,
        deviceRows,
        telemetryRows,
        spectrumFrames,
        socketSessions,
        commandRows,
        alertRows,
        auditLogRows,
      };
      impact = {
        ...actualImpactWithoutTotal,
        totalRows: createTotalRows(actualImpactWithoutTotal),
      };
    }

    this.metadata.delete(deviceId);
    this.sessions.delete(deviceId);
    return {
      metadata: existing,
      impact,
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

  private createInMemoryImpact(deviceId: string, metadata: DeviceMetadata): DeviceDeletionImpact {
    const impactWithoutTotal: Omit<DeviceDeletionImpact, 'totalRows'> = {
      deviceId,
      deviceName: metadata.name,
      deviceRows: 1,
      telemetryRows: 0,
      spectrumFrames: 0,
      spectrumBytes: 0,
      socketSessions: this.sessions.has(deviceId) ? 1 : 0,
      commandRows: 0,
      alertRows: 0,
      auditLogRows: 0,
    };

    return {
      ...impactWithoutTotal,
      totalRows: createTotalRows(impactWithoutTotal),
    };
  }

  private async countRows(tableName: DeviceCountTable, deviceId: string): Promise<number> {
    if (!this.mysql) {
      return 0;
    }
    const rows = await this.mysql.query<CountRow>(`SELECT COUNT(*) AS total FROM ${tableName} WHERE device_id = ?`, [
      deviceId,
    ]);
    return toCount(rows[0]);
  }

  private async countSpectrumRows(deviceId: string): Promise<{ frames: number; bytes: number }> {
    if (!this.mysql) {
      return { frames: 0, bytes: 0 };
    }
    const rows = await this.mysql.query<SpectrumSummaryRow>(
      `SELECT COUNT(*) AS total_frames, COALESCE(SUM(file_size_bytes), 0) AS total_bytes
         FROM device_spectrum_frames
        WHERE device_id = ?`,
      [deviceId],
    );
    const row = rows[0];
    return {
      frames: Math.max(0, Math.floor(Number(row?.total_frames ?? 0))),
      bytes: Math.max(0, Math.floor(Number(row?.total_bytes ?? 0))),
    };
  }

  private async persistMetadata(metadata: DeviceMetadata): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute(
      `
        INSERT INTO devices (
          device_id, uuid, name, site, zone, firmware_version, notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          uuid = VALUES(uuid),
          name = VALUES(name),
          site = VALUES(site),
          zone = VALUES(zone),
          firmware_version = VALUES(firmware_version),
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
        SELECT device_id, uuid, name, site, zone, firmware_version, notes, created_at, updated_at
        FROM devices
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
          device_id, uuid, name, site, zone, firmware_version, notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          updated_at = VALUES(updated_at)
      `,
      [
        deviceId,
        uuid,
        metadata?.name ?? name,
        metadata?.site ?? null,
        metadata?.zone ?? null,
        metadata?.firmwareVersion ?? null,
        metadata?.notes ?? null,
        createdAt,
        updatedAt,
      ],
    );
  }
}
