import type { DeviceDeletionImpact, DeviceRemovalResult, DeviceRepository, DeviceStatusHistoryQuery } from './device.repository.js';
import type { DeviceAxisLabels, DeviceHeartbeat, DeviceMetadata, DeviceSession, DeviceStatusHistoryEntry } from '../../shared/types.js';
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
  axis_label_ax: string | null;
  axis_label_ay: string | null;
  axis_label_az: string | null;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type DeviceSessionRow = {
  device_id: string;
  socket_id: string;
  connected_at: string | Date;
  last_heartbeat_at: string | Date;
};

type OpenDeviceStatusRow = {
  device_id: string;
  socket_id: string | null;
  started_at: string | Date;
  last_heartbeat_at: string | Date | null;
};

type DeviceStatusHistoryRow = {
  device_id: string;
  status: DeviceStatusHistoryStatus;
  socket_id: string | null;
  started_at: string | Date;
  ended_at: string | Date | null;
  last_heartbeat_at: string | Date | null;
  reason: string | null;
};

type DeviceStatusHistoryStatus = 'online' | 'offline';

type InMemoryDeviceRepositoryOptions = {
  staleSessionClosedAt?: string;
};

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  // MySQL DATETIME is stored as UTC but returned as `YYYY-MM-DD HH:mm:ss.SSS`.
  // Parse it as UTC, not as the server's local timezone.
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withTimezone);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function toOptionalIsoTimestamp(value: string | Date | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return toIsoTimestamp(value);
}

function parseOptionalTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestIsoTimestamp(...values: Array<string | Date | null | undefined>): string {
  let latest = 0;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const parsed = Date.parse(toIsoTimestamp(value));
    if (Number.isFinite(parsed)) {
      latest = Math.max(latest, parsed);
    }
  }
  return new Date(latest || Date.now()).toISOString();
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

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function createAxisLabels(row: DeviceMetadataRow): DeviceAxisLabels | undefined {
  const axisLabels: DeviceAxisLabels = {};
  const ax = normalizeOptionalText(row.axis_label_ax);
  const ay = normalizeOptionalText(row.axis_label_ay);
  const az = normalizeOptionalText(row.axis_label_az);

  if (ax) {
    axisLabels.ax = ax;
  }
  if (ay) {
    axisLabels.ay = ay;
  }
  if (az) {
    axisLabels.az = az;
  }

  return Object.keys(axisLabels).length > 0 ? axisLabels : undefined;
}

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly metadata = new Map<string, DeviceMetadata>();
  private readonly sessions = new Map<string, DeviceSession>();
  private readonly mysql: MySqlAccess | null;

  private constructor(
    mysql: MySqlAccess | null = getSharedMySqlAccess(),
    private readonly options: InMemoryDeviceRepositoryOptions = {},
  ) {
    this.mysql = mysql;
  }

  static async create(
    mysql: MySqlAccess | null = getSharedMySqlAccess(),
    options: InMemoryDeviceRepositoryOptions = {},
  ): Promise<InMemoryDeviceRepository> {
    const repository = new InMemoryDeviceRepository(mysql, options);
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

  async clearTelemetryDataBatch(deviceId: string, limit: number): Promise<number> {
    if (!this.metadata.has(deviceId)) {
      return 0;
    }
    if (!this.mysql) {
      return 0;
    }
    const safeLimit = Math.max(1, Math.min(50_000, Math.floor(limit)));
    return await this.mysql.execute(`DELETE FROM device_datas WHERE device_id = ? LIMIT ${safeLimit}`, [deviceId]);
  }

  async clearTelemetryDataBatchUntil(deviceId: string, cutoffAt: string, limit: number): Promise<number> {
    if (!this.metadata.has(deviceId) || !this.mysql) {
      return 0;
    }
    const safeLimit = Math.max(1, Math.min(50_000, Math.floor(limit)));
    return await this.mysql.execute(
      `DELETE FROM device_datas WHERE device_id = ? AND received_at <= ? ORDER BY received_at ASC, id ASC LIMIT ${safeLimit}`,
      [deviceId, cutoffAt],
    );
  }

  async countTelemetryDataUntil(deviceId: string, cutoffAt: string): Promise<number> {
    if (!this.metadata.has(deviceId) || !this.mysql) {
      return 0;
    }
    const rows = await this.mysql.query<CountRow>(
      'SELECT COUNT(*) AS total FROM device_datas WHERE device_id = ? AND received_at <= ?',
      [deviceId, cutoffAt],
    );
    return toCount(rows[0]);
  }

  getMetadata(deviceId: string): DeviceMetadata | null {
    return this.metadata.get(deviceId) || null;
  }

  listMetadata(): DeviceMetadata[] {
    return [...this.metadata.values()];
  }

  upsertSession(session: DeviceSession): void {
    const previous = this.sessions.get(session.deviceId);
    this.sessions.set(session.deviceId, session);
    this.runPersistence(this.persistConnectedSession(session, previous), `persistSession(${session.deviceId})`);
  }

  getSession(deviceId: string): DeviceSession | null {
    return this.sessions.get(deviceId) || null;
  }

  listSessions(): DeviceSession[] {
    return [...this.sessions.values()];
  }

  removeIfSocketMatches(
    deviceId: string,
    socketId: string,
    disconnectedAt: string,
    disconnectReason?: string,
  ): boolean {
    const found = this.sessions.get(deviceId);
    if (!found || found.socketId !== socketId) {
      return false;
    }
    this.sessions.delete(deviceId);
    this.runPersistence(
      this.closeSession(found, disconnectedAt, disconnectReason),
      `closeSession(${deviceId})`,
    );
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

  async listStatusHistory(query: DeviceStatusHistoryQuery): Promise<DeviceStatusHistoryEntry[]> {
    const deviceId = query.deviceId.trim();
    if (!deviceId) {
      return [];
    }

    if (!this.mysql) {
      const session = this.sessions.get(deviceId);
      if (!session) {
        return [];
      }
      return [{
        deviceId,
        status: 'online',
        socketId: session.socketId,
        startedAt: session.connectedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
      }];
    }

    const fromTimestamp = parseOptionalTimestamp(query.from);
    const toTimestamp = parseOptionalTimestamp(query.to);
    const where: string[] = ['device_id = ?'];
    const params: Array<string | number | boolean | null | Date | Buffer> = [deviceId];

    if (fromTimestamp !== null) {
      where.push('COALESCE(ended_at, NOW(3)) >= ?');
      params.push(new Date(fromTimestamp).toISOString());
    }
    if (toTimestamp !== null) {
      where.push('started_at <= ?');
      params.push(new Date(toTimestamp).toISOString());
    }

    const limit = Math.max(1, Math.min(Math.floor(query.limit ?? 2000), 5000));
    const rows = await this.mysql.query<DeviceStatusHistoryRow>(
      `
        SELECT device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason
        FROM device_status_history
        WHERE ${where.join(' AND ')}
        ORDER BY started_at ASC, id ASC
        LIMIT ?
      `,
      [...params, limit],
    );

    return rows
      .map((row): DeviceStatusHistoryEntry | null => {
        const startedAt = toIsoTimestamp(row.started_at);
        const endedAt = toOptionalIsoTimestamp(row.ended_at);
        if (endedAt && Date.parse(endedAt) <= Date.parse(startedAt)) {
          return null;
        }
        return {
          deviceId: row.device_id,
          status: row.status === 'online' ? 'online' : 'offline',
          socketId: row.socket_id ?? undefined,
          startedAt,
          endedAt,
          lastHeartbeatAt: toOptionalIsoTimestamp(row.last_heartbeat_at),
          reason: row.reason ?? undefined,
        };
      })
      .filter((item): item is DeviceStatusHistoryEntry => Boolean(item));
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
          device_id, uuid, name, site, zone, firmware_version,
          axis_label_ax, axis_label_ay, axis_label_az,
          notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          uuid = VALUES(uuid),
          name = VALUES(name),
          site = VALUES(site),
          zone = VALUES(zone),
          firmware_version = VALUES(firmware_version),
          axis_label_ax = VALUES(axis_label_ax),
          axis_label_ay = VALUES(axis_label_ay),
          axis_label_az = VALUES(axis_label_az),
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
        metadata.axisLabels?.ax ?? null,
        metadata.axisLabels?.ay ?? null,
        metadata.axisLabels?.az ?? null,
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

  private async persistConnectedSession(
    session: DeviceSession,
    previous?: DeviceSession,
  ): Promise<void> {
    await this.persistSession(session);
    await this.recordOnlineStatus(session, previous?.lastHeartbeatAt);
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

  private async closeSession(
    session: DeviceSession,
    disconnectedAt: string,
    disconnectReason?: string,
  ): Promise<void> {
    if (!this.mysql) {
      return;
    }

    try {
      await this.recordOfflineStatus(session, disconnectedAt, disconnectReason);
    } finally {
      await this.deleteSession(session.deviceId, session.socketId);
    }
  }

  private async recordOnlineStatus(session: DeviceSession, previousLastHeartbeatAt?: string): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.closeOpenStatus(session.deviceId, session.connectedAt, previousLastHeartbeatAt);
    await this.insertStatusInterval(session.deviceId, 'online', {
      socketId: session.socketId,
      startedAt: session.connectedAt,
      lastHeartbeatAt: session.lastHeartbeatAt,
    });
  }

  private async recordOfflineStatus(
    session: DeviceSession,
    disconnectedAt: string,
    reason?: string,
  ): Promise<void> {
    if (!this.mysql) {
      return;
    }

    const safeDisconnectedAt = latestIsoTimestamp(disconnectedAt, session.connectedAt, session.lastHeartbeatAt);
    const closed = await this.closeOpenStatus(session.deviceId, safeDisconnectedAt, session.lastHeartbeatAt);
    if (closed === 0) {
      await this.insertStatusInterval(session.deviceId, 'online', {
        socketId: session.socketId,
        startedAt: session.connectedAt,
        endedAt: safeDisconnectedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
      });
    }
    await this.insertStatusInterval(session.deviceId, 'offline', {
      socketId: session.socketId,
      startedAt: safeDisconnectedAt,
      lastHeartbeatAt: session.lastHeartbeatAt,
      reason,
    });
  }

  private async closeOpenStatus(
    deviceId: string,
    endedAt: string,
    lastHeartbeatAt?: string,
  ): Promise<number> {
    if (!this.mysql) {
      return 0;
    }

    return await this.mysql.execute(
      `
        UPDATE device_status_history
        SET
          ended_at = ?,
          last_heartbeat_at = COALESCE(?, last_heartbeat_at),
          updated_at = ?
        WHERE device_id = ? AND ended_at IS NULL
      `,
      [endedAt, lastHeartbeatAt ?? null, endedAt, deviceId],
    );
  }

  private async insertStatusInterval(
    deviceId: string,
    status: DeviceStatusHistoryStatus,
    input: {
      socketId?: string | null;
      startedAt: string;
      endedAt?: string | null;
      lastHeartbeatAt?: string | null;
      reason?: string;
    },
  ): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute(
      `
        INSERT IGNORE INTO device_status_history (
          device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        deviceId,
        status,
        input.socketId ?? null,
        input.startedAt,
        input.endedAt ?? null,
        input.lastHeartbeatAt ?? null,
        input.reason ?? null,
        input.startedAt,
        input.endedAt ?? input.startedAt,
      ],
    );
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.mysql) {
      return;
    }

    const metadataRows = await this.mysql.query<DeviceMetadataRow>(
      `
        SELECT
          device_id, uuid, name, site, zone, firmware_version,
          axis_label_ax, axis_label_ay, axis_label_az,
          notes, created_at, updated_at
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
        axisLabels: createAxisLabels(row),
        notes: row.notes ?? undefined,
        createdAt: toIsoTimestamp(row.created_at),
        updatedAt: toIsoTimestamp(row.updated_at),
      });
    }

    const bootTime = new Date().toISOString();
    const staleSessionClosedAt = this.options.staleSessionClosedAt ?? bootTime;
    const sessionRows = await this.mysql.query<DeviceSessionRow>(
      `
        SELECT device_id, socket_id, connected_at, last_heartbeat_at
        FROM socket_datas
      `,
    );
    for (const row of sessionRows) {
      await this.recordOfflineStatus(
        {
          deviceId: row.device_id,
          socketId: row.socket_id,
          connectedAt: toIsoTimestamp(row.connected_at),
          lastHeartbeatAt: toIsoTimestamp(row.last_heartbeat_at),
        },
        staleSessionClosedAt,
        'server_offline',
      );
    }

    const openOnlineRows = await this.mysql.query<OpenDeviceStatusRow>(
      `
        SELECT device_id, socket_id, started_at, last_heartbeat_at
        FROM device_status_history
        WHERE status = 'online' AND ended_at IS NULL
      `,
    );
    for (const row of openOnlineRows) {
      await this.closeOpenStatus(
        row.device_id,
        staleSessionClosedAt,
        row.last_heartbeat_at ? toIsoTimestamp(row.last_heartbeat_at) : undefined,
      );
      await this.insertStatusInterval(row.device_id, 'offline', {
        socketId: row.socket_id,
        startedAt: staleSessionClosedAt,
        lastHeartbeatAt: row.last_heartbeat_at ? toIsoTimestamp(row.last_heartbeat_at) : null,
        reason: 'server_offline',
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
          device_id, uuid, name, site, zone, firmware_version,
          axis_label_ax, axis_label_ay, axis_label_az,
          notes, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        metadata?.axisLabels?.ax ?? null,
        metadata?.axisLabels?.ay ?? null,
        metadata?.axisLabels?.az ?? null,
        metadata?.notes ?? null,
        createdAt,
        updatedAt,
      ],
    );
  }
}
