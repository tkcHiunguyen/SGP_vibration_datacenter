import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import type { MySqlAccess } from '../persistence/mysql-access.js';
import { SpectrumStorageService, type SpectrumArchiveFrame } from './spectrum-storage.service.js';

class FakeMySql {
  readonly calls: string[] = [];
  constructor(private readonly existing: boolean) {}
  async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    this.calls.push(sql);
    if (sql.includes('SELECT storage_path FROM device_spectrum_frames') && this.existing) {
      return [{ storage_path: 'ESP-1/frame.json.gz' }] as unknown as T[];
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
