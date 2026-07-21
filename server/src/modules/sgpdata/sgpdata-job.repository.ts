import type { MySqlAccess } from '../persistence/mysql-access.js';
import type {
  SgpDataImportCheckpoint,
  SgpDataImportCounts,
  SgpDataImportDeviceProgress,
  SgpDataImportJob,
  SgpDataImportMode,
  SgpDataImportStage,
  SgpDataImportStatus,
  SgpDataJobEvent,
  SgpDataMutationCounts,
  SgpDataPreview,
} from './sgpdata.types.js';

type SgpDataImportJobRow = {
  job_id: string;
  upload_id: string;
  status: string;
  stage: string;
  progress: number | string;
  stage_progress: number | string;
  file_name: string;
  file_path: string;
  file_sha256: string;
  size_bytes: number | string;
  mode: string;
  total_devices: number | string;
  total_measurements: number | string;
  total_spectrum: number | string;
  total_placement_configs: number | string;
  processed_devices: number | string;
  processed_measurements: number | string;
  processed_spectrum: number | string;
  processed_placement_configs: number | string;
  inserted_count: number | string;
  updated_count: number | string;
  skipped_count: number | string;
  failed_count: number | string;
  current_device_id: string | null;
  records_per_second: number | string;
  estimated_seconds_remaining: number | string | null;
  preview_json: string | SgpDataPreview | null;
  devices_json: string | Record<string, SgpDataImportDeviceProgress> | null;
  events_json: string | SgpDataJobEvent[] | null;
  checkpoint_json: string | SgpDataImportCheckpoint | null;
  error: string | null;
  created_by: string | null;
  worker_run_id: string | null;
  created_at: string | Date;
  started_at: string | Date | null;
  updated_at: string | Date;
  completed_at: string | Date | null;
  expires_at: string | Date | null;
};

export interface SgpDataJobRepository {
  save(job: SgpDataImportJob): Promise<void>;
  update(job: SgpDataImportJob): Promise<void>;
  get(jobId: string): Promise<SgpDataImportJob | null>;
  getByUploadId(uploadId: string): Promise<SgpDataImportJob | null>;
  list(limit?: number): Promise<SgpDataImportJob[]>;
  deleteExpired(nowIso: string): Promise<SgpDataImportJob[]>;
  markActiveJobsInterrupted(interruptedAt: string, reason: string): Promise<number>;
}

const STATUSES = new Set<SgpDataImportStatus>([
  'uploading', 'validating', 'preview_ready', 'queued', 'running', 'completed', 'failed', 'interrupted',
]);
const STAGES = new Set<SgpDataImportStage>([
  'uploading', 'validating', 'preview_ready', 'queued', 'importing_devices', 'importing_telemetry',
  'importing_placement_configs', 'importing_spectrum', 'rebuilding_summaries', 'completed', 'failed', 'interrupted',
]);

