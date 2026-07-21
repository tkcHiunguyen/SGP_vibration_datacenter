import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemorySgpDataJobRepository } from './sgpdata-job.repository.js';
import type { SgpDataImportJob } from './sgpdata.types.js';

function createJob(status: SgpDataImportJob['status']): SgpDataImportJob {
  const now = new Date().toISOString();
  return {
    jobId: 'job-1', uploadId: 'upload-1', status, stage: status === 'running' ? 'importing_telemetry' : 'preview_ready',
    progress: 42, stageProgress: 50, fileName: 'data.sgpdata', filePath: 'data.sgpdata', fileSha256: 'a'.repeat(64),
    sizeBytes: 100, mode: 'merge', totals: { devices: 1, measurements: 10, spectrum: 0, placementConfigs: 0 },
    processed: { devices: 1, measurements: 4, spectrum: 0, placementConfigs: 0 },
    mutations: { inserted: 5, updated: 0, skipped: 0, failed: 0 }, recordsPerSecond: 10,
    devices: {}, events: [], createdAt: now, updatedAt: now,
  };
}

test('active persistent import jobs become explicitly interrupted after restart', async () => {
  const repository = new InMemorySgpDataJobRepository();
  await repository.save(createJob('running'));
  const interruptedAt = '2026-07-21T10:00:00.000Z';
  assert.equal(await repository.markActiveJobsInterrupted(interruptedAt, 'server_restarted'), 1);
  const job = await repository.get('job-1');
  assert.equal(job?.status, 'interrupted');
  assert.equal(job?.stage, 'interrupted');
  assert.equal(job?.error, 'server_restarted');
  assert.equal(job?.completedAt, interruptedAt);
});

test('preview-ready uploads survive restart without being marked interrupted', async () => {
  const repository = new InMemorySgpDataJobRepository();
  await repository.save(createJob('preview_ready'));
  assert.equal(await repository.markActiveJobsInterrupted(new Date().toISOString(), 'server_restarted'), 0);
  assert.equal((await repository.get('job-1'))?.status, 'preview_ready');
});
