import type { TelemetryRepository } from './telemetry.repository.js';
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

  applyRetention(): { removed: number; kept: number; cutoffAt: string } | null {
    return this.store.applyRetention();
  }
}
