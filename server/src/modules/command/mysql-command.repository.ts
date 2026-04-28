import type { CommandRecord, CommandStatus, CommandType, DeviceCommandAck } from '../../shared/types.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import type { CommandRepository } from './command.repository.js';

type CommandRow = {
  command_id: string;
  device_id: string;
  type: string;
  payload: Record<string, unknown> | string | null;
  sent_at: string | Date;
  status: string;
  timeout_at: string | Date;
  status_updated_at: string | Date;
  acked_at: string | Date | null;
  timeouted_at: string | Date | null;
  ack_status: string | null;
  ack_detail: string | null;
  ack_device_uuid: string | null;
  ack_firmware_version: string | null;
  ack_history: DeviceCommandAck[] | string | null;
};

const COMMAND_TYPES = new Set<CommandType>([
  'capture',
  'calibrate',
  'restart',
  'set_config',
  'ota',
  'ota_from_url',
]);

const COMMAND_STATUSES = new Set<CommandStatus>(['sent', 'acked', 'timeout']);

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return normalized.endsWith('Z') ? normalized : `${normalized}Z`;
}

function toNullableIsoTimestamp(value: string | Date | null): string | undefined {
  return value ? toIsoTimestamp(value) : undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function parseAckHistory(value: unknown): DeviceCommandAck[] | undefined {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    return undefined;
  }

  const history = parsed.filter((item): item is DeviceCommandAck => {
    return Boolean(
      item &&
        typeof item === 'object' &&
        typeof (item as DeviceCommandAck).commandId === 'string' &&
        typeof (item as DeviceCommandAck).deviceId === 'string' &&
        typeof (item as DeviceCommandAck).receivedAt === 'string',
    );
  });

  return history.length > 0 ? history : undefined;
}

function normalizeCommandType(value: string): CommandType {
  return COMMAND_TYPES.has(value as CommandType) ? (value as CommandType) : 'set_config';
}

function normalizeCommandStatus(value: string): CommandStatus {
  return COMMAND_STATUSES.has(value as CommandStatus) ? (value as CommandStatus) : 'sent';
}

function toCommandRecord(row: CommandRow): CommandRecord {
  return {
    commandId: row.command_id,
    deviceId: row.device_id,
    type: normalizeCommandType(row.type),
    payload: parsePayload(row.payload),
    sentAt: toIsoTimestamp(row.sent_at),
    status: normalizeCommandStatus(row.status),
    timeoutAt: toIsoTimestamp(row.timeout_at),
    statusUpdatedAt: toIsoTimestamp(row.status_updated_at),
    ackedAt: toNullableIsoTimestamp(row.acked_at),
    timeoutedAt: toNullableIsoTimestamp(row.timeouted_at),
    ackStatus: row.ack_status ?? undefined,
    ackDetail: row.ack_detail ?? undefined,
    ackDeviceUuid: row.ack_device_uuid ?? undefined,
    ackFirmwareVersion: row.ack_firmware_version ?? undefined,
    ackHistory: parseAckHistory(row.ack_history),
  };
}

export class MySqlCommandRepository implements CommandRepository {
  private readonly records = new Map<string, CommandRecord>();

  private constructor(private readonly mysql: MySqlAccess) {}

  static async create(mysql: MySqlAccess): Promise<MySqlCommandRepository> {
    const repository = new MySqlCommandRepository(mysql);
    await repository.loadFromPersistence();
    return repository;
  }

  async save(record: CommandRecord): Promise<void> {
    await this.persistRecord(record);
    this.records.set(record.commandId, record);
  }

  get(commandId: string): CommandRecord | null {
    return this.records.get(commandId) || null;
  }

  list(limit = 100): CommandRecord[] {
    return [...this.records.values()].slice(-limit).reverse();
  }

  async update(record: CommandRecord): Promise<void> {
    await this.persistRecord(record);
    this.records.set(record.commandId, record);
  }

  async deleteByDeviceId(deviceId: string): Promise<number> {
    const deletedRows = await this.mysql.execute('DELETE FROM device_commands WHERE device_id = ?', [deviceId]);
    for (const [commandId, record] of this.records.entries()) {
      if (record.deviceId === deviceId) {
        this.records.delete(commandId);
      }
    }
    return deletedRows;
  }

  listTimedOutCandidates(nowIso: string): CommandRecord[] {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) {
      return [];
    }
    return [...this.records.values()].filter((record) => {
      if (record.status !== 'sent') {
        return false;
      }
      const timeout = Date.parse(record.timeoutAt);
      return Number.isFinite(timeout) && timeout <= now;
    });
  }

  private async persistRecord(record: CommandRecord): Promise<void> {
    await this.mysql.execute(
      `
        INSERT INTO device_commands (
          command_id, device_id, type, payload, sent_at, status, timeout_at,
          status_updated_at, acked_at, timeouted_at, ack_status, ack_detail,
          ack_device_uuid, ack_firmware_version, ack_history
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          device_id = VALUES(device_id),
          type = VALUES(type),
          payload = VALUES(payload),
          sent_at = VALUES(sent_at),
          status = VALUES(status),
          timeout_at = VALUES(timeout_at),
          status_updated_at = VALUES(status_updated_at),
          acked_at = VALUES(acked_at),
          timeouted_at = VALUES(timeouted_at),
          ack_status = VALUES(ack_status),
          ack_detail = VALUES(ack_detail),
          ack_device_uuid = VALUES(ack_device_uuid),
          ack_firmware_version = VALUES(ack_firmware_version),
          ack_history = VALUES(ack_history)
      `,
      [
        record.commandId,
        record.deviceId,
        record.type,
        JSON.stringify(record.payload ?? {}),
        record.sentAt,
        record.status,
        record.timeoutAt,
        record.statusUpdatedAt,
        record.ackedAt ?? null,
        record.timeoutedAt ?? null,
        record.ackStatus ?? null,
        record.ackDetail ?? null,
        record.ackDeviceUuid ?? null,
        record.ackFirmwareVersion ?? null,
        JSON.stringify(record.ackHistory ?? []),
      ],
    );
  }

  private async loadFromPersistence(): Promise<void> {
    const rows = await this.mysql.query<CommandRow>(
      `
        SELECT command_id, device_id, type, payload, sent_at, status, timeout_at,
               status_updated_at, acked_at, timeouted_at, ack_status, ack_detail,
               ack_device_uuid, ack_firmware_version, ack_history
        FROM device_commands
        ORDER BY sent_at ASC
      `,
    );

    for (const row of rows) {
      const record = toCommandRecord(row);
      this.records.set(record.commandId, record);
    }
  }
}
