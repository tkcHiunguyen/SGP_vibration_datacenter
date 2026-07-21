import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AuditService } from '../audit/audit.service.js';
import type { DeviceService } from '../device/device.service.js';
import type { SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import { InMemorySgpDataJobRepository } from './sgpdata-job.repository.js';
import { SgpDataImportWorker } from './sgpdata-import.worker.js';
import { sha256File } from './sgpdata-parser.js';
import type { SgpDataImportJob } from './sgpdata.types.js';

class TrackingRepository extends InMemorySgpDataJobRepository {
  readonly progress: number[] = [];
  override async update(job: SgpDataImportJob): Promise<void> {
    this.progress.push(job.progress);
    await super.update(job);
  }
}

async function createArchive(filePath: string, measurementCount: number): Promise<void> {
  const lines = [JSON.stringify({ type: 'manifest', data: {
    format: 'sgpdata', version: 2, deviceCount: 1, measurementCount, spectrumFrameCount: 0, placementConfigCount: 0,
  } })];
  lines.push(JSON.stringify({ type: 'device', data: { deviceId: 'ESP-BATCH', name: 'Batch device' } }));
  for (let index = 0; index < measurementCount; index += 1) {
    lines.push(JSON.stringify({ type: 'measurement', data: {
      deviceId: 'ESP-BATCH',
      receivedAt: new Date(Date.parse('2026-07-01T00:00:00.000Z') + index * 1_000).toISOString(),
      telemetryUuid: `telemetry-${index}`,
      payload: { messageId: `message-${index}`, temperature: 20 + (index % 10) },
    } }));
  }
  const payload = `${lines.join('\n')}\n`;
  const checksum = createHash('sha256').update(payload).digest('hex');
  await writeFile(filePath, `${payload}${JSON.stringify({ type: 'end', data: { checksumSha256: checksum } })}\n`);
}

async function waitForTerminal(repository: TrackingRepository): Promise<SgpDataImportJob> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await repository.get('job-batch');
    if (job?.status === 'completed' || job?.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('worker_timeout');
}

test('worker imports telemetry in bounded batches and reports monotonic progress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sgpdata-worker-'));
  const filePath = join(root, 'batch.sgpdata');
  await createArchive(filePath, 4_500);
  const repository = new TrackingRepository();
  const batchSizes: number[] = [];
  const summaryRanges: unknown[] = [];
  const deviceMetadata = new Map<string, unknown>();
  const deviceService = {
    getMetadata: (deviceId: string) => deviceMetadata.get(deviceId) ?? null,
    importMetadataStrict: async (input: { deviceId: string }) => { deviceMetadata.set(input.deviceId, input); return input; },
  } as unknown as DeviceService;
  const telemetryService = {
    importHistoryBatch: async (points: unknown[]) => {
      batchSizes.push(points.length);
      return { inserted: points.length, updated: 0, skipped: 0 };
    },
    rebuildHourlySummaries: async (ranges: unknown[]) => { summaryRanges.push(...ranges); },
  } as unknown as TelemetryService;
  const spectrumService = {
    readPlacementConfig: async () => null,
    writePlacementConfig: async (_deviceId: string, config: unknown) => config,
    importArchiveFrame: async () => 'inserted',
  } as unknown as SpectrumStorageService;
  const auditService = { record: () => undefined } as unknown as AuditService;
  const now = new Date().toISOString();
  const job: SgpDataImportJob = {
    jobId: 'job-batch', uploadId: 'upload-batch', status: 'queued', stage: 'queued', progress: 5, stageProgress: 0,
    fileName: 'batch.sgpdata', filePath, fileSha256: await sha256File(filePath), sizeBytes: (await stat(filePath)).size,
    mode: 'merge', totals: { devices: 1, measurements: 4_500, spectrum: 0, placementConfigs: 0 },
    processed: { devices: 0, measurements: 0, spectrum: 0, placementConfigs: 0 },
    mutations: { inserted: 0, updated: 0, skipped: 0, failed: 0 }, recordsPerSecond: 0,
    preview: {
      manifest: { format: 'sgpdata', version: 2 },
      metadata: { deviceCount: 1, measurementCount: 4_500, spectrumCount: 0, placementConfigCount: 0, checksumValid: true },
      devices: [{ deviceId: 'ESP-BATCH', name: 'Batch device', measurementsTotal: 4_500, spectrumTotal: 0 }],
      measurements: 4_500, spectra: 0,
    },
    devices: { 'ESP-BATCH': { deviceId: 'ESP-BATCH', name: 'Batch device', measurementsTotal: 4_500, measurementsProcessed: 0, spectrumTotal: 0, spectrumProcessed: 0, status: 'queued' } },
    events: [], createdAt: now, updatedAt: now,
  };
  await repository.save(job);
  const worker = new SgpDataImportWorker(repository, deviceService, telemetryService, spectrumService, auditService);
  worker.enqueue(job.jobId);
  const completed = await waitForTerminal(repository);

  assert.equal(completed.status, 'completed');
  assert.deepEqual(batchSizes, [2_000, 2_000, 500]);
  assert.equal(completed.processed.measurements, 4_500);
  assert.equal(completed.mutations.inserted, 4_501);
  assert.equal(summaryRanges.length, 1);
  assert.equal(repository.progress.every((value, index, values) => index === 0 || value >= values[index - 1]!), true);
  await assert.rejects(() => readFile(filePath), /ENOENT/);
});
