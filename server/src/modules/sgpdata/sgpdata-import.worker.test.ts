import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AuditService } from '../audit/audit.service.js';
import type { DeviceService } from '../device/device.service.js';
import type { SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import type { ZoneService } from '../zone/zone.service.js';
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

async function waitForTerminal(repository: TrackingRepository, jobId = 'job-batch'): Promise<SgpDataImportJob> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await repository.get(jobId);
    if (job?.status === 'completed' || job?.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('worker_timeout');
}

async function createModeArchive(filePath: string): Promise<void> {
  const lines = [
    JSON.stringify({ type: 'manifest', data: {
      format: 'sgpdata', version: 3, deviceCount: 1, measurementCount: 1, spectrumFrameCount: 1,
      placementConfigCount: 1, zoneCount: 1,
      dateRange: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-01T23:59:59.999Z' },
    } }),
    JSON.stringify({ type: 'zone', data: {
      code: 'ZONE-A', name: 'Zone A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } }),
    JSON.stringify({ type: 'device', data: { deviceId: 'ESP-MODE', name: 'Mode device', zone: 'ZONE-A' } }),
    JSON.stringify({ type: 'placementConfig', data: { deviceId: 'ESP-MODE', config: { x: 10, y: 20 } } }),
    JSON.stringify({ type: 'measurement', data: {
      deviceId: 'ESP-MODE', receivedAt: '2026-07-01T12:00:00.000Z', telemetryUuid: 'mode-telemetry',
      payload: { vibration: 12.5 },
    } }),
    JSON.stringify({ type: 'spectrumFrame', data: {
      deviceId: 'ESP-MODE', capturedAt: '2026-07-01T12:00:00.000Z', telemetryUuid: 'mode-telemetry',
      storagePath: 'ESP-MODE/2026/07/01/frame.json.gz', contentBase64: Buffer.from('fft').toString('base64'),
    } }),
  ];
  const payload = `${lines.join('\n')}\n`;
  const checksum = createHash('sha256').update(payload).digest('hex');
  await writeFile(filePath, `${payload}${JSON.stringify({ type: 'end', data: { checksumSha256: checksum } })}\n`);
}

async function createModeJob(filePath: string, mode: 'merge' | 'replace', jobId: string): Promise<SgpDataImportJob> {
  const now = new Date().toISOString();
  return {
    jobId, uploadId: `upload-${jobId}`, status: 'queued', stage: 'queued', progress: 5, stageProgress: 0,
    fileName: 'mode.sgpdata', filePath, fileSha256: await sha256File(filePath), sizeBytes: (await stat(filePath)).size,
    mode, totals: { devices: 1, measurements: 1, spectrum: 1, placementConfigs: 1 },
    processed: { devices: 0, measurements: 0, spectrum: 0, placementConfigs: 0 },
    mutations: { inserted: 0, updated: 0, skipped: 0, failed: 0 }, recordsPerSecond: 0,
    preview: {
      manifest: { format: 'sgpdata', version: 3 },
      metadata: { deviceCount: 1, measurementCount: 1, spectrumCount: 1, placementConfigCount: 1, zoneCount: 1, checksumValid: true },
      dateRange: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-01T23:59:59.999Z' },
      devices: [{ deviceId: 'ESP-MODE', name: 'Mode device', zone: 'ZONE-A', measurementsTotal: 1, spectrumTotal: 1 }],
      deviceMetadata: [{ deviceId: 'ESP-MODE', name: 'Mode device', zone: 'ZONE-A' }],
      zones: [{ code: 'ZONE-A', name: 'Zone A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      placementConfigs: [{ deviceId: 'ESP-MODE', config: { x: 10, y: 20 } }],
      measurements: 1, spectra: 1,
    },
    devices: { 'ESP-MODE': {
      deviceId: 'ESP-MODE', name: 'Mode device', measurementsTotal: 1, measurementsProcessed: 0,
      spectrumTotal: 1, spectrumProcessed: 0, status: 'queued',
    } },
    events: [], createdAt: now, updatedAt: now,
  };
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
  const zoneService = { importRecord: async () => 'inserted' as const } as unknown as ZoneService;
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
  const worker = new SgpDataImportWorker(repository, deviceService, telemetryService, spectrumService, zoneService, auditService);
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

test('replace mode clears only the archive device and date range before importing replacement data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sgpdata-replace-'));
  try {
    const filePath = join(root, 'replace.sgpdata');
    await createModeArchive(filePath);
    const repository = new TrackingRepository();
    const operations: string[] = [];
    const deletedRanges: unknown[] = [];
    const summaryRanges: unknown[] = [];
    const deviceService = {
      getMetadata: () => ({ deviceId: 'ESP-MODE', name: 'Old device' }),
      replaceImportedMetadataStrict: async (input: { zone?: string }) => { operations.push(`replace-device:${input.zone}`); return input; },
    } as unknown as DeviceService;
    const telemetryService = {
      deleteHistoryRange: async (range: unknown) => { operations.push('delete-telemetry'); deletedRanges.push(range); return 3; },
      importHistoryBatch: async (_points: unknown[], mode: string) => {
        operations.push(`write-telemetry:${mode}`);
        return { inserted: 1, updated: 0, skipped: 0 };
      },
      rebuildHourlySummaries: async (ranges: unknown[]) => { operations.push('rebuild-summaries'); summaryRanges.push(...ranges); },
    } as unknown as TelemetryService;
    const spectrumService = {
      purgeArchiveRange: async (deviceId: string, from: string, to: string) => {
        operations.push(`delete-spectrum:${deviceId}:${from}:${to}`);
        return { framesDeleted: 2, filesDeleted: 2, fileDeleteErrors: 0 };
      },
      deletePlacementConfig: async () => { operations.push('delete-placement'); return true; },
      readPlacementConfig: async () => null,
      writePlacementConfig: async (_deviceId: string, config: unknown) => { operations.push('write-placement'); return config; },
      importArchiveFrame: async (_frame: unknown, mode: string) => { operations.push(`write-spectrum:${mode}`); return 'inserted' as const; },
    } as unknown as SpectrumStorageService;
    const zoneService = {
      importRecord: async () => { operations.push('write-zone'); return 'updated' as const; },
    } as unknown as ZoneService;
    const auditService = { record: () => undefined } as unknown as AuditService;
    const job = await createModeJob(filePath, 'replace', 'job-replace');
    await repository.save(job);

    new SgpDataImportWorker(repository, deviceService, telemetryService, spectrumService, zoneService, auditService).enqueue(job.jobId);
    const completed = await waitForTerminal(repository, job.jobId);

    assert.equal(completed.status, 'completed');
    assert.deepEqual(deletedRanges, [{
      deviceId: 'ESP-MODE', from: '2026-07-01T00:00:00.000Z', to: '2026-07-01T23:59:59.999Z',
    }]);
    assert.ok(operations.indexOf('write-zone') < operations.indexOf('replace-device:ZONE-A'));
    assert.ok(operations.indexOf('delete-placement') < operations.indexOf('write-placement'));
    assert.ok(operations.indexOf('delete-telemetry') < operations.indexOf('write-telemetry:merge'));
    assert.ok(operations.findIndex((item) => item.startsWith('delete-spectrum:')) < operations.indexOf('write-spectrum:merge'));
    assert.deepEqual(summaryRanges, [{
      deviceId: 'ESP-MODE', from: '2026-07-01T00:00:00.000Z', to: '2026-07-01T23:59:59.999Z',
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('merge mode imports additions without deleting existing data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sgpdata-merge-'));
  try {
    const filePath = join(root, 'merge.sgpdata');
    await createModeArchive(filePath);
    const repository = new TrackingRepository();
    const operations: string[] = [];
    const deviceService = {
      getMetadata: () => null,
      importMetadataStrict: async (input: unknown) => { operations.push('merge-device'); return input; },
    } as unknown as DeviceService;
    const telemetryService = {
      deleteHistoryRange: async () => { operations.push('delete-telemetry'); return 0; },
      importHistoryBatch: async (_points: unknown[], mode: string) => {
        operations.push(`write-telemetry:${mode}`);
        return { inserted: 1, updated: 0, skipped: 0 };
      },
      rebuildHourlySummaries: async () => undefined,
    } as unknown as TelemetryService;
    const spectrumService = {
      purgeArchiveRange: async () => { operations.push('delete-spectrum'); return { framesDeleted: 0, filesDeleted: 0, fileDeleteErrors: 0 }; },
      deletePlacementConfig: async () => { operations.push('delete-placement'); return false; },
      readPlacementConfig: async () => null,
      writePlacementConfig: async (_deviceId: string, config: unknown) => { operations.push('write-placement'); return config; },
      importArchiveFrame: async (_frame: unknown, mode: string) => { operations.push(`write-spectrum:${mode}`); return 'inserted' as const; },
    } as unknown as SpectrumStorageService;
    const zoneService = { importRecord: async () => 'inserted' as const } as unknown as ZoneService;
    const auditService = { record: () => undefined } as unknown as AuditService;
    const job = await createModeJob(filePath, 'merge', 'job-merge');
    await repository.save(job);

    new SgpDataImportWorker(repository, deviceService, telemetryService, spectrumService, zoneService, auditService).enqueue(job.jobId);
    const completed = await waitForTerminal(repository, job.jobId);

    assert.equal(completed.status, 'completed');
    assert.equal(operations.includes('merge-device'), true);
    assert.equal(operations.includes('write-telemetry:merge'), true);
    assert.equal(operations.includes('write-spectrum:merge'), true);
    assert.equal(operations.some((item) => item.startsWith('delete-')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
