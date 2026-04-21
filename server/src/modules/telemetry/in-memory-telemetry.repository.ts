import type { DeviceTelemetrySummary, TelemetryRepository } from './telemetry.repository.js';
import type { TelemetryMessage } from '../../shared/types.js';
import { TelemetryAppendOnlyStore } from './telemetry.persistence.js';
import type { TelemetryHistoryQuery, TelemetryHistoryResult } from './telemetry.repository.js';

export class InMemoryTelemetryRepository implements TelemetryRepository {
  private readonly store = new TelemetryAppendOnlyStore();
  private lastMessage: TelemetryMessage | null = this.store.getLast();

  constructor() {
    this.store.applyRetention();
  }

  setLast(message: TelemetryMessage): void {
    this.lastMessage = message;
    this.store.setLast(message);
  }

  getLast(): TelemetryMessage | null {
    return this.lastMessage;
  }

  listHistory(query: TelemetryHistoryQuery): TelemetryHistoryResult {
    return this.store.listHistory(query);
  }

  summarizeDevice(deviceId: string): DeviceTelemetrySummary {
    const history = this.store.listHistory({
      deviceId,
      limit: 1000,
    });
    const sampled = history.items;
    const sampledBytes = sampled.reduce((sum, point) => {
      return sum + point.receivedAt.length + JSON.stringify(point.payload ?? {}).length;
    }, 0);
    const estimatedBytes =
      sampled.length > 0
        ? Math.max(0, Math.round((sampledBytes / sampled.length) * history.totalMatched))
        : 0;

    return {
      total: history.totalMatched,
      latestAt: sampled.at(-1)?.receivedAt,
      estimatedBytes,
    };
  }

  applyRetention(): { removed: number; kept: number; cutoffAt: string } | null {
    return this.store.applyRetention();
  }
}
