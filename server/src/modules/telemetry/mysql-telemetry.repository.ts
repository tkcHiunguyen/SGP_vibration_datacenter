import type { TelemetryMessage, TelemetryPayload } from '../../shared/types.js';
import type {
  DeviceTelemetryAvailabilityDay,
  DeviceTelemetrySummary,
  TelemetryArchiveQuery,
  TelemetryAvailabilityQuery,
  TelemetryHistoryPoint,
  TelemetryHistoryQuery,
  TelemetryHistoryResult,
  TelemetryImportPoint,
  TelemetryImportResult,
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
  vrms_x_mms: number | string | null;
  vrms_y_mms: number | string | null;
  vrms_z_mms: number | string | null;
  vrms_unit: string | null;
  drms_x_um: number | string | null;
  drms_y_um: number | string | null;
  drms_z_um: number | string | null;
  drms_band_min_hz: number | string | null;
  drms_band_max_hz: number | string | null;
  drms_unit: string | null;
  sample_count: number | string | bigint | null;
  telemetry_uuid: string | null;
  message_id: string | null;
  temperature_available: number | boolean | null;
  vibration_available: number | boolean | null;
  adxl_status: 'ok' | 'fault' | 'recovering' | null;
  adxl_fault_reason: 'not_detected' | 'i2c_read_error' | 'capture_timeout' | 'unknown' | null;
};

type TelemetryBucketRow = TelemetryRow & {
  bucket_started_ms: number | string | bigint | null;
  bucket_ended_ms: number | string | bigint | null;
};

const DEFAULT_HISTORY_LIMIT = 200;
const MAX_HISTORY_LIMIT = 12_000;
const HOUR_MS = 60 * 60 * 1000;

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

function isHourlyAvailabilityRange(
  fromTimestamp: number | null,
  toTimestamp: number | null,
  shiftMinutes: number,
): boolean {
  if (shiftMinutes % 60 !== 0) {
    return false;
  }
  const shiftMs = shiftMinutes * 60 * 1000;
  if (fromTimestamp !== null && (fromTimestamp + shiftMs) % HOUR_MS !== 0) {
    return false;
  }
  return toTimestamp === null || (toTimestamp + shiftMs + 1) % HOUR_MS === 0;
}

function toHourStartedAt(timestamp: number): string {
  return new Date(Math.floor(timestamp / HOUR_MS) * HOUR_MS).toISOString();
}

function isMissingHourlySummaryTable(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ER_NO_SUCH_TABLE',
  );
}

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

