import type { TelemetryMessage, TelemetryPayload } from '../../shared/types.js';
import type {
  DeviceTelemetryAvailabilityDay,
  DeviceTelemetrySummary,
  TelemetryAvailabilityQuery,
  TelemetryHistoryPoint,
  TelemetryHistoryQuery,
  TelemetryHistoryResult,
  TelemetryRepository,
} from './telemetry.repository.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import { getSharedMySqlAccess } from '../persistence/mysql-access.js';

type TelemetryRow = {
  id: number;
  device_id: string;
  received_at: string | Date;
  temperature: number | string | null;
  vibration: number | string | null;
  ax: number | string | null;
  ay: number | string | null;
  az: number | string | null;
  sample_count: number | string | bigint | null;
  telemetry_uuid: string | null;
};

type TelemetryBucketRow = TelemetryRow & {
  bucket_started_ms: number | string | bigint | null;
  bucket_ended_ms: number | string | bigint | null;
};

const DEFAULT_HISTORY_LIMIT = 200;
const MAX_HISTORY_LIMIT = 12_000;

type CountRow = {
  total: number;
};

type TelemetrySummaryRow = {
  total: number;
  latest_at: string | Date | null;
  estimated_bytes: number | null;
};

type TelemetryAvailabilityRow = {
  day_key: string | null;
  total: number;
  first_at: string | Date | null;
  last_at: string | Date | null;
};

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  // MySQL DATETIME string -> UTC ISO
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return normalized.endsWith('Z') ? normalized : `${normalized}Z`;
}

function toFiniteNumber(value: number | string | bigint | null | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'bigint') {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
  }

  if (typeof value === 'string') {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
  }

  return undefined;
}

function normalizeHistoryLimit(limit?: number): number {
  return Math.max(1, Math.min(Math.floor(limit ?? DEFAULT_HISTORY_LIMIT), MAX_HISTORY_LIMIT));
}

function normalizeExplicitHistoryLimit(limit?: number): number | undefined {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }

  return normalizeHistoryLimit(limit);
}

function toPayload(row: TelemetryRow): TelemetryPayload {
  const payload: TelemetryPayload = {};
  const temperature = toFiniteNumber(row.temperature);
  const vibration = toFiniteNumber(row.vibration);
  const ax = toFiniteNumber(row.ax);
  const ay = toFiniteNumber(row.ay);
  const az = toFiniteNumber(row.az);
  const sampleCount = toFiniteNumber(row.sample_count);

  if (temperature !== undefined) payload.temperature = temperature;
  if (vibration !== undefined) payload.vibration = vibration;
  if (ax !== undefined) payload.ax = ax;
  if (ay !== undefined) payload.ay = ay;
  if (az !== undefined) payload.az = az;
  if (sampleCount !== undefined) payload.sample_count = sampleCount;
  if (typeof row.telemetry_uuid === 'string' && row.telemetry_uuid.trim()) {
    payload.telemetry_uuid = row.telemetry_uuid;
    payload.telemetryUuid = row.telemetry_uuid;
  }

  return payload;
}

function normalizeTelemetryUuid(payload: TelemetryPayload): string | null {
  const candidate = payload.telemetry_uuid ?? payload.telemetryUuid;
  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 255);
}

function parseIsoTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toBucketBoundaryIso(value: number | string | bigint | null | undefined): string | undefined {
  const timestampMs = toFiniteNumber(value);
  if (timestampMs === undefined) {
    return undefined;
  }

  return new Date(timestampMs).toISOString();
}

function toHistoryPoint(row: TelemetryRow): TelemetryHistoryPoint {
  return {
    deviceId: row.device_id,
    receivedAt: new Date(toIsoTimestamp(row.received_at)).toISOString(),
    payload: toPayload(row),
  };
}

