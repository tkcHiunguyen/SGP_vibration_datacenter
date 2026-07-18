import assert from 'node:assert/strict';
import test from 'node:test';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import { MySqlTelemetryRepository } from './mysql-telemetry.repository.js';

type QueryCall = {
  sql: string;
  params: Array<string | number | boolean | null | Date | Buffer>;
};

class FakeMySqlAccess {
  readonly calls: QueryCall[] = [];

  constructor(private readonly rowsByKind: Record<string, Record<string, unknown>[]>) {}

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: Array<string | number | boolean | null | Date | Buffer> = [],
  ): Promise<T[]> {
    this.calls.push({ sql, params });

    if (sql.includes('COUNT(*) AS total FROM device_datas')) {
      return (this.rowsByKind.count ?? []) as T[];
    }

    if (sql.includes('GROUP BY device_id, bucket_index')) {
      return (this.rowsByKind.bucket ?? []) as T[];
    }

    return (this.rowsByKind.raw ?? []) as T[];
  }

  async execute(
    sql: string,
    params: Array<string | number | boolean | null | Date | Buffer> = [],
  ): Promise<number> {
    this.calls.push({ sql, params });
    return 1;
  }

  async ensureReady(): Promise<void> {}

  async close(): Promise<void> {}
}

test('normal telemetry persists both temperature and vibration metrics', async () => {
  const mysql = new FakeMySqlAccess({});
  const repository = new MySqlTelemetryRepository(mysql as unknown as MySqlAccess);

  await (repository as unknown as { persist(message: { deviceId: string; receivedAt: string; payload: Record<string, unknown> }): Promise<void> }).persist({
    deviceId: 'ESP-OK',
    receivedAt: '2026-07-17T00:00:00.000Z',
    payload: {
      messageId: 'message-ok',
      temperature: 31.4,
      temperatureAvailable: true,
      vibrationAvailable: true,
      adxlStatus: 'ok',
      telemetryUuid: 'telemetry-ok',
      ax: 0.12,
      ay: 0.18,
      az: 0.09,
    },
  });

  const insert = mysql.calls.find((call) => call.sql.includes('INSERT INTO device_datas'));
  assert.ok(insert);
  assert.equal(insert.params[2], 31.4);
  assert.equal(insert.params[4], 0.12);
  assert.equal(insert.params[5], 0.18);
  assert.equal(insert.params[6], 0.09);
  assert.equal(insert.params[18], 'telemetry-ok');
  assert.equal(insert.params[19], 'message-ok');
  assert.equal(insert.params[21], 1);
  assert.equal(insert.params[22], 'ok');

  const hourlySummaryInsert = mysql.calls.find((call) => call.sql.includes('INSERT INTO device_telemetry_hour_metric_summaries'));
  assert.ok(hourlySummaryInsert);
  const values = hourlySummaryInsert.sql.match(/\) VALUES \(([^)]+)\)/)?.[1].split(',') ?? [];
  assert.equal(values.length, hourlySummaryInsert.params.length + 1);
});

test('partial ADXL-fault telemetry stores temperature without vibration or spectrum linkage', async () => {
  const mysql = new FakeMySqlAccess({});
  const repository = new MySqlTelemetryRepository(mysql as unknown as MySqlAccess);

  await (repository as unknown as { persist(message: { deviceId: string; receivedAt: string; payload: Record<string, unknown> }): Promise<void> }).persist({
    deviceId: 'ESP-PARTIAL',
    receivedAt: '2026-07-17T00:00:00.000Z',
    payload: {
      messageId: 'message-partial',
      temperature: 31.4,
      temperatureAvailable: true,
      vibrationAvailable: false,
      adxlStatus: 'fault',
      adxlFaultReason: 'i2c_read_error',
      telemetryUuid: 'stale-telemetry-uuid',
      ax: 0.12,
      ay: 0.18,
      az: 0.09,
    },
  });

  const insert = mysql.calls.find((call) => call.sql.includes('INSERT INTO device_datas'));
  assert.ok(insert);
  assert.equal(insert.params[2], 31.4);
  assert.equal(insert.params[3], null);
  assert.equal(insert.params[4], null);
  assert.equal(insert.params[5], null);
  assert.equal(insert.params[6], null);
  assert.equal(insert.params[18], null);
  assert.equal(insert.params[21], 0);
  assert.equal(insert.params[22], 'fault');
  assert.equal(insert.params[23], 'i2c_read_error');
  assert.equal(mysql.calls.some((call) => call.sql.includes('device_spectrum_frames')), false);
});

test('partial telemetry history does not synthesize a telemetry UUID', async () => {
  const mysql = new FakeMySqlAccess({
    raw: [
      {
        id: 1,
        device_id: 'ESP-PARTIAL',
        received_at: '2026-07-17 00:00:00.000',
        temperature: 31.4,
        vibration: null,
        ax: null,
        ay: null,
        az: null,
        sample_count: null,
        telemetry_uuid: null,
        message_id: 'message-partial',
        temperature_available: 1,
        vibration_available: 0,
        adxl_status: 'fault',
        adxl_fault_reason: 'i2c_read_error',
      },
    ],
  });
  const repository = new MySqlTelemetryRepository(mysql as unknown as MySqlAccess);

  const result = await repository.exportHistory({
    from: '2026-07-17T00:00:00.000Z',
    to: '2026-07-17T00:00:01.000Z',
  });

  assert.equal(result[0]?.telemetryUuid, undefined);
  assert.equal(result[0]?.payload.telemetryUuid, undefined);
  assert.equal(result[0]?.payload.vibrationAvailable, false);
});

