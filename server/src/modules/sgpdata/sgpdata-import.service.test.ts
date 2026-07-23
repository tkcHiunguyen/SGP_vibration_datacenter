import assert from 'node:assert/strict';
import test from 'node:test';

import { SgpDataImportService } from './sgpdata-import.service.js';
import type { SgpDataImportWorker } from './sgpdata-import.worker.js';
import { InMemorySgpDataJobRepository } from './sgpdata-job.repository.js';
import type { SgpDataImportJob } from './sgpdata.types.js';

function previewReadyJob(): SgpDataImportJob {
  const now = new Date().toISOString();
  return {
    jobId: 'job-no-range',
    uploadId: 'upload-no-range',
    status: 'preview_ready',
    stage: 'preview_ready',
    progress: 5,
    stageProgress: 100,
    fileName: 'legacy.sgpdata',
    filePath: 'legacy.sgpdata',
    fileSha256: '0'.repeat(64),
    sizeBytes: 100,
    mode: 'merge',
    totals: { devices: 1, measurements: 0, spectrum: 0, placementConfigs: 0 },
    processed: { devices: 0, measurements: 0, spectrum: 0, placementConfigs: 0 },
    mutations: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
    recordsPerSecond: 0,
    preview: {
      manifest: { format: 'sgpdata', version: 2 },
      metadata: { deviceCount: 1, measurementCount: 0, spectrumCount: 0, placementConfigCount: 0, checksumValid: true },
      devices: [{ deviceId: 'ESP-LEGACY', measurementsTotal: 0, spectrumTotal: 0 }],
      measurements: 0,
      spectra: 0,
    },
    devices: {
      'ESP-LEGACY': {
        deviceId: 'ESP-LEGACY', measurementsTotal: 0, measurementsProcessed: 0,
        spectrumTotal: 0, spectrumProcessed: 0, status: 'queued',
      },
    },
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

test('replace mode requires a valid archive date range while merge remains available', async () => {
  const jobs = new InMemorySgpDataJobRepository();
  const enqueued: string[] = [];
  const worker = { enqueue: (jobId: string) => enqueued.push(jobId) } as unknown as SgpDataImportWorker;
  const service = new SgpDataImportService(jobs, worker);
  await jobs.save(previewReadyJob());

  await assert.rejects(service.createJob('upload-no-range', 'replace'), /sgpdata_replace_range_required/);
  assert.deepEqual(enqueued, []);

  const queued = await service.createJob('upload-no-range', 'merge');
  assert.equal(queued.mode, 'merge');
  assert.deepEqual(enqueued, ['job-no-range']);
});