function toBucketHistoryPoint(row: TelemetryBucketRow): TelemetryHistoryPoint {
  const point = toHistoryPoint(row);
  const sampleCount = toFiniteNumber(row.sample_count);
  const bucketStartedAt = toBucketBoundaryIso(row.bucket_started_ms);
  const bucketEndedAt = toBucketBoundaryIso(row.bucket_ended_ms);

  return {
    ...point,
    bucketStartedAt,
    bucketEndedAt,
    sampleCount,
  };
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
    const limit = normalizeHistoryLimit(query.limit);
    const explicitBucketLimit = normalizeExplicitHistoryLimit(query.limit);
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
      `SELECT COUNT(*) AS total FROM device_datas WHERE ${whereSql}`,
      params,
    );
    const totalMatched = Number(countRows[0]?.total ?? 0);

    if (bucketMs) {
      const bucketUs = bucketMs * 1000;
      const bucketRows = await this.mysql.query<TelemetryBucketRow>(
        `SELECT
           MIN(id) AS id,
           device_id,
           MIN(received_at) AS received_at,
           AVG(temperature) AS temperature,
           AVG(vibration) AS vibration,
           AVG(ax) AS ax,
           AVG(ay) AS ay,
           AVG(az) AS az,
           COUNT(*) AS sample_count,
           NULL AS telemetry_uuid,
           bucket_index * ? AS bucket_started_ms,
           (bucket_index + 1) * ? AS bucket_ended_ms
         FROM (
           SELECT
             id,
             device_id,
             received_at,
             temperature,
             vibration,
             ax,
             ay,
             az,
             FLOOR(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', received_at) / ?) AS bucket_index
           FROM device_datas
           WHERE ${whereSql}
         ) AS bucketed
         GROUP BY device_id, bucket_index
         ORDER BY bucket_index ${explicitBucketLimit ? 'DESC' : 'ASC'}
         ${explicitBucketLimit ? 'LIMIT ?' : ''}`,
        explicitBucketLimit
          ? [bucketMs, bucketMs, bucketUs, ...params, explicitBucketLimit]
          : [bucketMs, bucketMs, bucketUs, ...params],
      );

      const items = bucketRows
        .map((row) => toBucketHistoryPoint(row))
        .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
      const returnedRawSamples = items.reduce((total, item) => total + (item.sampleCount ?? 0), 0);

      return {
        items,
        totalMatched,
        truncated: explicitBucketLimit !== undefined && totalMatched > returnedRawSamples,
        bucketMs,
      };
    }

    const rows = await this.mysql.query<TelemetryRow>(
      `SELECT id, device_id, received_at, temperature, vibration, ax, ay, az,
              sample_count, telemetry_uuid
         FROM device_datas
         WHERE ${whereSql}
         ORDER BY received_at DESC
         LIMIT ?`,
      [...params, limit],
    );

    const items = rows
      .map((row) => toHistoryPoint(row))
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));

    return {
      items,
      totalMatched,
      truncated: totalMatched > items.length,
      bucketMs,
    };
  }

  async listAvailableDays(query: TelemetryAvailabilityQuery): Promise<DeviceTelemetryAvailabilityDay[]> {
    if (!this.mysql) {
      return [];
    }

    const targetDeviceId = query.deviceId.trim();
    if (!targetDeviceId) {
      return [];
    }

    const fromTimestamp = parseIsoTimestamp(query.from);
    const toTimestamp = parseIsoTimestamp(query.to);
    const timezoneOffsetMinutes = Number.isFinite(query.timezoneOffsetMinutes)
      ? Math.max(-840, Math.min(840, Math.floor(Number(query.timezoneOffsetMinutes))))
      : 0;
    const shiftMinutes = -timezoneOffsetMinutes;
    const limitDays = Math.max(1, Math.min(Math.floor(query.limitDays ?? 366), 731));

    const where: string[] = ['device_id = ?'];
    const whereParams: Array<string | number | boolean | null | Date | Buffer> = [targetDeviceId];

    if (fromTimestamp !== null) {
      where.push('received_at >= ?');
      whereParams.push(new Date(fromTimestamp).toISOString());
    }
    if (toTimestamp !== null) {
      where.push('received_at <= ?');
      whereParams.push(new Date(toTimestamp).toISOString());
    }

    const rows = await this.mysql.query<TelemetryAvailabilityRow>(
      `SELECT
         DATE_FORMAT(DATE_ADD(received_at, INTERVAL ? MINUTE), '%Y-%m-%d') AS day_key,
         COUNT(*) AS total,
         MIN(received_at) AS first_at,
         MAX(received_at) AS last_at
       FROM device_datas
       WHERE ${where.join(' AND ')}
       GROUP BY day_key
       ORDER BY day_key DESC
       LIMIT ?`,
      [shiftMinutes, ...whereParams, limitDays],
    );

    const days: DeviceTelemetryAvailabilityDay[] = [];
    for (const row of rows) {
      const date = typeof row.day_key === 'string' ? row.day_key.trim() : '';
      if (!date) {
        continue;
      }
      const firstAtRaw = row.first_at;
      const lastAtRaw = row.last_at;
      const day: DeviceTelemetryAvailabilityDay = {
        date,
        count: Math.max(0, Math.floor(Number(row.total ?? 0))),
      };
      if (typeof firstAtRaw === 'string' || firstAtRaw instanceof Date) {
        day.firstAt = new Date(toIsoTimestamp(firstAtRaw)).toISOString();
      }
      if (typeof lastAtRaw === 'string' || lastAtRaw instanceof Date) {
        day.lastAt = new Date(toIsoTimestamp(lastAtRaw)).toISOString();
      }
      days.push(day);
    }

    return days.sort((left, right) => left.date.localeCompare(right.date));
  }

  async summarizeDevice(deviceId: string): Promise<DeviceTelemetrySummary> {
    const targetDeviceId = deviceId.trim();
    if (!this.mysql || !targetDeviceId) {
      return {
        total: 0,
        estimatedBytes: 0,
      };
    }

    const rows = await this.mysql.query<TelemetrySummaryRow>(
      `SELECT
         COUNT(*) AS total,
         MAX(received_at) AS latest_at,
         COALESCE(
           SUM(
             IFNULL(OCTET_LENGTH(telemetry_uuid), 0) +
             IFNULL(OCTET_LENGTH(CAST(received_at AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(temperature AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(vibration AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(ax AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(ay AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(az AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(sample_count AS CHAR)), 0)
           ),
           0
         ) AS estimated_bytes
       FROM device_datas
      WHERE device_id = ?`,
      [targetDeviceId],
    );
    const row = rows[0];
    const latestAtRaw = row?.latest_at;

    return {
      total: Math.max(0, Math.floor(Number(row?.total ?? 0))),
      latestAt:
        typeof latestAtRaw === 'string' || latestAtRaw instanceof Date
          ? new Date(toIsoTimestamp(latestAtRaw)).toISOString()
          : undefined,
      estimatedBytes: Math.max(0, Math.floor(Number(row?.estimated_bytes ?? 0))),
    };
  }

  async applyRetention(): Promise<{ removed: number; kept: number; cutoffAt: string } | null> {
    if (!this.mysql || !Number.isFinite(this.retentionHours) || this.retentionHours <= 0) {
      return null;
    }

    const cutoffAt = new Date(Date.now() - this.retentionHours * 60 * 60 * 1000).toISOString();

    const totalBeforeRows = await this.mysql.query<CountRow>('SELECT COUNT(*) AS total FROM device_datas');
    const totalBefore = Number(totalBeforeRows[0]?.total ?? 0);

    await this.mysql.execute('DELETE FROM device_datas WHERE received_at < ?', [cutoffAt]);

    const totalAfterRows = await this.mysql.query<CountRow>('SELECT COUNT(*) AS total FROM device_datas');
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
      `SELECT id, device_id, received_at, temperature, vibration, ax, ay, az,
              sample_count, telemetry_uuid
         FROM device_datas
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
    const telemetryUuid = normalizeTelemetryUuid(payload);

    await this.mysql.execute(
      `INSERT INTO device_datas (
         device_id,
         received_at,
         temperature,
         vibration,
         ax,
         ay,
         az,
         sample_count,
         telemetry_uuid
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         received_at = VALUES(received_at),
         temperature = VALUES(temperature),
         vibration = VALUES(vibration),
         ax = VALUES(ax),
         ay = VALUES(ay),
         az = VALUES(az),
         sample_count = VALUES(sample_count)`,
      [
        message.deviceId,
        message.receivedAt,
        typeof payload.temperature === 'number' ? payload.temperature : null,
        typeof payload.vibration === 'number' ? payload.vibration : null,
        typeof payload.ax === 'number' ? payload.ax : null,
        typeof payload.ay === 'number' ? payload.ay : null,
        typeof payload.az === 'number' ? payload.az : null,
        typeof payload.sample_count === 'number' ? payload.sample_count : null,
        telemetryUuid,
      ],
    );
  }
}
