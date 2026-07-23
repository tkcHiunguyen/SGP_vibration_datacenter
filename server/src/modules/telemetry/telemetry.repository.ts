import type { TelemetryMessage } from '../../shared/types.js';

export type TelemetryHistoryPoint = TelemetryMessage & {
  bucketStartedAt?: string;
  bucketEndedAt?: string;
  sampleCount?: number;
};

export type TelemetryHistoryQuery = {
  deviceId: string;
  from?: string;
  to?: string;
  limit?: number;
  bucketMs?: number;
};

export type TelemetryHistoryResult = {
  items: TelemetryHistoryPoint[];
  totalMatched: number;
  truncated: boolean;
  bucketMs?: number;
  from?: string | null;
  to?: string | null;
  sampleCount?: number;
  complete?: boolean;
};

export type TelemetryAvailabilityQuery = {
  deviceId: string;
  from?: string;
  to?: string;
  timezoneOffsetMinutes?: number;
  limitDays?: number;
};

export type DeviceTelemetryAvailabilityDay = {
  date: string;
  count: number;
  firstAt?: string;
  lastAt?: string;
};

export type DeviceTelemetrySummary = {
  total: number;
  latestAt?: string;
  estimatedBytes: number;
};

export type TelemetryImportPoint = TelemetryMessage & {
  telemetryUuid?: string;
  sampleCount?: number;
};

export type TelemetryArchiveQuery = {
  from: string;
  to: string;
  deviceId?: string;
};

export type TelemetryImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

export type TelemetryImportMode = 'merge' | 'idempotent';

export type TelemetrySummaryRebuildRange = {
  deviceId: string;
  from: string;
  to: string;
};

type MaybePromise<T> = T | Promise<T>;

export interface TelemetryRepository {
  setLast(message: TelemetryMessage): void;
  getLast(): TelemetryMessage | null;
  listHistory(query: TelemetryHistoryQuery): MaybePromise<TelemetryHistoryResult>;
  listAvailableDays(query: TelemetryAvailabilityQuery): MaybePromise<DeviceTelemetryAvailabilityDay[]>;
  summarizeDevice(deviceId: string): MaybePromise<DeviceTelemetrySummary>;
  exportHistory(query: TelemetryArchiveQuery): MaybePromise<TelemetryImportPoint[]>;
  countArchive(query: TelemetryArchiveQuery): MaybePromise<number>;
  exportHistoryBatches(query: TelemetryArchiveQuery, batchSize?: number): AsyncIterable<TelemetryImportPoint[]>;
  importHistory(points: TelemetryImportPoint[]): MaybePromise<TelemetryImportResult>;
  importHistoryBatch(points: TelemetryImportPoint[], mode: TelemetryImportMode): MaybePromise<TelemetryImportResult>;
  deleteHistoryRange(range: TelemetrySummaryRebuildRange): MaybePromise<number>;
  rebuildHourlySummaries(ranges: TelemetrySummaryRebuildRange[]): MaybePromise<void>;
  applyRetention(): MaybePromise<{ removed: number; kept: number; cutoffAt: string } | null>;
}
