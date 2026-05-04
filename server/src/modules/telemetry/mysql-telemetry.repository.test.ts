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

  async execute(): Promise<number> {
    return 0;
  }

  async ensureReady(): Promise<void> {}

  async close(): Promise<void> {}
}

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