function toOptionalBoolean(value: number | boolean | null | undefined): boolean | undefined {
  if (value === true || value === 1) {
    return true;
  }
  if (value === false || value === 0) {
    return false;
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
  const vrmsX = toFiniteNumber(row.vrms_x_mms);
  const vrmsY = toFiniteNumber(row.vrms_y_mms);
  const vrmsZ = toFiniteNumber(row.vrms_z_mms);
  const drmsX = toFiniteNumber(row.drms_x_um);
  const drmsY = toFiniteNumber(row.drms_y_um);
  const drmsZ = toFiniteNumber(row.drms_z_um);
  const drmsBandMin = toFiniteNumber(row.drms_band_min_hz);
  const drmsBandMax = toFiniteNumber(row.drms_band_max_hz);
  const sampleCount = toFiniteNumber(row.sample_count);
  const temperatureAvailable = toOptionalBoolean(row.temperature_available);
  const vibrationAvailable = toOptionalBoolean(row.vibration_available);

  if (temperature !== undefined) payload.temperature = temperature;
  if (vibration !== undefined) payload.vibration = vibration;
  if (ax !== undefined) payload.ax = ax;
  if (ay !== undefined) payload.ay = ay;
  if (az !== undefined) payload.az = az;
  if (vrmsX !== undefined) { payload.vrms_x_mms = vrmsX; payload.vx_rms_mms = vrmsX; }
  if (vrmsY !== undefined) { payload.vrms_y_mms = vrmsY; payload.vy_rms_mms = vrmsY; }
  if (vrmsZ !== undefined) { payload.vrms_z_mms = vrmsZ; payload.vz_rms_mms = vrmsZ; }
  if (typeof row.vrms_unit === 'string' && row.vrms_unit.trim()) payload.vrms_unit = row.vrms_unit;
  if (drmsX !== undefined) payload.drms_x_um = drmsX;
  if (drmsY !== undefined) payload.drms_y_um = drmsY;
  if (drmsZ !== undefined) payload.drms_z_um = drmsZ;
  if (drmsBandMin !== undefined) payload.drms_band_min_hz = drmsBandMin;
  if (drmsBandMax !== undefined) payload.drms_band_max_hz = drmsBandMax;
  if (typeof row.drms_unit === 'string' && row.drms_unit.trim()) payload.drms_unit = row.drms_unit;
  if (sampleCount !== undefined) payload.sample_count = sampleCount;
  if (typeof row.message_id === 'string' && row.message_id.trim()) payload.messageId = row.message_id;
  if (temperatureAvailable !== undefined) payload.temperatureAvailable = temperatureAvailable;
  if (vibrationAvailable !== undefined) payload.vibrationAvailable = vibrationAvailable;
  if (row.adxl_status) payload.adxlStatus = row.adxl_status;
  if (row.adxl_status === 'fault' && row.adxl_fault_reason) payload.adxlFaultReason = row.adxl_fault_reason;
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

function normalizeMessageId(payload: TelemetryPayload): string | null {
  if (typeof payload.messageId !== 'string') {
    return null;
  }
  const normalized = payload.messageId.trim();
  return normalized ? normalized.slice(0, 255) : null;
}

type TelemetryMetricValues = {
  temperature: number | null;
  vibration: number | null;
  ax: number | null;
  ay: number | null;
  az: number | null;
  vrmsX: number | null;
  vrmsY: number | null;
  vrmsZ: number | null;
  vrmsUnit: string | null;
  drmsX: number | null;
  drmsY: number | null;
  drmsZ: number | null;
  drmsBandMin: number | null;
  drmsBandMax: number | null;
  drmsUnit: string | null;
};

function numberMetric(value: unknown, enabled: boolean): number | null {
  return enabled && typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textMetric(value: unknown, enabled: boolean): string | null {
  return enabled && typeof value === 'string' ? value : null;
}

function createTelemetryMetricValues(payload: TelemetryPayload): TelemetryMetricValues {
  const hasTemperature = payload.temperatureAvailable !== false;
  const hasVibration = payload.vibrationAvailable !== false;
  return {
    temperature: numberMetric(payload.temperature, hasTemperature),
    vibration: numberMetric(payload.vibration, hasVibration),
    ax: numberMetric(payload.ax, hasVibration),
    ay: numberMetric(payload.ay, hasVibration),
    az: numberMetric(payload.az, hasVibration),
    vrmsX: numberMetric(payload.vrms_x_mms ?? payload.vx_rms_mms, hasVibration),
    vrmsY: numberMetric(payload.vrms_y_mms ?? payload.vy_rms_mms, hasVibration),
    vrmsZ: numberMetric(payload.vrms_z_mms ?? payload.vz_rms_mms, hasVibration),
    vrmsUnit: textMetric(payload.vrms_unit, hasVibration),
    drmsX: numberMetric(payload.drms_x_um, hasVibration),
    drmsY: numberMetric(payload.drms_y_um, hasVibration),
    drmsZ: numberMetric(payload.drms_z_um, hasVibration),
    drmsBandMin: numberMetric(payload.drms_band_min_hz, hasVibration),
    drmsBandMax: numberMetric(payload.drms_band_max_hz, hasVibration),
    drmsUnit: textMetric(payload.drms_unit, hasVibration),
  };
}

function createArchiveTelemetryUuid(row: TelemetryRow): string | undefined {
  if (toOptionalBoolean(row.vibration_available) === false) {
    return undefined;
  }
  if (row.telemetry_uuid && row.telemetry_uuid.trim()) {
    return row.telemetry_uuid.trim().slice(0, 255);
  }

  return `sgp-time:${row.device_id}:${toIsoTimestamp(row.received_at)}`.slice(0, 255);
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
  const vrmsX = toFiniteNumber(row.vrms_x_mms);
  const vrmsY = toFiniteNumber(row.vrms_y_mms);
  const vrmsZ = toFiniteNumber(row.vrms_z_mms);
  const drmsX = toFiniteNumber(row.drms_x_um);
  const drmsY = toFiniteNumber(row.drms_y_um);
  const drmsZ = toFiniteNumber(row.drms_z_um);
  const drmsBandMin = toFiniteNumber(row.drms_band_min_hz);
  const drmsBandMax = toFiniteNumber(row.drms_band_max_hz);
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

    if (bucketMs && bucketMs >= HOUR_MS) {
      try {
        return await this.listHourlyMetricHistory(query.deviceId, fromTimestamp, toTimestamp, bucketMs, explicitBucketLimit);
      } catch (error) {
        if (!isMissingHourlySummaryTable(error)) {
          throw error;
        }
      }
    }

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
           AVG(vrms_x_mms) AS vrms_x_mms,
           AVG(vrms_y_mms) AS vrms_y_mms,
           AVG(vrms_z_mms) AS vrms_z_mms,
           MAX(vrms_unit) AS vrms_unit,
           AVG(drms_x_um) AS drms_x_um,
           AVG(drms_y_um) AS drms_y_um,
           AVG(drms_z_um) AS drms_z_um,
           AVG(drms_band_min_hz) AS drms_band_min_hz,
           AVG(drms_band_max_hz) AS drms_band_max_hz,
           MAX(drms_unit) AS drms_unit,
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
             vrms_x_mms,
             vrms_y_mms,
             vrms_z_mms,
             vrms_unit,
             drms_x_um,
             drms_y_um,
             drms_z_um,
             drms_band_min_hz,
             drms_band_max_hz,
             drms_unit,
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
              vrms_x_mms, vrms_y_mms, vrms_z_mms, vrms_unit,
              drms_x_um, drms_y_um, drms_z_um, drms_band_min_hz, drms_band_max_hz, drms_unit,
              sample_count, telemetry_uuid, message_id,
              temperature_available, vibration_available, adxl_status, adxl_fault_reason
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

  private async listHourlyMetricHistory(
    deviceId: string,
    fromTimestamp: number | null,
    toTimestamp: number | null,
    bucketMs: number,
    explicitBucketLimit: number | undefined,
  ): Promise<TelemetryHistoryResult> {
    const where: string[] = ['device_id = ?'];
    const params: Array<string | number | boolean | null | Date | Buffer> = [deviceId];
    if (fromTimestamp !== null) {
      where.push('hour_started_at >= ?');
      params.push(toHourStartedAt(fromTimestamp));
    }
    if (toTimestamp !== null) {
      where.push('hour_started_at <= ?');
      params.push(toHourStartedAt(toTimestamp));
    }

    const bucketUs = bucketMs * 1000;
    const bucketRows = await this.mysql!.query<TelemetryBucketRow>(
      `SELECT
         0 AS id,
         device_id,
         MIN(first_received_at) AS received_at,
         SUM(temperature * temperature_sample_count) / NULLIF(SUM(temperature_sample_count), 0) AS temperature,
         SUM(vibration * vibration_sample_count) / NULLIF(SUM(vibration_sample_count), 0) AS vibration,
         SUM(ax * ax_sample_count) / NULLIF(SUM(ax_sample_count), 0) AS ax,
         SUM(ay * ay_sample_count) / NULLIF(SUM(ay_sample_count), 0) AS ay,
         SUM(az * az_sample_count) / NULLIF(SUM(az_sample_count), 0) AS az,
         SUM(vrms_x_mms * vrms_x_sample_count) / NULLIF(SUM(vrms_x_sample_count), 0) AS vrms_x_mms,
         SUM(vrms_y_mms * vrms_y_sample_count) / NULLIF(SUM(vrms_y_sample_count), 0) AS vrms_y_mms,
         SUM(vrms_z_mms * vrms_z_sample_count) / NULLIF(SUM(vrms_z_sample_count), 0) AS vrms_z_mms,
         MAX(vrms_unit) AS vrms_unit,
         SUM(drms_x_um * drms_x_sample_count) / NULLIF(SUM(drms_x_sample_count), 0) AS drms_x_um,
         SUM(drms_y_um * drms_y_sample_count) / NULLIF(SUM(drms_y_sample_count), 0) AS drms_y_um,
         SUM(drms_z_um * drms_z_sample_count) / NULLIF(SUM(drms_z_sample_count), 0) AS drms_z_um,
         SUM(drms_band_min_hz * drms_band_min_sample_count) / NULLIF(SUM(drms_band_min_sample_count), 0) AS drms_band_min_hz,
         SUM(drms_band_max_hz * drms_band_max_sample_count) / NULLIF(SUM(drms_band_max_sample_count), 0) AS drms_band_max_hz,
         MAX(drms_unit) AS drms_unit,
         SUM(sample_count) AS sample_count,
         NULL AS telemetry_uuid,
         bucket_index * ? AS bucket_started_ms,
         (bucket_index + 1) * ? AS bucket_ended_ms
       FROM (
         SELECT
           device_id,
           hour_started_at,
           sample_count,
           first_received_at,
           temperature,
           vibration,
           ax,
           ay,
           az,
           vrms_x_mms,
           vrms_y_mms,
           vrms_z_mms,
           vrms_unit,
           drms_x_um,
           drms_y_um,
           drms_z_um,
            drms_band_min_hz,
            drms_band_max_hz,
            drms_unit,
            temperature_sample_count,
            vibration_sample_count,
            ax_sample_count,
            ay_sample_count,
            az_sample_count,
            vrms_x_sample_count,
            vrms_y_sample_count,
            vrms_z_sample_count,
            drms_x_sample_count,
            drms_y_sample_count,
            drms_z_sample_count,
            drms_band_min_sample_count,
            drms_band_max_sample_count,
           FLOOR(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', hour_started_at) / ?) AS bucket_index
         FROM device_telemetry_hour_metric_summaries
         WHERE ${where.join(' AND ')}
       ) AS hourly
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
    const totalMatched = items.reduce((total, item) => total + (item.sampleCount ?? 0), 0);
    return {
      items,
      totalMatched,
      truncated: explicitBucketLimit !== undefined && bucketRows.length >= explicitBucketLimit,
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

    const loadRawAvailability = async (): Promise<TelemetryAvailabilityRow[]> => await this.mysql!.query<TelemetryAvailabilityRow>(
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

    let rows: TelemetryAvailabilityRow[];
    if (isHourlyAvailabilityRange(fromTimestamp, toTimestamp, shiftMinutes)) {
      const summaryWhere: string[] = ['device_id = ?'];
      const summaryParams: Array<string | number | boolean | null | Date | Buffer> = [targetDeviceId];
      if (fromTimestamp !== null) {
        summaryWhere.push('hour_started_at >= ?');
        summaryParams.push(toHourStartedAt(fromTimestamp));
      }
      if (toTimestamp !== null) {
        summaryWhere.push('hour_started_at <= ?');
        summaryParams.push(toHourStartedAt(toTimestamp));
      }
      try {
        rows = await this.mysql.query<TelemetryAvailabilityRow>(
          `SELECT
             DATE_FORMAT(DATE_ADD(hour_started_at, INTERVAL ? MINUTE), '%Y-%m-%d') AS day_key,
             SUM(sample_count) AS total,
             MIN(first_received_at) AS first_at,
             MAX(last_received_at) AS last_at
           FROM device_telemetry_hour_summaries
           WHERE ${summaryWhere.join(' AND ')}
           GROUP BY day_key
           ORDER BY day_key DESC
           LIMIT ?`,
          [shiftMinutes, ...summaryParams, limitDays],
        );
      } catch (error) {
        if (!isMissingHourlySummaryTable(error)) {
          throw error;
        }
        rows = await loadRawAvailability();
      }
    } else {
      rows = await loadRawAvailability();
    }

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
             IFNULL(OCTET_LENGTH(CAST(vrms_x_mms AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(vrms_y_mms AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(vrms_z_mms AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(vrms_unit), 0) +
             IFNULL(OCTET_LENGTH(CAST(drms_x_um AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(drms_y_um AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(drms_z_um AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(drms_band_min_hz AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(CAST(drms_band_max_hz AS CHAR)), 0) +
             IFNULL(OCTET_LENGTH(drms_unit), 0) +
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

  async exportHistory(query: TelemetryArchiveQuery): Promise<TelemetryImportPoint[]> {
    if (!this.mysql) {
      return [];
    }

    const fromTimestamp = parseIsoTimestamp(query.from);
    const toTimestamp = parseIsoTimestamp(query.to);
    if (fromTimestamp === null || toTimestamp === null) {
      return [];
    }

    const where: string[] = ['received_at >= ?', 'received_at <= ?'];
    const params: Array<string | number | boolean | null | Date | Buffer> = [
      new Date(fromTimestamp).toISOString(),
      new Date(toTimestamp).toISOString(),
    ];

    const targetDeviceId = query.deviceId?.trim();
    if (targetDeviceId) {
      where.push('device_id = ?');
      params.push(targetDeviceId);
    }

    const rows = await this.mysql.query<TelemetryRow>(
      `SELECT id, device_id, received_at, temperature, vibration, ax, ay, az,
              vrms_x_mms, vrms_y_mms, vrms_z_mms, vrms_unit,
              drms_x_um, drms_y_um, drms_z_um, drms_band_min_hz, drms_band_max_hz, drms_unit,
              sample_count, telemetry_uuid, message_id,
              temperature_available, vibration_available, adxl_status, adxl_fault_reason
         FROM device_datas
        WHERE ${where.join(' AND ')}
        ORDER BY device_id ASC, received_at ASC, id ASC`,
      params,
    );

    return rows.map((row) => {
      const telemetryUuid = createArchiveTelemetryUuid(row);
      const payload: TelemetryPayload = { ...toPayload(row) };
      if (telemetryUuid) {
        payload.telemetry_uuid = telemetryUuid;
        payload.telemetryUuid = telemetryUuid;
      }
      return {
        deviceId: row.device_id,
        receivedAt: new Date(toIsoTimestamp(row.received_at)).toISOString(),
        payload,
        telemetryUuid,
        sampleCount: toFiniteNumber(row.sample_count),
      };
    });
  }

  async importHistory(points: TelemetryImportPoint[]): Promise<TelemetryImportResult> {
    const result: TelemetryImportResult = { inserted: 0, updated: 0, skipped: 0 };
    if (!this.mysql) {
      result.skipped = points.length;
      return result;
    }

    for (const point of points) {
      const payload = point.payload ?? {};
      const metrics = createTelemetryMetricValues(payload);
      const telemetryUuid = payload.vibrationAvailable === false
        ? null
        : point.telemetryUuid ?? normalizeTelemetryUuid(payload);
      const affectedRows = await this.mysql.execute(
        `INSERT INTO device_datas (
           device_id,
           received_at,
           temperature,
           vibration,
           ax,
           ay,
           az,
           vrms_x_mms,
           vrms_y_mms,
           vrms_z_mms,
           vrms_unit,
           drms_x_um,
           drms_y_um,
           drms_z_um,
           drms_band_min_hz,
           drms_band_max_hz,
            drms_unit,
            sample_count,
            telemetry_uuid,
            message_id,
            temperature_available,
            vibration_available,
            adxl_status,
            adxl_fault_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           temperature = VALUES(temperature),
           vibration = VALUES(vibration),
           ax = VALUES(ax),
           ay = VALUES(ay),
           az = VALUES(az),
           vrms_x_mms = VALUES(vrms_x_mms),
           vrms_y_mms = VALUES(vrms_y_mms),
           vrms_z_mms = VALUES(vrms_z_mms),
           vrms_unit = VALUES(vrms_unit),
           drms_x_um = VALUES(drms_x_um),
           drms_y_um = VALUES(drms_y_um),
           drms_z_um = VALUES(drms_z_um),
           drms_band_min_hz = VALUES(drms_band_min_hz),
            drms_band_max_hz = VALUES(drms_band_max_hz),
            drms_unit = VALUES(drms_unit),
            sample_count = VALUES(sample_count),
            telemetry_uuid = VALUES(telemetry_uuid),
            message_id = VALUES(message_id),
            temperature_available = VALUES(temperature_available),
            vibration_available = VALUES(vibration_available),
            adxl_status = VALUES(adxl_status),
            adxl_fault_reason = VALUES(adxl_fault_reason)`,
        [
          point.deviceId,
          point.receivedAt,
          metrics.temperature,
          metrics.vibration,
          metrics.ax,
          metrics.ay,
          metrics.az,
          metrics.vrmsX,
          metrics.vrmsY,
          metrics.vrmsZ,
          metrics.vrmsUnit,
          metrics.drmsX,
          metrics.drmsY,
          metrics.drmsZ,
          metrics.drmsBandMin,
          metrics.drmsBandMax,
          metrics.drmsUnit,
          typeof point.sampleCount === 'number'
            ? point.sampleCount
            : typeof payload.sample_count === 'number'
              ? payload.sample_count
              : null,
          telemetryUuid,
          normalizeMessageId(payload),
          typeof payload.temperatureAvailable === 'boolean' ? Number(payload.temperatureAvailable) : null,
          typeof payload.vibrationAvailable === 'boolean' ? Number(payload.vibrationAvailable) : null,
          payload.adxlStatus ?? null,
          payload.adxlStatus === 'fault' ? payload.adxlFaultReason ?? null : null,
        ],
      );
      if (affectedRows === 1) {
        result.inserted += 1;
        await this.upsertHourlyAvailability(point.deviceId, point.receivedAt);
      } else if (affectedRows > 1) {
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
    }

    return result;
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
              vrms_x_mms, vrms_y_mms, vrms_z_mms, vrms_unit,
              drms_x_um, drms_y_um, drms_z_um, drms_band_min_hz, drms_band_max_hz, drms_unit,
              sample_count, telemetry_uuid, message_id,
              temperature_available, vibration_available, adxl_status, adxl_fault_reason
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
    const metrics = createTelemetryMetricValues(payload);
    const telemetryUuid = payload.vibrationAvailable === false ? null : normalizeTelemetryUuid(payload);

    const affectedRows = await this.mysql.execute(
      `INSERT INTO device_datas (
         device_id,
         received_at,
         temperature,
         vibration,
         ax,
         ay,
         az,
         vrms_x_mms,
         vrms_y_mms,
         vrms_z_mms,
         vrms_unit,
         drms_x_um,
         drms_y_um,
         drms_z_um,
         drms_band_min_hz,
         drms_band_max_hz,
         drms_unit,
         sample_count,
         telemetry_uuid,
         message_id,
         temperature_available,
         vibration_available,
         adxl_status,
         adxl_fault_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         received_at = VALUES(received_at),
         temperature = VALUES(temperature),
         vibration = VALUES(vibration),
         ax = VALUES(ax),
         ay = VALUES(ay),
         az = VALUES(az),
         vrms_x_mms = VALUES(vrms_x_mms),
         vrms_y_mms = VALUES(vrms_y_mms),
         vrms_z_mms = VALUES(vrms_z_mms),
         vrms_unit = VALUES(vrms_unit),
         drms_x_um = VALUES(drms_x_um),
         drms_y_um = VALUES(drms_y_um),
         drms_z_um = VALUES(drms_z_um),
         drms_band_min_hz = VALUES(drms_band_min_hz),
         drms_band_max_hz = VALUES(drms_band_max_hz),
         drms_unit = VALUES(drms_unit),
         sample_count = VALUES(sample_count),
         telemetry_uuid = VALUES(telemetry_uuid),
         message_id = VALUES(message_id),
         temperature_available = VALUES(temperature_available),
         vibration_available = VALUES(vibration_available),
         adxl_status = VALUES(adxl_status),
         adxl_fault_reason = VALUES(adxl_fault_reason)`,
      [
        message.deviceId,
        message.receivedAt,
        metrics.temperature,
        metrics.vibration,
        metrics.ax,
        metrics.ay,
        metrics.az,
        metrics.vrmsX,
        metrics.vrmsY,
        metrics.vrmsZ,
        metrics.vrmsUnit,
        metrics.drmsX,
        metrics.drmsY,
        metrics.drmsZ,
        metrics.drmsBandMin,
        metrics.drmsBandMax,
        metrics.drmsUnit,
        typeof payload.sample_count === 'number' ? payload.sample_count : null,
        telemetryUuid,
        normalizeMessageId(payload),
        typeof payload.temperatureAvailable === 'boolean' ? Number(payload.temperatureAvailable) : null,
        typeof payload.vibrationAvailable === 'boolean' ? Number(payload.vibrationAvailable) : null,
        payload.adxlStatus ?? null,
        payload.adxlStatus === 'fault' ? payload.adxlFaultReason ?? null : null,
      ],
    );
    if (affectedRows === 1) {
      await this.upsertHourlyAvailability(message.deviceId, message.receivedAt);
      try {
        await this.upsertHourlyMetricSummary(message.deviceId, message.receivedAt, payload);
      } catch (error) {
        if (!isMissingHourlySummaryTable(error)) {
          throw error;
        }
      }
    }
  }

  private async upsertHourlyAvailability(deviceId: string, receivedAt: string): Promise<void> {
    if (!this.mysql) {
      return;
    }
    const timestamp = Date.parse(receivedAt);
    if (!Number.isFinite(timestamp)) {
      return;
    }
    const hourStartedAt = toHourStartedAt(timestamp);
    await this.mysql.execute(
      `INSERT INTO device_telemetry_hour_summaries (
         device_id, hour_started_at, sample_count, first_received_at, last_received_at
       ) VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         sample_count = sample_count + 1,
         first_received_at = LEAST(first_received_at, VALUES(first_received_at)),
         last_received_at = GREATEST(last_received_at, VALUES(last_received_at))`,
      [deviceId, hourStartedAt, receivedAt, receivedAt],
    );
  }

  private async upsertHourlyMetricSummary(deviceId: string, receivedAt: string, payload: TelemetryPayload): Promise<void> {
    if (!this.mysql) {
      return;
    }
    const timestamp = Date.parse(receivedAt);
    if (!Number.isFinite(timestamp)) {
      return;
    }
    const hourStartedAt = toHourStartedAt(timestamp);
    const metrics = createTelemetryMetricValues(payload);
    await this.mysql.execute(
      `INSERT INTO device_telemetry_hour_metric_summaries (
         device_id, hour_started_at, sample_count, first_received_at, last_received_at,
         temperature, vibration, ax, ay, az,
         vrms_x_mms, vrms_y_mms, vrms_z_mms, vrms_unit,
         drms_x_um, drms_y_um, drms_z_um, drms_band_min_hz, drms_band_max_hz, drms_unit,
         temperature_sample_count, vibration_sample_count, ax_sample_count, ay_sample_count, az_sample_count,
         vrms_x_sample_count, vrms_y_sample_count, vrms_z_sample_count,
         drms_x_sample_count, drms_y_sample_count, drms_z_sample_count,
         drms_band_min_sample_count, drms_band_max_sample_count
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         temperature = CASE WHEN VALUES(temperature_sample_count) = 0 THEN temperature WHEN temperature IS NULL THEN VALUES(temperature) ELSE (temperature * temperature_sample_count + VALUES(temperature) * VALUES(temperature_sample_count)) / (temperature_sample_count + VALUES(temperature_sample_count)) END,
         vibration = CASE WHEN VALUES(vibration_sample_count) = 0 THEN vibration WHEN vibration IS NULL THEN VALUES(vibration) ELSE (vibration * vibration_sample_count + VALUES(vibration) * VALUES(vibration_sample_count)) / (vibration_sample_count + VALUES(vibration_sample_count)) END,
         ax = CASE WHEN VALUES(ax_sample_count) = 0 THEN ax WHEN ax IS NULL THEN VALUES(ax) ELSE (ax * ax_sample_count + VALUES(ax) * VALUES(ax_sample_count)) / (ax_sample_count + VALUES(ax_sample_count)) END,
         ay = CASE WHEN VALUES(ay_sample_count) = 0 THEN ay WHEN ay IS NULL THEN VALUES(ay) ELSE (ay * ay_sample_count + VALUES(ay) * VALUES(ay_sample_count)) / (ay_sample_count + VALUES(ay_sample_count)) END,
         az = CASE WHEN VALUES(az_sample_count) = 0 THEN az WHEN az IS NULL THEN VALUES(az) ELSE (az * az_sample_count + VALUES(az) * VALUES(az_sample_count)) / (az_sample_count + VALUES(az_sample_count)) END,
         vrms_x_mms = CASE WHEN VALUES(vrms_x_sample_count) = 0 THEN vrms_x_mms WHEN vrms_x_mms IS NULL THEN VALUES(vrms_x_mms) ELSE (vrms_x_mms * vrms_x_sample_count + VALUES(vrms_x_mms) * VALUES(vrms_x_sample_count)) / (vrms_x_sample_count + VALUES(vrms_x_sample_count)) END,
         vrms_y_mms = CASE WHEN VALUES(vrms_y_sample_count) = 0 THEN vrms_y_mms WHEN vrms_y_mms IS NULL THEN VALUES(vrms_y_mms) ELSE (vrms_y_mms * vrms_y_sample_count + VALUES(vrms_y_mms) * VALUES(vrms_y_sample_count)) / (vrms_y_sample_count + VALUES(vrms_y_sample_count)) END,
         vrms_z_mms = CASE WHEN VALUES(vrms_z_sample_count) = 0 THEN vrms_z_mms WHEN vrms_z_mms IS NULL THEN VALUES(vrms_z_mms) ELSE (vrms_z_mms * vrms_z_sample_count + VALUES(vrms_z_mms) * VALUES(vrms_z_sample_count)) / (vrms_z_sample_count + VALUES(vrms_z_sample_count)) END,
         vrms_unit = COALESCE(VALUES(vrms_unit), vrms_unit),
         drms_x_um = CASE WHEN VALUES(drms_x_sample_count) = 0 THEN drms_x_um WHEN drms_x_um IS NULL THEN VALUES(drms_x_um) ELSE (drms_x_um * drms_x_sample_count + VALUES(drms_x_um) * VALUES(drms_x_sample_count)) / (drms_x_sample_count + VALUES(drms_x_sample_count)) END,
         drms_y_um = CASE WHEN VALUES(drms_y_sample_count) = 0 THEN drms_y_um WHEN drms_y_um IS NULL THEN VALUES(drms_y_um) ELSE (drms_y_um * drms_y_sample_count + VALUES(drms_y_um) * VALUES(drms_y_sample_count)) / (drms_y_sample_count + VALUES(drms_y_sample_count)) END,
         drms_z_um = CASE WHEN VALUES(drms_z_sample_count) = 0 THEN drms_z_um WHEN drms_z_um IS NULL THEN VALUES(drms_z_um) ELSE (drms_z_um * drms_z_sample_count + VALUES(drms_z_um) * VALUES(drms_z_sample_count)) / (drms_z_sample_count + VALUES(drms_z_sample_count)) END,
         drms_band_min_hz = CASE WHEN VALUES(drms_band_min_sample_count) = 0 THEN drms_band_min_hz WHEN drms_band_min_hz IS NULL THEN VALUES(drms_band_min_hz) ELSE (drms_band_min_hz * drms_band_min_sample_count + VALUES(drms_band_min_hz) * VALUES(drms_band_min_sample_count)) / (drms_band_min_sample_count + VALUES(drms_band_min_sample_count)) END,
         drms_band_max_hz = CASE WHEN VALUES(drms_band_max_sample_count) = 0 THEN drms_band_max_hz WHEN drms_band_max_hz IS NULL THEN VALUES(drms_band_max_hz) ELSE (drms_band_max_hz * drms_band_max_sample_count + VALUES(drms_band_max_hz) * VALUES(drms_band_max_sample_count)) / (drms_band_max_sample_count + VALUES(drms_band_max_sample_count)) END,
         drms_unit = COALESCE(VALUES(drms_unit), drms_unit),
         temperature_sample_count = temperature_sample_count + VALUES(temperature_sample_count),
         vibration_sample_count = vibration_sample_count + VALUES(vibration_sample_count),
         ax_sample_count = ax_sample_count + VALUES(ax_sample_count),
         ay_sample_count = ay_sample_count + VALUES(ay_sample_count),
         az_sample_count = az_sample_count + VALUES(az_sample_count),
         vrms_x_sample_count = vrms_x_sample_count + VALUES(vrms_x_sample_count),
         vrms_y_sample_count = vrms_y_sample_count + VALUES(vrms_y_sample_count),
         vrms_z_sample_count = vrms_z_sample_count + VALUES(vrms_z_sample_count),
         drms_x_sample_count = drms_x_sample_count + VALUES(drms_x_sample_count),
         drms_y_sample_count = drms_y_sample_count + VALUES(drms_y_sample_count),
         drms_z_sample_count = drms_z_sample_count + VALUES(drms_z_sample_count),
         drms_band_min_sample_count = drms_band_min_sample_count + VALUES(drms_band_min_sample_count),
         drms_band_max_sample_count = drms_band_max_sample_count + VALUES(drms_band_max_sample_count),
         sample_count = sample_count + 1,
         first_received_at = LEAST(first_received_at, VALUES(first_received_at)),
         last_received_at = GREATEST(last_received_at, VALUES(last_received_at))`,
      [
        deviceId,
        hourStartedAt,
        receivedAt,
        receivedAt,
        metrics.temperature,
        metrics.vibration,
        metrics.ax,
        metrics.ay,
        metrics.az,
        metrics.vrmsX,
        metrics.vrmsY,
        metrics.vrmsZ,
        metrics.vrmsUnit,
        metrics.drmsX,
        metrics.drmsY,
        metrics.drmsZ,
        metrics.drmsBandMin,
        metrics.drmsBandMax,
        metrics.drmsUnit,
        metrics.temperature === null ? 0 : 1,
        metrics.vibration === null ? 0 : 1,
        metrics.ax === null ? 0 : 1,
        metrics.ay === null ? 0 : 1,
        metrics.az === null ? 0 : 1,
        metrics.vrmsX === null ? 0 : 1,
        metrics.vrmsY === null ? 0 : 1,
        metrics.vrmsZ === null ? 0 : 1,
        metrics.drmsX === null ? 0 : 1,
        metrics.drmsY === null ? 0 : 1,
        metrics.drmsZ === null ? 0 : 1,
        metrics.drmsBandMin === null ? 0 : 1,
        metrics.drmsBandMax === null ? 0 : 1,
      ],
    );
  }
}
