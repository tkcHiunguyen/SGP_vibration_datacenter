import type { TelemetryMessage, TelemetryPayload } from '../../shared/types.js';
import type {
  TelemetryHistoryPoint,
  TelemetryHistoryQuery,
  TelemetryHistoryResult,
  TelemetryRepository,
} from './telemetry.repository.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import { getSharedMySqlAccess } from '../persistence/mysql-access.js';

type TelemetryRow = {
  device_id: string;
  received_at: string | Date;
  temperature: number | null;
  vibration: number | null;
  ax: number | null;
  ay: number | null;
  az: number | null;
  sample_count: number | null;
  sample_rate_hz: number | null;
  lsb_per_g: number | null;
  available: number | boolean | null;
  uuid: string | null;
  telemetry_uuid: string | null;
};

type CountRow = {
  total: number;
};

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  // MySQL DATETIME string -> UTC ISO
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return normalized.endsWith('Z') ? normalized : `${normalized}Z`;
}

function toPayload(row: TelemetryRow): TelemetryPayload {
  const payload: TelemetryPayload = {};

  if (typeof row.temperature === 'number') payload.temperature = row.temperature;
  if (typeof row.vibration === 'number') payload.vibration = row.vibration;
  if (typeof row.ax === 'number') payload.ax = row.ax;
  if (typeof row.ay === 'number') payload.ay = row.ay;
  if (typeof row.az === 'number') payload.az = row.az;
  if (typeof row.sample_count === 'number') payload.sample_count = row.sample_count;
  if (typeof row.sample_rate_hz === 'number') payload.sample_rate_hz = row.sample_rate_hz;
  if (typeof row.lsb_per_g === 'number') payload.lsb_per_g = row.lsb_per_g;
  if (typeof row.available === 'boolean') payload.available = row.available;
  if (typeof row.available === 'number') payload.available = row.available === 1;
  if (typeof row.uuid === 'string') payload.uuid = row.uuid;
  if (typeof row.telemetry_uuid === 'string') payload.telemetryUuid = row.telemetry_uuid;

  return payload;
}

function parseIsoTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function bucketMessages(messages: TelemetryMessage[], bucketMs: number): TelemetryHistoryPoint[] {
  const buckets = new Map<number, TelemetryHistoryPoint>();

  for (const message of messages) {
    const timestamp = Date.parse(message.receivedAt);
    if (Number.isNaN(timestamp)) {
      continue;
    }

    const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        ...message,
        bucketStartedAt: new Date(bucketStart).toISOString(),
        bucketEndedAt: new Date(bucketStart + bucketMs).toISOString(),
        sampleCount: 1,
      });
      continue;
    }

    buckets.set(bucketStart, {
      ...message,
      bucketStartedAt: existing.bucketStartedAt,
      bucketEndedAt: existing.bucketEndedAt,
      sampleCount: (existing.sampleCount ?? 1) + 1,
    });
  }

  return [...buckets.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

export class MySqlTelemetryRepository implements TelemetryRepository {
  private lastMessage: TelemetryMessage | null = null;

  constructor(
    private readonly mysql: MySqlAccess | null = getSharedMySqlAccess(),
    private readonly retentionHours = Number(process.env.TELEMETRY_RETENTION_HOURS ?? '168'),
  ) {}

  static async create(mysql: MySqlAccess | null = getSharedMySqlAccess()): Promise<MySqlTelemetryRepository> {
    const repository = new MySqlTelemetryRepository(mysql);
    await repository.loadLast();
    return repository;
  }

  setLast(message: TelemetryMessage): void {
    this.lastMessage = message;
    void this.persist(message);
  }

  getLast(): TelemetryMessage | null {
    return this.lastMessage;
  }

  async listHistory(query: TelemetryHistoryQuery): Promise<TelemetryHistoryResult> {
    if (!this.mysql) {
      return { items: [], totalMatched: 0, truncated: false, bucketMs: query.bucketMs };
    }

    const fromTimestamp = parseIsoTimestamp(query.from);
    const toTimestamp = parseIsoTimestamp(query.to);
    const limit = Math.max(1, Math.min(query.limit ?? 200, 2000));
    const bucketMs = query.bucketMs && query.bucketMs > 0 ? Math.floor(query.bucketMs) : undefined;

    const where: string[] = ['device_id = ?'];
    const params: Array<string | number | boolean | null | Date | Buffer> = [query.deviceId];

    if (fromTimestamp !== null) {
      where.push('received_at >= ?');
      params.push(new Date(fromTimestamp).toISOString());
    }

    if (toTimestamp !== null) {
      where.push('received_at <= ?');
      params.push(new Date(toTimestamp).toISOString());
    }

    const whereSql = where.join(' AND ');

    const countRows = await this.mysql.query<CountRow>(
      `SELECT COUNT(*) AS total FROM telemetry_messages WHERE ${whereSql}`,
      params,
    );
    const totalMatched = Number(countRows[0]?.total ?? 0);

    const rows = bucketMs
      ? await this.mysql.query<TelemetryRow>(
          `SELECT device_id, received_at, temperature, vibration, ax, ay, az,
                  sample_count, sample_rate_hz, lsb_per_g, available, uuid, telemetry_uuid
             FROM telemetry_messages
             WHERE ${whereSql}
             ORDER BY received_at ASC`,
          params,
        )
      : await this.mysql.query<TelemetryRow>(
          `SELECT device_id, received_at, temperature, vibration, ax, ay, az,
                  sample_count, sample_rate_hz, lsb_per_g, available, uuid, telemetry_uuid
             FROM telemetry_messages
             WHERE ${whereSql}
             ORDER BY received_at DESC
             LIMIT ?`,
          [...params, limit],
        );

    const messages: TelemetryMessage[] = rows
      .map((row) => ({
        deviceId: row.device_id,
        receivedAt: new Date(toIsoTimestamp(row.received_at)).toISOString(),
        payload: toPayload(row),
      }))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

    const points = bucketMs ? bucketMessages(messages, bucketMs) : messages;
    const sliced = points.slice(-limit);

    return {
      items: sliced,
      totalMatched,
      truncated: points.length > sliced.length,
      bucketMs,
    };
  }

  async applyRetention(): Promise<{ removed: number; kept: number; cutoffAt: string } | null> {
    if (!this.mysql || !Number.isFinite(this.retentionHours) || this.retentionHours <= 0) {
      return null;
    }

    const cutoffAt = new Date(Date.now() - this.retentionHours * 60 * 60 * 1000).toISOString();

    const totalBeforeRows = await this.mysql.query<CountRow>('SELECT COUNT(*) AS total FROM telemetry_messages');
    const totalBefore = Number(totalBeforeRows[0]?.total ?? 0);

    await this.mysql.execute('DELETE FROM telemetry_messages WHERE received_at < ?', [cutoffAt]);

    const totalAfterRows = await this.mysql.query<CountRow>('SELECT COUNT(*) AS total FROM telemetry_messages');
    const kept = Number(totalAfterRows[0]?.total ?? 0);

    return {
      removed: Math.max(0, totalBefore - kept),
      kept,
      cutoffAt,
    };
  }

  private async loadLast(): Promise<void> {
    if (!this.mysql) {
      this.lastMessage = null;
      return;
    }

    const rows = await this.mysql.query<TelemetryRow>(
      `SELECT device_id, received_at, temperature, vibration, ax, ay, az,
              sample_count, sample_rate_hz, lsb_per_g, available, uuid, telemetry_uuid
         FROM telemetry_messages
         ORDER BY received_at DESC
         LIMIT 1`,
    );

    const row = rows[0];
    if (!row) {
      this.lastMessage = null;
      return;
    }

    this.lastMessage = {
      deviceId: row.device_id,
      receivedAt: new Date(toIsoTimestamp(row.received_at)).toISOString(),
      payload: toPayload(row),
    };
  }

  private async persist(message: TelemetryMessage): Promise<void> {
    if (!this.mysql) {
      return;
    }

    const payload = message.payload;

    await this.mysql.execute(
      `INSERT INTO telemetry_messages (
         device_id,
         received_at,
         temperature,
         vibration,
         ax,
         ay,
         az,
         sample_count,
         sample_rate_hz,
         lsb_per_g,
         available,
         uuid,
         telemetry_uuid
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.deviceId,
        message.receivedAt,
        typeof payload.temperature === 'number' ? payload.temperature : null,
        typeof payload.vibration === 'number' ? payload.vibration : null,
        typeof payload.ax === 'number' ? payload.ax : null,
        typeof payload.ay === 'number' ? payload.ay : null,
        typeof payload.az === 'number' ? payload.az : null,
        typeof payload.sample_count === 'number' ? payload.sample_count : null,
        typeof payload.sample_rate_hz === 'number' ? payload.sample_rate_hz : null,
        typeof payload.lsb_per_g === 'number' ? payload.lsb_per_g : null,
        typeof payload.available === 'boolean' ? payload.available : null,
        typeof payload.uuid === 'string' ? payload.uuid : null,
        typeof payload.telemetryUuid === 'string'
          ? payload.telemetryUuid
          : typeof payload.telemetry_uuid === 'string'
            ? payload.telemetry_uuid
            : null,
      ],
    );
  }
}
