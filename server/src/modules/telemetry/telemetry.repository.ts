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
};

export interface TelemetryRepository {
  setLast(message: TelemetryMessage): void;
  getLast(): TelemetryMessage | null;
  listHistory(query: TelemetryHistoryQuery): TelemetryHistoryResult;
  applyRetention(): { removed: number; kept: number; cutoffAt: string } | null;
}
