import { z } from 'zod';
import type { TelemetryPayload, TelemetryMessage } from '../../shared/types.js';
import type {
  DeviceTelemetryAvailabilityDay,
  DeviceTelemetrySummary,
  TelemetryArchiveQuery,
  TelemetryAvailabilityQuery,
  TelemetryHistoryQuery,
  TelemetryHistoryResult,
  TelemetryImportMode,
  TelemetryImportPoint,
  TelemetryImportResult,
  TelemetryRepository,
  TelemetrySummaryRebuildRange,
} from './telemetry.repository.js';
import { DeviceService } from '../device/device.service.js';

const telemetrySchema = z.object({
  messageId: z.string().trim().min(1).max(255).optional(),
  vibration: z.number().finite().optional(),
  temperature: z.number().finite().optional(),
  temperatureAvailable: z.boolean().optional(),
  vibrationAvailable: z.boolean().optional(),
  adxlStatus: z.enum(['ok', 'fault', 'recovering']).optional(),
  adxlFaultReason: z.enum(['not_detected', 'i2c_read_error', 'capture_timeout', 'unknown']).optional(),
}).passthrough().superRefine((payload, context) => {
  if (payload.adxlStatus === 'fault' && !payload.adxlFaultReason) {
    context.addIssue({
      code: 'custom',
      message: 'adxlFaultReason is required while adxlStatus is fault',
      path: ['adxlFaultReason'],
    });
  }

  if (payload.adxlStatus !== 'fault' && payload.adxlFaultReason !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'adxlFaultReason is only valid while adxlStatus is fault',
      path: ['adxlFaultReason'],
    });
  }
});

const VIBRATION_METRIC_KEYS = [
  'vibration',
  'ax',
  'ay',
  'az',
  'vrms_x_mms',
  'vrms_y_mms',
  'vrms_z_mms',
  'vx_rms_mms',
  'vy_rms_mms',
  'vz_rms_mms',
  'vrms_unit',
  'drms_x_um',
  'drms_y_um',
  'drms_z_um',
  'drms_band_min_hz',
  'drms_band_max_hz',
  'drms_unit',
  'sample_count',
  'sampleCount',
  'sample_rate_hz',
  'sampleRateHz',
  'lsb_per_g',
  'lsbPerG',
  'telemetry_uuid',
  'telemetryUuid',
] as const;

const VIBRATION_VALUE_KEYS = [
  'vibration',
  'ax',
  'ay',
  'az',
  'vrms_x_mms',
  'vrms_y_mms',
  'vrms_z_mms',
  'vx_rms_mms',
  'vy_rms_mms',
  'vz_rms_mms',
  'drms_x_um',
  'drms_y_um',
  'drms_z_um',
  'drms_band_min_hz',
  'drms_band_max_hz',
] as const;

function hasValidVibration(payload: TelemetryPayload): boolean {
  return VIBRATION_VALUE_KEYS.some((key) => {
    const value = payload[key];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

function normalizePayload(payload: TelemetryPayload): TelemetryPayload {
  const normalized: TelemetryPayload = { ...payload };
  const vibrationAvailable =
    typeof normalized.vibrationAvailable === 'boolean'
      ? normalized.vibrationAvailable
      : hasValidVibration(normalized)
        ? true
        : undefined;

  if (vibrationAvailable !== undefined) {
    normalized.vibrationAvailable = vibrationAvailable;
  }
  if (normalized.temperatureAvailable === undefined && typeof normalized.temperature === 'number') {
    normalized.temperatureAvailable = true;
  }
  if (normalized.temperatureAvailable === false) {
    delete normalized.temperature;
  }
  if (vibrationAvailable === false) {
    for (const key of VIBRATION_METRIC_KEYS) {
      delete normalized[key];
    }
  }

  return normalized;
}

export class TelemetryService {
  constructor(
    private readonly repository: TelemetryRepository,
    private readonly deviceService: DeviceService,
  ) {}

  ingest(deviceId: string, rawPayload: unknown): TelemetryMessage {
    const payload = normalizePayload(telemetrySchema.parse(rawPayload));
    const message: TelemetryMessage = {
      deviceId,
      receivedAt: new Date().toISOString(),
      payload,
    };

    this.deviceService.heartbeat(deviceId);
    this.repository.setLast(message);
    return message;
  }

  getLast(): TelemetryMessage | null {
    return this.repository.getLast();
  }

  async listHistory(query: TelemetryHistoryQuery): Promise<TelemetryHistoryResult> {
    return await this.repository.listHistory(query);
  }

  async listAvailableDays(query: TelemetryAvailabilityQuery): Promise<DeviceTelemetryAvailabilityDay[]> {
    return await this.repository.listAvailableDays(query);
  }

  async summarizeDevice(deviceId: string): Promise<DeviceTelemetrySummary> {
    return await this.repository.summarizeDevice(deviceId);
  }

  async exportHistory(query: TelemetryArchiveQuery): Promise<TelemetryImportPoint[]> {
    return await this.repository.exportHistory(query);
  }

  async countArchive(query: TelemetryArchiveQuery): Promise<number> {
    return await this.repository.countArchive(query);
  }

  exportHistoryBatches(query: TelemetryArchiveQuery, batchSize?: number): AsyncIterable<TelemetryImportPoint[]> {
    return this.repository.exportHistoryBatches(query, batchSize);
  }

  async importHistory(points: TelemetryImportPoint[]): Promise<TelemetryImportResult> {
    return await this.repository.importHistory(points);
  }

  async importHistoryBatch(points: TelemetryImportPoint[], mode: TelemetryImportMode): Promise<TelemetryImportResult> {
    return await this.repository.importHistoryBatch(points, mode);
  }

  async deleteHistoryRange(range: TelemetrySummaryRebuildRange): Promise<number> {
    return await this.repository.deleteHistoryRange(range);
  }

  async rebuildHourlySummaries(ranges: TelemetrySummaryRebuildRange[]): Promise<void> {
    await this.repository.rebuildHourlySummaries(ranges);
  }

  async applyRetention(): Promise<{ removed: number; kept: number; cutoffAt: string } | null> {
    return await this.repository.applyRetention();
  }
}
