import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { SgpDataJobRepository } from './sgpdata-job.repository.js';
import { inspectSgpDataFile } from './sgpdata-parser.js';
import type { SgpDataImportJob, SgpDataImportMode } from './sgpdata.types.js';
import type { SgpDataImportWorker } from './sgpdata-import.worker.js';

const DEFAULT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

type UploadInput = {
  fileName: string;
  stream: Readable;
  createdBy?: string;
};

type ImportServiceOptions = {
  uploadDir?: string;
  ttlMs?: number;
  maxUploadBytes?: number;
};

function createEmptyJob({
  jobId,
  uploadId,
  fileName,
  filePath,
  createdBy,
  expiresAt,
}: {
  jobId: string;
  uploadId: string;
  fileName: string;
  filePath: string;
  createdBy?: string;
  expiresAt: string;
}): SgpDataImportJob {
  const now = new Date().toISOString();
  return {
    jobId,
    uploadId,
    status: 'uploading',
    stage: 'uploading',
    progress: 0,
    stageProgress: 0,
    fileName,
    filePath,
    fileSha256: '',
    sizeBytes: 0,
    mode: 'merge',
    totals: { devices: 0, measurements: 0, spectrum: 0, placementConfigs: 0 },
    processed: { devices: 0, measurements: 0, spectrum: 0, placementConfigs: 0 },
    mutations: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
    recordsPerSecond: 0,
    devices: {},
    events: [{ at: now, stage: 'uploading', message: 'Đang nhận file upload' }],
    createdBy,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
}

export class SgpDataImportService {
  private readonly uploadDir: string;
  private readonly ttlMs: number;
  private readonly maxUploadBytes: number;

  constructor(
    private readonly jobs: SgpDataJobRepository,
    private readonly worker: SgpDataImportWorker,
    options: ImportServiceOptions = {},
  ) {
    this.uploadDir = options.uploadDir ?? join(process.cwd(), 'storage', 'imports');
    this.ttlMs = options.ttlMs ?? DEFAULT_UPLOAD_TTL_MS;
    this.maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  }

  async initialize(interruptedAt = new Date().toISOString()): Promise<void> {
    await mkdir(this.uploadDir, { recursive: true });
    await this.jobs.markActiveJobsInterrupted(interruptedAt, 'server_restarted');
    await this.cleanupExpired();
    const timer = setInterval(() => void this.cleanupExpired(), Math.min(this.ttlMs, 60 * 60 * 1_000));
    timer.unref();
  }

  async storeUpload(input: UploadInput): Promise<SgpDataImportJob> {
    const fileName = input.fileName.trim() || 'import.sgpdata';
    if (!fileName.toLowerCase().endsWith('.sgpdata')) throw new Error('sgpdata_file_extension_invalid');
    const uploadId = randomUUID();
    const jobId = randomUUID();
    const filePath = join(this.uploadDir, `${uploadId}.sgpdata`);
    const job = createEmptyJob({
      jobId,
      uploadId,
      fileName,
      filePath,
      createdBy: input.createdBy,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    });
    await this.jobs.save(job);

    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        sizeBytes += chunk.length;
        if (sizeBytes > this.maxUploadBytes) {
          callback(new Error('sgpdata_file_too_large'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(input.stream, meter, createWriteStream(filePath, { flags: 'wx' }));
      if (sizeBytes === 0) throw new Error('sgpdata_file_empty');
      job.sizeBytes = sizeBytes;
      job.fileSha256 = hash.digest('hex');
      job.status = 'validating';
      job.stage = 'validating';
      job.progress = 2;
      job.stageProgress = 0;
      job.updatedAt = new Date().toISOString();
      job.events.push({ at: job.updatedAt, stage: 'validating', message: 'Upload hoàn tất, đang kiểm tra cấu trúc và checksum' });
      await this.jobs.update(job);

      const preview = await inspectSgpDataFile(filePath);
      job.preview = preview;
      job.totals = {
        devices: preview.metadata.deviceCount,
        measurements: preview.metadata.measurementCount,
        spectrum: preview.metadata.spectrumCount,
        placementConfigs: preview.metadata.placementConfigCount,
      };
      job.devices = Object.fromEntries(preview.devices.map((device) => [device.deviceId, {
        deviceId: device.deviceId,
        name: device.name,
        measurementsTotal: device.measurementsTotal,
        measurementsProcessed: 0,
        spectrumTotal: device.spectrumTotal,
        spectrumProcessed: 0,
        status: 'queued' as const,
      }]));
      job.status = 'preview_ready';
      job.stage = 'preview_ready';
      job.progress = 5;
      job.stageProgress = 100;
      job.updatedAt = new Date().toISOString();
      job.events.push({ at: job.updatedAt, stage: 'preview_ready', message: 'File hợp lệ và sẵn sàng import' });
      await this.jobs.update(job);
      return structuredClone(job);
    } catch (error) {
      job.status = 'failed';
      job.stage = 'failed';
      job.stageProgress = 100;
      job.error = error instanceof Error ? error.message : 'sgpdata_upload_failed';
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      job.events.push({ at: job.updatedAt, stage: 'failed', message: `Không thể chuẩn bị file: ${job.error}` });
      await this.jobs.update(job);
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async getPreview(uploadId: string): Promise<SgpDataImportJob | null> {
    return await this.jobs.getByUploadId(uploadId);
  }

  async createJob(uploadId: string, mode: SgpDataImportMode): Promise<SgpDataImportJob> {
    const job = await this.jobs.getByUploadId(uploadId);
    if (!job) throw new Error('sgpdata_upload_not_found');
    if (job.status !== 'preview_ready') throw new Error('sgpdata_upload_not_ready');
    if (mode === 'replace') {
      const range = job.preview?.dateRange;
      const fromMs = range ? Date.parse(range.from) : Number.NaN;
      const toMs = range ? Date.parse(range.to) : Number.NaN;
      if (!range || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
        throw new Error('sgpdata_replace_range_required');
      }
    }
    job.mode = mode;
    job.status = 'queued';
    job.stage = 'queued';
    job.stageProgress = 0;
    job.error = undefined;
    job.updatedAt = new Date().toISOString();
    job.events.push({ at: job.updatedAt, stage: 'queued', message: 'Đã đưa job vào hàng đợi import' });
    job.events = job.events.slice(-20);
    await this.jobs.update(job);
    this.worker.enqueue(job.jobId);
    return job;
  }

  async getJob(jobId: string): Promise<SgpDataImportJob | null> {
    return await this.jobs.get(jobId);
  }

  async listJobs(limit = 20): Promise<SgpDataImportJob[]> {
    return await this.jobs.list(limit);
  }

  async cleanupExpired(): Promise<void> {
    const expired = await this.jobs.deleteExpired(new Date().toISOString());
    await Promise.all(expired.map((job) => unlink(job.filePath).catch(() => undefined)));
  }
}
