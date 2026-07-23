export type SgpPortabilityMode = "export" | "import";
export type ImportMode = "merge" | "replace";

export type Preview = {
  manifest?: Record<string, unknown>;
  metadata: {
    deviceCount: number;
    measurementCount: number;
    spectrumCount: number;
    placementConfigCount: number;
    zoneCount?: number;
    dateFrom?: string;
    dateTo?: string;
    checksumSha256?: string;
    checksumValid: boolean;
  };
  dateRange?: { from?: string; to?: string };
  devices: Array<{
    deviceId: string;
    name?: string;
    site?: string;
    zone?: string;
    firmwareVersion?: string;
    measurementsTotal?: number;
    spectrumTotal?: number;
  }>;
  measurements: number;
  spectra: number;
  uploadId?: string;
  jobId?: string;
  file?: { name?: string; sizeBytes?: number };
};

export type ImportJobStatus =
  | "uploading"
  | "validating"
  | "preview_ready"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type ImportStage =
  | "uploading"
  | "validating"
  | "preview_ready"
  | "queued"
  | "importing_zones"
  | "importing_devices"
  | "replacing_data"
  | "importing_telemetry"
  | "importing_placement_configs"
  | "importing_spectrum"
  | "rebuilding_summaries"
  | "completed"
  | "failed"
  | "interrupted";

export type ImportDeviceProgress = {
  deviceId: string;
  name?: string;
  measurementsTotal: number;
  measurementsProcessed: number;
  spectrumTotal: number;
  spectrumProcessed: number;
  status: "queued" | "running" | "completed" | "skipped" | "failed";
};

export type ImportJob = {
  jobId: string;
  uploadId: string;
  status: ImportJobStatus;
  stage: ImportStage;
  progress: number;
  overallProgress: number;
  stageProgress: number;
  fileName: string;
  sizeBytes: number;
  mode: ImportMode;
  totals: { devices: number; measurements: number; spectrum: number; placementConfigs: number };
  processed: { devices: number; measurements: number; spectrum: number; placementConfigs: number };
  processedRecords: number;
  totalRecords: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  currentDeviceId?: string;
  recordsPerSecond: number;
  estimatedSecondsRemaining?: number;
  elapsedSeconds: number;
  preview?: Preview;
  devices?: ImportDeviceProgress[];
  events?: Array<{ at: string; stage: ImportStage; message: string }>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt?: string;
};

export type ExportJobStatus = "queued" | "running" | "completed" | "failed";
export type ExportJob = {
  jobId: string;
  status: ExportJobStatus;
  progress: number;
  stage: string;
  createdAt: string;
  updatedAt: string;
  range?: { from?: string; to?: string };
  deviceId?: string;
  fileName?: string;
  sizeBytes?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  manifest?: {
    deviceCount?: number;
    measurementCount?: number;
    spectrumFrameCount?: number;
    placementConfigCount?: number;
    zoneCount?: number;
  };
};
