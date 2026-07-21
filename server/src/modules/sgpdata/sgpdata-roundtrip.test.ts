import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AuditService } from '../audit/audit.service.js';
import { InMemoryDataExportJobRepository } from '../data-export/in-memory-data-export-job.repository.js';
import type { DataExportJob } from '../data-export/data-export-job.repository.js';
import type { DeviceService } from '../device/device.service.js';
import type { SpectrumArchiveFrame, SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import type { TelemetryImportPoint } from '../telemetry/telemetry.repository.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import { SgpDataExportWorker } from './sgpdata-export.worker.js';
import { InMemorySgpDataJobRepository } from './sgpdata-job.repository.js';
import { SgpDataImportWorker } from './sgpdata-import.worker.js';
import { inspectSgpDataFile, sha256File } from './sgpdata-parser.js';
import type { SgpDataImportJob } from './sgpdata.types.js';

async function waitForExport(repository: InMemoryDataExportJobRepository, jobId: string): Promise<DataExportJob> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await repository.get(jobId);
    if (job?.status === 'completed' || job?.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('export_timeout');
}

async function waitForImport(repository: InMemorySgpDataJobRepository, jobId: string): Promise<SgpDataImportJob> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await repository.get(jobId);
    if (job?.status === 'completed' || job?.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('import_timeout');
}

test('v2 export/import round-trip preserves devices, telemetry, placement and spectrum', async () => {
  const exportDir = await mkdtemp(join(tmpdir(), 'sgpdata-roundtrip-'));
  const metadata = {
    deviceId: 'ESP-ROUNDTRIP', uuid: 'uuid-roundtrip', name: 'Roundtrip device', site: 'SGP', zone: 'ZONE-1',
    firmwareVersion: '1.2.3', notes: 'preserve me', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
  };
  const telemetry: TelemetryImportPoint[] = [
    { deviceId: metadata.deviceId, receivedAt: '2026-07-20T00:00:00.000Z', telemetryUuid: 'telemetry-1', payload: { messageId: 'message-1', temperature: 25.1 } },
    { deviceId: metadata.deviceId, receivedAt: '2026-07-20T00:00:01.000Z', telemetryUuid: 'telemetry-2', payload: { messageId: 'message-2', ax: 0.12 } },
  ];
  const spectrumFrame: SpectrumArchiveFrame = {
    deviceId: metadata.deviceId,
    capturedAt: '2026-07-20T00:00:00.000Z',
    telemetryUuid: 'telemetry-1',
    storagePath: 'ESP-ROUNDTRIP/2026/07/20/frame.json.gz',
    checksumSha256: undefined,
    contentBase64: Buffer.from('spectrum-frame-content').toString('base64'),
  };
  const placement = { x: 12, y: 34, rotation: 90 };
  const importedTelemetry: TelemetryImportPoint[] = [];
  const importedSpectrum: SpectrumArchiveFrame[] = [];
  const importedPlacements: Array<{ deviceId: string; config: Record<string, unknown> }> = [];
  const importedDevices: unknown[] = [];
  let requestedTelemetryBatchSize = 0;
  let requestedSpectrumBatchSize = 0;
  const deviceService = {
    list: () => [{ deviceId: metadata.deviceId, online: false, metadata }],
    getMetadata: (deviceId: string) => deviceId === metadata.deviceId ? metadata : null,
    importMetadataStrict: async (input: unknown) => { importedDevices.push(input); return input; },
  } as unknown as DeviceService;
  const telemetryService = {
    countArchive: async () => telemetry.length,
    exportHistoryBatches: async function* (_query: unknown, batchSize?: number) {
      requestedTelemetryBatchSize = batchSize ?? 0;
      yield telemetry;
    },
    importHistoryBatch: async (points: TelemetryImportPoint[]) => {
      importedTelemetry.push(...points);
      return { inserted: points.length, updated: 0, skipped: 0 };
    },
    rebuildHourlySummaries: async () => undefined,
  } as unknown as TelemetryService;
  const spectrumService = {
    readPlacementConfig: async () => placement,
    countArchiveFrames: async () => 1,
    exportArchiveFrames: async function* (_query: unknown, batchSize?: number) {
      requestedSpectrumBatchSize = batchSize ?? 0;
      yield spectrumFrame;
    },
    writePlacementConfig: async (deviceId: string, config: Record<string, unknown>) => {
      importedPlacements.push({ deviceId, config });
      return config;
    },
    importArchiveFrame: async (frame: SpectrumArchiveFrame) => {
      importedSpectrum.push(frame);
      return 'inserted';
    },
  } as unknown as SpectrumStorageService;
  const auditService = { record: () => undefined } as unknown as AuditService;

  const exportRepository = new InMemoryDataExportJobRepository();
  const now = new Date().toISOString();
  const exportJob: DataExportJob = {
    jobId: 'export-roundtrip', status: 'queued', progress: 0, stage: 'queued',
    range: { from: '2026-07-20T00:00:00.000Z', to: '2026-07-20T23:59:59.999Z' },
    createdAt: now, updatedAt: now,
  };
  await exportRepository.save(exportJob);
  const exportWorker = new SgpDataExportWorker(
    exportRepository, deviceService, telemetryService, spectrumService, auditService, exportDir,
  );
  exportWorker.enqueue(exportJob.jobId);
  const exported = await waitForExport(exportRepository, exportJob.jobId);
  assert.equal(exported.status, 'completed');
  assert.ok(exported.filePath);
  assert.equal(requestedTelemetryBatchSize, 5_000);
  assert.equal(requestedSpectrumBatchSize, 1_000);

  const preview = await inspectSgpDataFile(exported.filePath!);
  assert.equal(preview.metadata.checksumValid, true);
  assert.equal(preview.metadata.measurementCount, telemetry.length);
  assert.equal(preview.metadata.spectrumCount, 1);
  assert.equal(preview.deviceMetadata?.[0]?.notes, metadata.notes);
  assert.deepEqual(preview.placementConfigs?.[0], { deviceId: metadata.deviceId, config: placement });
  const importRepository = new InMemorySgpDataJobRepository();
  const importJob: SgpDataImportJob = {
    jobId: 'import-roundtrip', uploadId: 'upload-roundtrip', status: 'queued', stage: 'queued', progress: 5, stageProgress: 0,
    fileName: exported.fileName!, filePath: exported.filePath!, fileSha256: await sha256File(exported.filePath!),
    sizeBytes: (await stat(exported.filePath!)).size, mode: 'merge',
    totals: { devices: preview.metadata.deviceCount, measurements: preview.metadata.measurementCount, spectrum: preview.metadata.spectrumCount, placementConfigs: preview.metadata.placementConfigCount },
    processed: { devices: 0, measurements: 0, spectrum: 0, placementConfigs: 0 },
    mutations: { inserted: 0, updated: 0, skipped: 0, failed: 0 }, recordsPerSecond: 0, preview,
    devices: Object.fromEntries(preview.devices.map((device) => [device.deviceId, {
      deviceId: device.deviceId, name: device.name, measurementsTotal: device.measurementsTotal,
      measurementsProcessed: 0, spectrumTotal: device.spectrumTotal, spectrumProcessed: 0, status: 'queued' as const,
    }])),
    events: [], createdAt: now, updatedAt: now,
  };
  await importRepository.save(importJob);
  new SgpDataImportWorker(importRepository, deviceService, telemetryService, spectrumService, auditService).enqueue(importJob.jobId);
  const imported = await waitForImport(importRepository, importJob.jobId);

  assert.equal(imported.status, 'completed');
  assert.equal(importedDevices.length, 1);
  assert.deepEqual(importedTelemetry.map((point) => point.telemetryUuid), ['telemetry-1', 'telemetry-2']);
  assert.deepEqual(importedPlacements[0], { deviceId: metadata.deviceId, config: placement });
  assert.equal(importedSpectrum[0]?.contentBase64, spectrumFrame.contentBase64);
});
