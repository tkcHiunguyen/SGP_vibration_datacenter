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

type MaybePromise<T> = T | Promise<T>;

export interface TelemetryRepository {
  setLast(message: TelemetryMessage): void;
  getLast(): TelemetryMessage | null;
  listHistory(query: TelemetryHistoryQuery): MaybePromise<TelemetryHistoryResult>;
  applyRetention(): MaybePromise<{ removed: number; kept: number; cutoffAt: string } | null>;
}
