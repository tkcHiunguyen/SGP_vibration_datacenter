import type { DataExportJob, DataExportJobRepository } from './data-export-job.repository.js';

function cloneJob(job: DataExportJob): DataExportJob {
  return {
    ...job,
    range: { ...job.range },
    manifest: job.manifest ? { ...job.manifest } : undefined,
  };
}

export class InMemoryDataExportJobRepository implements DataExportJobRepository {
  private readonly jobs = new Map<string, DataExportJob>();

  async save(job: DataExportJob): Promise<void> {
    this.jobs.set(job.jobId, cloneJob(job));
  }

  async update(job: DataExportJob): Promise<void> {
    this.jobs.set(job.jobId, cloneJob(job));
  }

  async get(jobId: string): Promise<DataExportJob | null> {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : null;
  }

  async list(limit = 20): Promise<DataExportJob[]> {
    return [...this.jobs.values()]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit)
      .map(cloneJob);
  }

  async deleteExpired(nowIso: string): Promise<DataExportJob[]> {
    const nowMs = Date.parse(nowIso);
    if (!Number.isFinite(nowMs)) {
      return [];
    }

    const expired: DataExportJob[] = [];
    for (const job of this.jobs.values()) {
      const expiresMs = job.expiresAt ? Date.parse(job.expiresAt) : Number.POSITIVE_INFINITY;
      if (Number.isFinite(expiresMs) && expiresMs < nowMs) {
        expired.push(cloneJob(job));
      }
    }
    for (const job of expired) {
      this.jobs.delete(job.jobId);
    }
    return expired;
  }

  async markActiveJobsInterrupted(interruptedAt: string, reason: string): Promise<number> {
    let updated = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== 'queued' && job.status !== 'running') {
        continue;
      }
      this.jobs.set(job.jobId, {
        ...job,
        status: 'failed',
        progress: 100,
        stage: 'Export bị gián đoạn',
        error: reason,
        completedAt: interruptedAt,
        updatedAt: interruptedAt,
      });
      updated += 1;
    }
    return updated;
  }
}
