import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import type { MySqlAccess } from '../persistence/mysql-access.js';
import { SpectrumStorageService, type SpectrumArchiveFrame } from './spectrum-storage.service.js';

class FakeMySql {
  readonly calls: string[] = [];
  constructor(
    private readonly existing: boolean,
    private readonly spectrumRows: Array<Record<string, unknown>> = [],
  ) {}
  async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    this.calls.push(sql);
    if (sql.includes('SELECT storage_path FROM device_spectrum_frames') && this.existing) {
      return [{ storage_path: 'ESP-1/frame.json.gz' }] as unknown as T[];
    }
    if (sql.includes('FROM device_spectrum_frames') && sql.includes('captured_at >= ?')) {
      return this.spectrumRows as T[];
    }
    return [];
  }
  async execute(sql: string): Promise<number> { this.calls.push(sql); return this.existing ? 2 : 1; }
  async ensureReady(): Promise<void> {}
  async close(): Promise<void> {}
}

function frame(content: Buffer): SpectrumArchiveFrame {
  return {
    deviceId: 'ESP-1',
    capturedAt: '2026-07-21T00:00:00.000Z',
    telemetryUuid: 'frame-1',
    storagePath: 'ESP-1/frame.json.gz',
    contentBase64: content.toString('base64'),
  };
}

test('spectrum merge overwrites duplicates while idempotent preserves existing content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spectrum-mode-'));
  const target = join(root, 'ESP-1', 'frame.json.gz');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from('old'));
  const mysql = new FakeMySql(true);
  const service = new SpectrumStorageService(mysql as unknown as MySqlAccess, { baseDir: root });

  assert.equal(await service.importArchiveFrame(frame(Buffer.from('new')), 'idempotent'), 'skipped');
  assert.equal((await readFile(target)).toString(), 'old');
  assert.equal(mysql.calls.some((sql) => sql.includes('INSERT INTO device_spectrum_frames')), false);

  assert.equal(await service.importArchiveFrame(frame(Buffer.from('new')), 'merge'), 'updated');
  assert.equal((await readFile(target)).toString(), 'new');
  assert.equal(mysql.calls.some((sql) => sql.includes('INSERT INTO device_spectrum_frames')), true);
});

test('bucket lookup returns a frame inside the bucket even when its center is beyond the point tolerance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spectrum-window-'));
  const storagePath = 'ESP-1/2026/07/21/frame.json.gz';
  const target = join(root, storagePath);
  const capturedAt = '2026-07-21T03:13:56.709Z';
  const axisPoint = (axis: 'x' | 'y' | 'z') => ({
    deviceId: 'ESP-1',
    axis,
    receivedAt: capturedAt,
    amplitudes: [0.1, 0.2],
  });
  const payload = {
    version: 1,
    deviceId: 'ESP-1',
    capturedAt,
    telemetryUuid: 'telemetry-1',
    axes: { x: axisPoint('x'), y: axisPoint('y'), z: axisPoint('z') },
  };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, gzipSync(Buffer.from(JSON.stringify(payload))));

  const mysql = new FakeMySql(false, [{
    id: 1,
    device_id: 'ESP-1',
    captured_at: capturedAt,
    telemetry_uuid: 'telemetry-1',
    device_data_id: 1,
    storage_path: storagePath,
    file_size_bytes: 100,
    checksum_sha256: null,
  }]);
  const service = new SpectrumStorageService(mysql as unknown as MySqlAccess, { baseDir: root });
  const result = await service.findNearestFrame(
    'ESP-1',
    '2026-07-21T03:13:30.000Z',
    undefined,
    { from: '2026-07-21T03:13:00.000Z', to: '2026-07-21T03:14:00.000Z' },
  );

  assert.equal(result?.telemetryUuid, 'telemetry-1');
  assert.equal(result?.points.length, 3);
  assert.ok(mysql.calls.some((sql) => sql.includes('ORDER BY ABS(TIMESTAMPDIFF')));
});
