import type { AuditRepository } from './audit.repository.js';
import type { AuditQueryFilters, AuditRecord } from './audit.types.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import { getSharedMySqlAccess } from '../persistence/mysql-access.js';

type AuditRecordRow = {
  audit_id: string;
  action: string;
  device_id: string | null;
  command_id: string;
  actor: string;
  created_at: string | Date;
  result: string;
  metadata: Record<string, unknown> | string | null;
};

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseTimestamp(value: string | Date | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeDeviceId(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return 'n/a';
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : 'n/a';
}

function normalizeDeviceIdForPersistence(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.toLowerCase() === 'n/a' ? null : normalized;
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly records = new Map<string, AuditRecord>();
  private readonly mysql: MySqlAccess | null;

  private constructor(mysql: MySqlAccess | null = getSharedMySqlAccess()) {
    this.mysql = mysql;
  }

  static async create(mysql: MySqlAccess | null = getSharedMySqlAccess()): Promise<InMemoryAuditRepository> {
    const repository = new InMemoryAuditRepository(mysql);
    await repository.loadFromPersistence();
    return repository;
  }

  private listAllDescending(): AuditRecord[] {
    return [...this.records.values()].reverse();
  }

  private filterByQuery(filters: AuditQueryFilters = {}): AuditRecord[] {
    const fromTimestamp = parseTimestamp(filters.from);
    const toTimestamp = parseTimestamp(filters.to);

    if (
      (filters.from !== undefined && fromTimestamp === null) ||
      (filters.to !== undefined && toTimestamp === null)
    ) {
      return [];
    }

    return this.listAllDescending().filter((record) => {
      if (filters.actor !== undefined && record.actor !== filters.actor) {
        return false;
      }

      if (filters.action !== undefined && record.action !== filters.action) {
        return false;
      }

      if (filters.commandId !== undefined && record.commandId !== filters.commandId) {
        return false;
      }

      if (filters.deviceId !== undefined && record.deviceId !== filters.deviceId) {
        return false;
      }

      const recordTimestamp = Date.parse(record.createdAt);
      if (Number.isNaN(recordTimestamp)) {
        return false;
      }

      if (fromTimestamp !== null && recordTimestamp < fromTimestamp) {
        return false;
      }

      if (toTimestamp !== null && recordTimestamp > toTimestamp) {
        return false;
      }

      return true;
    });
  }

  save(record: AuditRecord): void {
    this.records.set(record.auditId, record);
    void this.persistRecord(record).catch((error) => {
      // Audit persistence failures should never crash the API process.
      console.error('[audit-repository] persistRecord failed', error);
    });
  }

  get(auditId: string): AuditRecord | null {
    return this.records.get(auditId) || null;
  }

  list(limit = 100): AuditRecord[] {
    return this.listAllDescending().slice(0, limit);
  }

  query(filters: AuditQueryFilters = {}): AuditRecord[] {
    const { limit = 100 } = filters;
    return this.filterByQuery(filters).slice(0, limit);
  }

  listByCommandId(commandId: string, limit = 100): AuditRecord[] {
    return this.query({ commandId, limit });
  }

  listByDeviceId(deviceId: string, limit = 100): AuditRecord[] {
    return this.query({ deviceId, limit });
  }

  listByActor(actor: string, limit = 100): AuditRecord[] {
    return this.query({ actor, limit });
  }

  listByAction(action: string, limit = 100): AuditRecord[] {
    return this.query({ action, limit });
  }

  listByTimeRange(from?: string | Date, to?: string | Date, limit = 100): AuditRecord[] {
    return this.query({ from, to, limit });
  }

  async deleteByDeviceId(deviceId: string): Promise<number> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const matchingAuditIds = [...this.records.values()]
      .filter((record) => record.deviceId === normalizedDeviceId)
      .map((record) => record.auditId);
    const persistedDeleted = this.mysql
      ? await this.mysql.execute('DELETE FROM audit_logs WHERE device_id = ?', [normalizedDeviceId])
      : 0;

    for (const auditId of matchingAuditIds) {
      this.records.delete(auditId);
    }

    return Math.max(matchingAuditIds.length, persistedDeleted);
  }

  private async persistRecord(record: AuditRecord): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute(
      `
        INSERT INTO audit_logs (
          audit_id, action, device_id, command_id, actor, created_at, result, metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          action = VALUES(action),
          device_id = VALUES(device_id),
          command_id = VALUES(command_id),
          actor = VALUES(actor),
          created_at = VALUES(created_at),
          result = VALUES(result),
          metadata = VALUES(metadata)
      `,
      [
        record.auditId,
        record.action,
        normalizeDeviceIdForPersistence(record.deviceId),
        record.commandId,
        record.actor,
        record.createdAt,
        record.result,
        record.metadata ? JSON.stringify(record.metadata) : null,
      ],
    );
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.mysql) {
      return;
    }

    const rows = await this.mysql.query<AuditRecordRow>(
      `
        SELECT audit_id, action, device_id, command_id, actor, created_at, result, metadata
        FROM audit_logs
        ORDER BY created_at ASC
      `,
    );

    for (const row of rows) {
      this.records.set(row.audit_id, {
        auditId: row.audit_id,
        action: row.action,
        deviceId: normalizeDeviceId(row.device_id),
        commandId: row.command_id,
        actor: row.actor,
        createdAt: toIsoTimestamp(row.created_at),
        result: row.result,
        metadata:
          typeof row.metadata === 'string'
            ? (JSON.parse(row.metadata) as Record<string, unknown>)
            : (row.metadata ?? undefined),
      });
    }
  }
}