function toIso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return normalized.endsWith('Z') ? normalized : `${normalized}Z`;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJson<T>(value: string | T | null, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function counts(row: SgpDataImportJobRow, prefix: 'total' | 'processed'): SgpDataImportCounts {
  return {
    devices: Math.max(0, Math.floor(toNumber(row[`${prefix}_devices`]))),
    measurements: Math.max(0, Math.floor(toNumber(row[`${prefix}_measurements`]))),
    spectrum: Math.max(0, Math.floor(toNumber(row[`${prefix}_spectrum`]))),
    placementConfigs: Math.max(0, Math.floor(toNumber(row[`${prefix}_placement_configs`]))),
  };
}

function mutations(row: SgpDataImportJobRow): SgpDataMutationCounts {
  return {
    inserted: Math.max(0, Math.floor(toNumber(row.inserted_count))),
    updated: Math.max(0, Math.floor(toNumber(row.updated_count))),
    skipped: Math.max(0, Math.floor(toNumber(row.skipped_count))),
    failed: Math.max(0, Math.floor(toNumber(row.failed_count))),
  };
}

function toJob(row: SgpDataImportJobRow): SgpDataImportJob {
  return {
    jobId: row.job_id,
    uploadId: row.upload_id,
    status: STATUSES.has(row.status as SgpDataImportStatus) ? row.status as SgpDataImportStatus : 'failed',
    stage: STAGES.has(row.stage as SgpDataImportStage) ? row.stage as SgpDataImportStage : 'failed',
    progress: Math.max(0, Math.min(100, Math.round(toNumber(row.progress)))),
    stageProgress: Math.max(0, Math.min(100, Math.round(toNumber(row.stage_progress)))),
    fileName: row.file_name,
    filePath: row.file_path,
    fileSha256: row.file_sha256,
    sizeBytes: Math.max(0, Math.floor(toNumber(row.size_bytes))),
    mode: row.mode === 'idempotent' ? 'idempotent' : 'merge',
    totals: counts(row, 'total'),
    processed: counts(row, 'processed'),
    mutations: mutations(row),
    currentDeviceId: row.current_device_id ?? undefined,
    recordsPerSecond: Math.max(0, toNumber(row.records_per_second)),
    estimatedSecondsRemaining: row.estimated_seconds_remaining === null
      ? undefined
      : Math.max(0, Math.floor(toNumber(row.estimated_seconds_remaining))),
    preview: parseJson<SgpDataPreview | undefined>(row.preview_json, undefined),
    devices: parseJson(row.devices_json, {}),
    events: parseJson(row.events_json, []),
    checkpoint: parseJson<SgpDataImportCheckpoint | undefined>(row.checkpoint_json, undefined),
    error: row.error ?? undefined,
    createdBy: row.created_by ?? undefined,
    workerRunId: row.worker_run_id ?? undefined,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    startedAt: toIso(row.started_at),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    completedAt: toIso(row.completed_at),
    expiresAt: toIso(row.expires_at),
  };
}

function cloneJob(job: SgpDataImportJob): SgpDataImportJob {
  return structuredClone(job);
}

export class InMemorySgpDataJobRepository implements SgpDataJobRepository {
  private readonly jobs = new Map<string, SgpDataImportJob>();

  async save(job: SgpDataImportJob): Promise<void> { this.jobs.set(job.jobId, cloneJob(job)); }
  async update(job: SgpDataImportJob): Promise<void> { this.jobs.set(job.jobId, cloneJob(job)); }
  async get(jobId: string): Promise<SgpDataImportJob | null> { return this.jobs.has(jobId) ? cloneJob(this.jobs.get(jobId)!) : null; }
  async getByUploadId(uploadId: string): Promise<SgpDataImportJob | null> {
    const job = [...this.jobs.values()].find((candidate) => candidate.uploadId === uploadId);
    return job ? cloneJob(job) : null;
  }
  async list(limit = 20): Promise<SgpDataImportJob[]> {
    return [...this.jobs.values()]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(cloneJob);
  }
  async deleteExpired(nowIso: string): Promise<SgpDataImportJob[]> {
    const now = Date.parse(nowIso);
    const expired = [...this.jobs.values()].filter((job) => job.expiresAt && Date.parse(job.expiresAt) < now);
    for (const job of expired) this.jobs.delete(job.jobId);
    return expired.map(cloneJob);
  }
  async markActiveJobsInterrupted(interruptedAt: string, reason: string): Promise<number> {
    let changed = 0;
    for (const job of this.jobs.values()) {
      if (!['uploading', 'validating', 'queued', 'running'].includes(job.status)) continue;
      job.status = 'interrupted';
      job.stage = 'interrupted';
      job.progress = Math.min(99, job.progress);
      job.stageProgress = 100;
      job.error = reason;
      job.completedAt = interruptedAt;
      job.updatedAt = interruptedAt;
      changed += 1;
    }
    return changed;
  }
}

const SELECT_COLUMNS = `
  job_id, upload_id, status, stage, progress, stage_progress, file_name, file_path, file_sha256,
  size_bytes, mode, total_devices, total_measurements, total_spectrum, total_placement_configs,
  processed_devices, processed_measurements, processed_spectrum, processed_placement_configs,
  inserted_count, updated_count, skipped_count, failed_count, current_device_id,
  records_per_second, estimated_seconds_remaining, preview_json, devices_json, events_json,
  checkpoint_json, error, created_by, worker_run_id, created_at, started_at, updated_at,
  completed_at, expires_at
`;

export class MySqlSgpDataJobRepository implements SgpDataJobRepository {
  constructor(private readonly mysql: MySqlAccess) {}

  async save(job: SgpDataImportJob): Promise<void> { await this.persist(job); }
  async update(job: SgpDataImportJob): Promise<void> { await this.persist(job); }

  async get(jobId: string): Promise<SgpDataImportJob | null> {
    const rows = await this.mysql.query<SgpDataImportJobRow>(
      `SELECT ${SELECT_COLUMNS} FROM data_import_jobs WHERE job_id = ? LIMIT 1`,
      [jobId],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async getByUploadId(uploadId: string): Promise<SgpDataImportJob | null> {
    const rows = await this.mysql.query<SgpDataImportJobRow>(
      `SELECT ${SELECT_COLUMNS} FROM data_import_jobs WHERE upload_id = ? LIMIT 1`,
      [uploadId],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async list(limit = 20): Promise<SgpDataImportJob[]> {
    const rows = await this.mysql.query<SgpDataImportJobRow>(
      `SELECT ${SELECT_COLUMNS} FROM data_import_jobs ORDER BY created_at DESC, job_id DESC LIMIT ?`,
      [Math.max(1, Math.min(100, Math.floor(limit)))],
    );
    return rows.map(toJob);
  }

  async deleteExpired(nowIso: string): Promise<SgpDataImportJob[]> {
    const rows = await this.mysql.query<SgpDataImportJobRow>(
      `SELECT ${SELECT_COLUMNS} FROM data_import_jobs WHERE expires_at IS NOT NULL AND expires_at < ?`,
      [nowIso],
    );
    if (rows.length === 0) return [];
    const placeholders = rows.map(() => '?').join(', ');
    await this.mysql.execute(`DELETE FROM data_import_jobs WHERE job_id IN (${placeholders})`, rows.map((row) => row.job_id));
    return rows.map(toJob);
  }

  async markActiveJobsInterrupted(interruptedAt: string, reason: string): Promise<number> {
    return await this.mysql.execute(
      `UPDATE data_import_jobs
       SET status = 'interrupted', stage = 'interrupted', stage_progress = 100,
           error = ?, completed_at = ?, updated_at = ?
       WHERE status IN ('uploading', 'validating', 'queued', 'running')`,
      [reason, interruptedAt, interruptedAt],
    );
  }

  private async persist(job: SgpDataImportJob): Promise<void> {
    const values = [
      job.jobId, job.uploadId, job.status, job.stage, job.progress, job.stageProgress,
      job.fileName, job.filePath, job.fileSha256, job.sizeBytes, job.mode,
      job.totals.devices, job.totals.measurements, job.totals.spectrum, job.totals.placementConfigs,
      job.processed.devices, job.processed.measurements, job.processed.spectrum, job.processed.placementConfigs,
      job.mutations.inserted, job.mutations.updated, job.mutations.skipped, job.mutations.failed,
      job.currentDeviceId ?? null, job.recordsPerSecond, job.estimatedSecondsRemaining ?? null,
      job.preview ? JSON.stringify(job.preview) : null, JSON.stringify(job.devices), JSON.stringify(job.events.slice(-20)),
      job.checkpoint ? JSON.stringify(job.checkpoint) : null, job.error ?? null, job.createdBy ?? null,
      job.workerRunId ?? null, job.createdAt, job.startedAt ?? null, job.updatedAt,
      job.completedAt ?? null, job.expiresAt ?? null,
    ];
    await this.mysql.execute(
      `INSERT INTO data_import_jobs (
         job_id, upload_id, status, stage, progress, stage_progress, file_name, file_path, file_sha256,
         size_bytes, mode, total_devices, total_measurements, total_spectrum, total_placement_configs,
         processed_devices, processed_measurements, processed_spectrum, processed_placement_configs,
         inserted_count, updated_count, skipped_count, failed_count, current_device_id,
         records_per_second, estimated_seconds_remaining, preview_json, devices_json, events_json,
         checkpoint_json, error, created_by, worker_run_id, created_at, started_at, updated_at,
         completed_at, expires_at
       ) VALUES (${values.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE
         upload_id = VALUES(upload_id), status = VALUES(status), stage = VALUES(stage),
         progress = VALUES(progress), stage_progress = VALUES(stage_progress), file_name = VALUES(file_name),
         file_path = VALUES(file_path), file_sha256 = VALUES(file_sha256), size_bytes = VALUES(size_bytes),
         mode = VALUES(mode), total_devices = VALUES(total_devices), total_measurements = VALUES(total_measurements),
         total_spectrum = VALUES(total_spectrum), total_placement_configs = VALUES(total_placement_configs),
         processed_devices = VALUES(processed_devices), processed_measurements = VALUES(processed_measurements),
         processed_spectrum = VALUES(processed_spectrum), processed_placement_configs = VALUES(processed_placement_configs),
         inserted_count = VALUES(inserted_count), updated_count = VALUES(updated_count),
         skipped_count = VALUES(skipped_count), failed_count = VALUES(failed_count),
         current_device_id = VALUES(current_device_id), records_per_second = VALUES(records_per_second),
         estimated_seconds_remaining = VALUES(estimated_seconds_remaining), preview_json = VALUES(preview_json),
         devices_json = VALUES(devices_json), events_json = VALUES(events_json), checkpoint_json = VALUES(checkpoint_json),
         error = VALUES(error), created_by = VALUES(created_by), worker_run_id = VALUES(worker_run_id),
         started_at = VALUES(started_at), updated_at = VALUES(updated_at), completed_at = VALUES(completed_at),
         expires_at = VALUES(expires_at)`,
      values,
    );
  }
}

export function createSgpDataJobRepository(mysql: MySqlAccess | null): SgpDataJobRepository {
  return mysql ? new MySqlSgpDataJobRepository(mysql) : new InMemorySgpDataJobRepository();
}
