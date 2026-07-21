import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { DataExportJob, DataExportJobRepository } from '../data-export/data-export-job.repository.js';
import type { DeviceService } from '../device/device.service.js';
import type { SgpDataExportWorker } from './sgpdata-export.worker.js';

const DEFAULT_EXPORT_TTL_MS = 24 * 60 * 60 * 1_000;

type ExportServiceOptions = {
  exportDir?: string;
  ttlMs?: number;
};

export class SgpDataExportService {
  readonly exportDir: string;
  private readonly ttlMs: number;

  constructor(
    private readonly jobs: DataExportJobRepository,
    private readonly deviceService: DeviceService,
    private readonly worker: SgpDataExportWorker,
    options: ExportServiceOptions = {},
  ) {
    this.exportDir = options.exportDir ?? join(process.cwd(), 'storage', 'exports');
    this.ttlMs = options.ttlMs ?? DEFAULT_EXPORT_TTL_MS;
  }

  async initialize(interruptedAt = new Date().toISOString()): Promise<void> {
    await mkdir(this.exportDir, { recursive: true });
    await this.jobs.markActiveJobsInterrupted(interruptedAt, 'server_restarted');
    await this.cleanupExpired();
    const timer = setInterval(() => void this.cleanupExpired(), Math.min(this.ttlMs, 60 * 60 * 1_000));
    timer.unref();
  }

  async createJob(input: {
    range: { from: string; to: string };
    deviceId?: string;
    createdBy?: string;
  }): Promise<DataExportJob> {
    if (input.deviceId && !this.deviceService.getMetadata(input.deviceId)) throw new Error('device_not_found');
    const now = new Date().toISOString();
    const job: DataExportJob = {
      jobId: randomUUID(),
      status: 'queued',
      progress: 0,
      stage: 'Đang chờ export',
      range: input.range,
      deviceId: input.deviceId,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    };
    await this.jobs.save(job);
    this.worker.enqueue(job.jobId);
    return job;
  }

  async getJob(jobId: string): Promise<DataExportJob | null> {
    await this.cleanupExpired();
    return await this.jobs.get(jobId);
  }

  async listJobs(limit = 20): Promise<DataExportJob[]> {
    await this.cleanupExpired();
    return await this.jobs.list(limit);
  }

  async cleanupExpired(): Promise<void> {
    const expired = await this.jobs.deleteExpired(new Date().toISOString());
    await Promise.all(expired.map((job) => job.filePath ? unlink(job.filePath).catch(() => undefined) : undefined));
  }
}
