import { z } from 'zod';

export const sgpDataDeviceSchema = z.object({
  deviceId: z.string().min(1),
  uuid: z.string().optional(),
  name: z.string().optional(),
  site: z.string().optional(),
  zone: z.string().optional(),
  firmwareVersion: z.string().optional(),
  vibrationSetpoint: z.number().finite().positive().optional(),
  accelerationSetpoint: z.number().finite().positive().optional(),
  displacementSetpoint: z.number().finite().positive().optional(),
  temperatureSetpoint: z.number().finite().positive().optional(),
  axisLabels: z.object({
    ax: z.string().optional(),
    ay: z.string().optional(),
    az: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough();

export const sgpDataTelemetryPointSchema = z.object({
  deviceId: z.string().min(1),
  receivedAt: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  telemetryUuid: z.string().optional(),
  sampleCount: z.number().optional(),
}).passthrough();

export const sgpDataSpectrumFrameSchema = z.object({
  deviceId: z.string().min(1),
  capturedAt: z.string().min(1),
  telemetryUuid: z.string().optional(),
  storagePath: z.string().min(1),
  fileSizeBytes: z.number().optional(),
  checksumSha256: z.string().optional(),
  contentBase64: z.string().min(1),
}).passthrough();

export const sgpDataZoneSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).passthrough();

export const sgpDataDateRangeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const sgpDataManifestSchema = z.object({
  format: z.literal('sgpdata'),
  version: z.union([z.literal(2), z.literal(3)]),
  exportedAt: z.string().optional(),
  dateRange: sgpDataDateRangeSchema.optional(),
  deviceCount: z.number().optional(),
  measurementCount: z.number().optional(),
  spectrumFrameCount: z.number().optional(),
  placementConfigCount: z.number().optional(),
  zoneCount: z.number().optional(),
  checksumSha256: z.string().optional(),
}).passthrough();

export type SgpDataManifest = z.infer<typeof sgpDataManifestSchema>;
export type SgpDataDevice = z.infer<typeof sgpDataDeviceSchema>;
export type SgpDataTelemetryPoint = z.infer<typeof sgpDataTelemetryPointSchema>;
export type SgpDataSpectrumFrame = z.infer<typeof sgpDataSpectrumFrameSchema>;
export type SgpDataZone = z.infer<typeof sgpDataZoneSchema>;

export type SgpDataStreamEntry =
  | { type: 'manifest'; data: SgpDataManifest }
  | { type: 'zone'; data: SgpDataZone }
  | { type: 'device'; data: SgpDataDevice }
  | { type: 'measurement'; data: SgpDataTelemetryPoint }
  | { type: 'spectrumFrame'; data: SgpDataSpectrumFrame }
  | { type: 'placementConfig'; data: { deviceId: string; config: Record<string, unknown> } };

export type SgpDataImportMode = 'merge' | 'replace';

export type SgpDataImportStage =
  | 'uploading'
  | 'validating'
  | 'preview_ready'
  | 'queued'
  | 'importing_zones'
  | 'importing_devices'
  | 'replacing_data'
  | 'importing_telemetry'
  | 'importing_placement_configs'
  | 'importing_spectrum'
  | 'rebuilding_summaries'
  | 'completed'
  | 'failed'
  | 'interrupted';

export type SgpDataImportStatus =
  | 'uploading'
  | 'validating'
  | 'preview_ready'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted';

export type SgpDataImportCounts = {
  devices: number;
  measurements: number;
  spectrum: number;
  placementConfigs: number;
};

export type SgpDataMutationCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type SgpDataImportDeviceProgress = {
  deviceId: string;
  name?: string;
  measurementsTotal: number;
  measurementsProcessed: number;
  spectrumTotal: number;
  spectrumProcessed: number;
  status: 'queued' | 'running' | 'completed' | 'skipped' | 'failed';
};

export type SgpDataJobEvent = {
  at: string;
  stage: SgpDataImportStage;
  message: string;
};

export type SgpDataPreview = {
  manifest: SgpDataManifest;
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
  dateRange?: { from: string; to: string };
  devices: Array<{
    deviceId: string;
    name?: string;
    site?: string;
    zone?: string;
    firmwareVersion?: string;
    measurementsTotal: number;
    spectrumTotal: number;
  }>;
  deviceMetadata?: SgpDataDevice[];
  zones?: SgpDataZone[];
  placementConfigs?: Array<{ deviceId: string; config: Record<string, unknown> }>;
  measurements: number;
  spectra: number;
};

export type SgpDataImportCheckpoint = {
  lastEntry?: number;
  lastStage?: SgpDataImportStage;
};

export type SgpDataImportJob = {
  jobId: string;
  uploadId: string;
  status: SgpDataImportStatus;
  stage: SgpDataImportStage;
  progress: number;
  stageProgress: number;
  fileName: string;
  filePath: string;
  fileSha256: string;
  sizeBytes: number;
  mode: SgpDataImportMode;
  totals: SgpDataImportCounts;
  processed: SgpDataImportCounts;
  mutations: SgpDataMutationCounts;
  currentDeviceId?: string;
  recordsPerSecond: number;
  estimatedSecondsRemaining?: number;
  preview?: SgpDataPreview;
  devices: Record<string, SgpDataImportDeviceProgress>;
  events: SgpDataJobEvent[];
  checkpoint?: SgpDataImportCheckpoint;
  error?: string;
  createdBy?: string;
  workerRunId?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt?: string;
};
