export type DataExportJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type DataExportJobRange = {
  from: string;
  to: string;
};

export type DataExportJobManifest = Record<string, unknown>;

export type DataExportJob = {
  jobId: string;
  status: DataExportJobStatus;
  progress: number;
  stage: string;
  createdAt: string;
  updatedAt: string;
  range: DataExportJobRange;
  deviceId?: string;
  createdBy?: string;
  workerRunId?: string;
  fileName?: string;
  filePath?: string;
  sizeBytes?: number;
  error?: string;
  manifest?: DataExportJobManifest;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
};

export interface DataExportJobRepository {
  save(job: DataExportJob): Promise<void>;
  update(job: DataExportJob): Promise<void>;
  get(jobId: string): Promise<DataExportJob | null>;
  list(limit?: number): Promise<DataExportJob[]>;
  deleteExpired(nowIso: string): Promise<DataExportJob[]>;
  markActiveJobsInterrupted(interruptedAt: string, reason: string): Promise<number>;
}
