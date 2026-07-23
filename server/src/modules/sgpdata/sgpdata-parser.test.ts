import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createGzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

import { inspectSgpDataFile, iterateSgpDataEntries } from './sgpdata-parser.js';

const gzipAsync = promisify(gzip);

function createV2Lines() {
  return [
    JSON.stringify({ type: 'manifest', data: { format: 'sgpdata', version: 2, dateRange: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-02T00:00:00.000Z' } } }),
    JSON.stringify({ type: 'device', data: { deviceId: 'ESP-001', name: 'Motor 1' } }),
    JSON.stringify({ type: 'measurement', data: { deviceId: 'ESP-001', receivedAt: '2026-07-01T01:00:00.000Z', payload: { temperature: 32 } } }),
  ];
}

async function writeV2File(filePath: string, checksumOverride?: string, includeEnd = true): Promise<void> {
  const lines = createV2Lines();
  const checksum = createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
  const content = includeEnd
    ? `${lines.join('\n')}\n${JSON.stringify({ type: 'end', data: { checksumSha256: checksumOverride ?? checksum } })}\n`
    : `${lines.join('\n')}\n`;
  await writeFile(filePath, await gzipAsync(Buffer.from(content)));
}

test('streams and validates a v2 checksum without retaining archive records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgpdata-parser-'));
  try {
    const filePath = join(dir, 'valid.sgpdata');
    await writeV2File(filePath);
    const preview = await inspectSgpDataFile(filePath);
    const entries = [];
    for await (const entry of iterateSgpDataEntries(filePath)) entries.push(entry.type);

    assert.deepEqual(entries, ['manifest', 'device', 'measurement']);
    assert.equal(preview.metadata.deviceCount, 1);
    assert.equal(preview.metadata.measurementCount, 1);
    assert.equal(preview.metadata.checksumValid, true);
    assert.match(preview.metadata.checksumSha256 ?? '', /^[a-f0-9]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a v2 archive with a wrong checksum', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgpdata-parser-'));
  try {
    const filePath = join(dir, 'bad-checksum.sgpdata');
    await writeV2File(filePath, '0'.repeat(64));
    await assert.rejects(inspectSgpDataFile(filePath), /sgpdata_checksum_mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a v2 archive whose manifest counts do not match its records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgpdata-parser-'));
  try {
    const filePath = join(dir, 'bad-count.sgpdata');
    const lines = createV2Lines();
    lines[0] = JSON.stringify({
      type: 'manifest',
      data: { format: 'sgpdata', version: 2, deviceCount: 1, measurementCount: 2, spectrumFrameCount: 0 },
    });
    const checksum = createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
    const content = `${lines.join('\n')}\n${JSON.stringify({ type: 'end', data: { checksumSha256: checksum } })}\n`;
    await writeFile(filePath, await gzipAsync(Buffer.from(content)));

    await assert.rejects(inspectSgpDataFile(filePath), /sgpdata_manifest_measurement_count_mismatch:1\/2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a truncated v2 archive without its end record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgpdata-parser-'));
  try {
    const filePath = join(dir, 'truncated.sgpdata');
    await writeV2File(filePath, undefined, false);
    await assert.rejects(inspectSgpDataFile(filePath), /sgpdata_end_missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a legacy v1 JSON archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgpdata-parser-'));
  try {
    const filePath = join(dir, 'legacy.sgpdata');
    const archive = {
      manifest: { format: 'sgpdata', version: 1 },
      devices: [{ deviceId: 'ESP-LEGACY' }],
      measurements: [],
      spectrumFrames: [],
      placementConfigs: {},
    };
    await writeFile(filePath, await gzipAsync(Buffer.from(JSON.stringify(archive))));
    await assert.rejects(inspectSgpDataFile(filePath), /sgpdata_v1_unsupported/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('large gzip NDJSON parsing keeps peak RSS below the full uncompressed archive size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgpdata-memory-'));
  try {
    const filePath = join(dir, 'large.sgpdata');
    const gzipStream = createGzip();
    const output = createWriteStream(filePath);
    gzipStream.pipe(output);
    const checksum = createHash('sha256');
    let uncompressedBytes = 0;
    const writeEntry = async (type: string, data: unknown) => {
      const line = `${JSON.stringify({ type, data })}\n`;
      checksum.update(line);
      uncompressedBytes += Buffer.byteLength(line);
      if (!gzipStream.write(line)) await once(gzipStream, 'drain');
    };
    await writeEntry('manifest', { format: 'sgpdata', version: 2 });
    await writeEntry('device', { deviceId: 'ESP-MEMORY' });
    const padding = 'x'.repeat(3_072);
    for (let index = 0; index < 20_000; index += 1) {
      await writeEntry('measurement', {
        deviceId: 'ESP-MEMORY',
        receivedAt: new Date(Date.parse('2026-07-01T00:00:00.000Z') + index * 1_000).toISOString(),
        telemetryUuid: `memory-${index}`,
        payload: { temperature: 25, padding },
      });
    }
    gzipStream.end(`${JSON.stringify({ type: 'end', data: { checksumSha256: checksum.digest('hex') } })}\n`);
    await once(output, 'finish');
    assert.ok(uncompressedBytes > 60 * 1024 * 1024);

    const parserUrl = pathToFileURL(resolve('src/modules/sgpdata/sgpdata-parser.ts')).href;
    const script = `
      const filePath = process.argv[1];
      const parserUrl = process.argv[2];
      const { iterateSgpDataEntries } = await import(parserUrl);
      global.gc();
      const baseline = process.memoryUsage().rss;
      let peak = baseline;
      let count = 0;
      for await (const entry of iterateSgpDataEntries(filePath)) {
        count += 1;
        if (count % 500 === 0) {
          global.gc();
          peak = Math.max(peak, process.memoryUsage().rss);
        }
      }
      console.log(JSON.stringify({ count, baseline, peak }));
    `;
    const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', '-e', script, filePath, parserUrl], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [exitCode] = await once(child, 'exit') as [number];
    assert.equal(exitCode, 0, stderr);
    const memory = JSON.parse(stdout.trim()) as { count: number; baseline: number; peak: number };
    assert.equal(memory.count, 20_002);
    if (process.env.SGPDATA_REPORT_MEMORY === 'true') {
      console.log(JSON.stringify({ uncompressedBytes, peakRssDeltaBytes: memory.peak - memory.baseline }));
    }
    assert.ok(memory.peak - memory.baseline < 48 * 1024 * 1024, `RSS grew by ${memory.peak - memory.baseline} bytes`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