test('bucketed history aggregates in SQL without the default raw limit', async () => {
  const bucketStartedMs = Date.parse('2026-04-29T17:00:00.000Z');
  const mysql = new FakeMySqlAccess({
    count: [{ total: 8619 }],
    bucket: [
      {
        id: 1,
        device_id: 'ESP-1',
        received_at: '2026-04-29 17:00:05.000',
        temperature: 22.5,
        vibration: null,
        ax: 0.1,
        ay: 0.2,
        az: 0.3,
        sample_count: 60,
        telemetry_uuid: null,
        bucket_started_ms: bucketStartedMs,
        bucket_ended_ms: bucketStartedMs + 60_000,
      },
      {
        id: 2,
        device_id: 'ESP-1',
        received_at: '2026-04-29 17:01:05.000',
        temperature: 23.5,
        vibration: null,
        ax: 0.4,
        ay: 0.5,
        az: 0.6,
        sample_count: 60,
        telemetry_uuid: null,
        bucket_started_ms: bucketStartedMs + 60_000,
        bucket_ended_ms: bucketStartedMs + 120_000,
      },
    ],
  });
  const repository = new MySqlTelemetryRepository(mysql as unknown as MySqlAccess);

  const result = await repository.listHistory({
    deviceId: 'ESP-1',
    from: '2026-04-29T17:00:00.000Z',
    to: '2026-04-30T16:59:59.999Z',
    bucketMs: 60_000,
  });

  assert.equal(result.totalMatched, 8619);
  assert.equal(result.bucketMs, 60_000);
  assert.equal(result.truncated, false);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.receivedAt, '2026-04-29T17:00:05.000Z');
  assert.equal(result.items[0]?.bucketStartedAt, '2026-04-29T17:00:00.000Z');
  assert.equal(result.items[0]?.sampleCount, 60);
  assert.equal(result.items[0]?.payload.temperature, 22.5);

  const bucketCall = mysql.calls.find((call) => call.sql.includes('GROUP BY device_id, bucket_index'));
  assert.ok(bucketCall);
  assert.match(bucketCall.sql, /AVG\(temperature\)/);
  assert.doesNotMatch(bucketCall.sql, /LIMIT \?/);
  assert.deepEqual(bucketCall.params.slice(0, 3), [60_000, 60_000, 60_000_000]);
});

test('raw history keeps the default latest-point limit', async () => {
  const mysql = new FakeMySqlAccess({
    count: [{ total: 500 }],
    raw: [
      {
        id: 1,
        device_id: 'ESP-1',
        received_at: '2026-04-29 17:00:05.000',
        temperature: 22.5,
        vibration: null,
        ax: 0.1,
        ay: 0.2,
        az: 0.3,
        sample_count: 1,
        telemetry_uuid: 'telemetry-1',
      },
    ],
  });
  const repository = new MySqlTelemetryRepository(mysql as unknown as MySqlAccess);

  const result = await repository.listHistory({ deviceId: 'ESP-1' });

  assert.equal(result.items.length, 1);
  assert.equal(result.truncated, true);
  const rawCall = mysql.calls.find((call) => call.sql.includes('ORDER BY received_at DESC'));
  assert.ok(rawCall);
  assert.match(rawCall.sql, /LIMIT \?/);
  assert.equal(rawCall.params.at(-1), 200);
});

test('archive export returns raw range without history limit and fills stable telemetry uuid', async () => {
  const mysql = new FakeMySqlAccess({
    raw: [
      {
        id: 1,
        device_id: 'ESP-1',
        received_at: '2026-04-29 17:00:05.000',
        temperature: 22.5,
        vibration: null,
        ax: 0.1,
        ay: 0.2,
        az: 0.3,
        sample_count: 1,
        telemetry_uuid: null,
      },
    ],
  });
  const repository = new MySqlTelemetryRepository(mysql as unknown as MySqlAccess);

  const result = await repository.exportHistory({
    from: '2026-04-29T17:00:00.000Z',
    to: '2026-04-30T16:59:59.999Z',
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.telemetryUuid, 'sgp-time:ESP-1:2026-04-29T17:00:05.000Z');
  assert.equal(result[0]?.payload.telemetry_uuid, result[0]?.telemetryUuid);
  const exportCall = mysql.calls.find((call) => call.sql.includes('ORDER BY device_id ASC, received_at ASC, id ASC'));
  assert.ok(exportCall);
  assert.doesNotMatch(exportCall.sql, /LIMIT \?/);
  assert.deepEqual(exportCall.params, ['2026-04-29T17:00:00.000Z', '2026-04-30T16:59:59.999Z']);
});
