import type { MySqlAccess } from '../persistence/mysql-access.js';
import type { DataExportJob, DataExportJobManifest, DataExportJobRepository, DataExportJobStatus } from './data-export-job.repository.js';

type DataExportJobRow = {
  job_id: string;
  status: string;
  progress: number | string;
  stage: string;
  date_from: string | Date;
  date_to: string | Date;
  device_id: string | null;
  created_by: string | null;
  worker_run_id: string | null;
  file_name: string | null;
  file_path: string | null;
  size_bytes: number | string | null;
  manifest_json: string | Record<string, unknown> | null;
  error: string | null;
  created_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  expires_at: string | Date | null;
  updated_at: string | Date;
};

const JOB_STATUSES = new Set<DataExportJobStatus>(['queued', 'running', 'completed', 'failed']);

function toIsoTimestamp(value: string | Date | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return normalized.endsWith('Z') ? normalized : `${normalized}Z`;
}

function normalizeStatus(value: string): DataExportJobStatus {
  return JOB_STATUSES.has(value as DataExportJobStatus) ? (value as DataExportJobStatus) : 'failed';
}

function toOptionalText(value: string | null): string | undefined {
  return value && value.trim() ? value : undefined;
}

function toOptionalNumber(value: number | string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseManifest(value: string | Record<string, unknown> | null): DataExportJobManifest | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return { ...value };
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as DataExportJobManifest) : undefined;
  } catch {
    return undefined;
  }
}

function toJob(row: DataExportJobRow): DataExportJob {
  return {
    jobId: row.job_id,
    status: normalizeStatus(row.status),
    progress: Math.max(0, Math.min(100, Math.round(Number(row.progress) || 0))),
    stage: row.stage,
    createdAt: toIsoTimestamp(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoTimestamp(row.updated_at) ?? new Date().toISOString(),
    range: {
      from: toIsoTimestamp(row.date_from) ?? new Date().toISOString(),
      to: toIsoTimestamp(row.date_to) ?? new Date().toISOString(),
    },
    deviceId: toOptionalText(row.device_id),
    createdBy: toOptionalText(row.created_by),
    workerRunId: toOptionalText(row.worker_run_id),
    fileName: toOptionalText(row.file_name),
    filePath: toOptionalText(row.file_path),
    sizeBytes: toOptionalNumber(row.size_bytes),
    manifest: parseManifest(row.manifest_json),
    error: toOptionalText(row.error),
    startedAt: toIsoTimestamp(row.started_at),
    completedAt: toIsoTimestamp(row.completed_at),
    expiresAt: toIsoTimestamp(row.expires_at),
  };
}

const SELECT_COLUMNS = `
  job_id, status, progress, stage, date_from, date_to, device_id, created_by,
  worker_run_id, file_name, file_path, size_bytes, manifest_json, error,
  created_at, started_at, completed_at, expires_at, updated_at
`;

export class MySqlDataExportJobRepository implements DataExportJobRepository {
  private constructor(private readonly mysql: MySqlAccess) {}

  static async create(mysql: MySqlAccess): Promise<MySqlDataExportJobRepository> {
    return new MySqlDataExportJobRepository(mysql);
  }

  async save(job: DataExportJob): Promise<void> {
    await this.persistJob(job);
  }

  async update(job: DataExportJob): Promise<void> {
    await this.persistJob(job);
  }

  async get(jobId: string): Promise<DataExportJob | null> {
    const rows = await this.mysql.query<DataExportJobRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM data_export_jobs
        WHERE job_id = ?
        LIMIT 1
      `,
      [jobId],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async list(limit = 20): Promise<DataExportJob[]> {
    const rows = await this.mysql.query<DataExportJobRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM data_export_jobs
        ORDER BY created_at DESC, job_id DESC
        LIMIT ?
      `,
      [Math.max(1, Math.min(100, Math.floor(limit)))],
    );
    return rows.map(toJob);
  }

  async deleteExpired(nowIso: string): Promise<DataExportJob[]> {
    const expired = await this.mysql.query<DataExportJobRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM data_export_jobs
        WHERE expires_at IS NOT NULL AND expires_at < ?
      `,
      [nowIso],
    );
    if (expired.length === 0) {
      return [];
    }

    const placeholders = expired.map(() => '?').join(', ');
    await this.mysql.execute(`DELETE FROM data_export_jobs WHERE job_id IN (${placeholders})`, expired.map((row) => row.job_id));
    return expired.map(toJob);
  }

  async markActiveJobsInterrupted(interruptedAt: string, reason: string): Promise<number> {
    return await this.mysql.execute(
      `
        UPDATE data_export_jobs
        SET status = 'failed', progress = 100, stage = ?, error = ?, completed_at = ?, updated_at = ?
        WHERE status IN ('queued', 'running')
      `,
      ['Export bị gián đoạn', reason, interruptedAt, interruptedAt],
    );
  }

  private async persistJob(job: DataExportJob): Promise<void> {
    await this.mysql.execute(
      `
        INSERT INTO data_export_jobs (
          job_id, status, progress, stage, date_from, date_to, device_id, created_by,
          worker_run_id, file_name, file_path, size_bytes, manifest_json, error,
          created_at, started_at, completed_at, expires_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          progress = VALUES(progress),
          stage = VALUES(stage),
          date_from = VALUES(date_from),
          date_to = VALUES(date_to),
          device_id = VALUES(device_id),
          created_by = VALUES(created_by),
          worker_run_id = VALUES(worker_run_id),
          file_name = VALUES(file_name),
          file_path = VALUES(file_path),
          size_bytes = VALUES(size_bytes),
          manifest_json = VALUES(manifest_json),
          error = VALUES(error),
          started_at = VALUES(started_at),
          completed_at = VALUES(completed_at),
          expires_at = VALUES(expires_at),
          updated_at = VALUES(updated_at)
      `,
      [
        job.jobId,
        job.status,
        job.progress,
        job.stage,
        job.range.from,
        job.range.to,
        job.deviceId ?? null,
        job.createdBy ?? null,
        job.workerRunId ?? null,
        job.fileName ?? null,
        job.filePath ?? null,
        job.sizeBytes ?? null,
        job.manifest ? JSON.stringify(job.manifest) : null,
        job.error ?? null,
        job.createdAt,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.expiresAt ?? null,
        job.updatedAt,
      ],
    );
  }
}
