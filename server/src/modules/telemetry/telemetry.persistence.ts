import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TelemetryMessage } from '../../shared/types.js';
import type {
  DeviceTelemetryAvailabilityDay,
  TelemetryAvailabilityQuery,
  TelemetryHistoryPoint,
  TelemetryHistoryQuery,
  TelemetryHistoryResult,
} from './telemetry.repository.js';

function resolveStorageDir(): string {
  const configured = process.env.TELEMETRY_DATA_DIR?.trim();
  if (configured) {
    return configured;
  }

  return join(process.cwd(), 'data', 'telemetry');
}

function safeParseTelemetry(value: string): TelemetryMessage | null {
  try {
    const parsed = JSON.parse(value) as TelemetryMessage;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.deviceId !== 'string' ||
      typeof parsed.receivedAt !== 'string' ||
      typeof parsed.payload !== 'object' ||
      parsed.payload === null
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function resolveRetentionHours(): number {
  const raw = Number(process.env.TELEMETRY_RETENTION_HOURS ?? '168');
  if (!Number.isFinite(raw) || raw <= 0) {
    return 168;
  }
  return raw;
}

function parseIsoTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function clampTimezoneOffsetMinutes(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-840, Math.min(840, Math.floor(Number(value))));
}

function toDateKeyWithTimezoneOffset(timestampMs: number, timezoneOffsetMinutes: number): string {
  const shifted = timestampMs - timezoneOffsetMinutes * 60 * 1000;
  const date = new Date(shifted);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class TelemetryAppendOnlyStore {
  private readonly rawLogPath: string;
  private readonly snapshotPath: string;
  private cachedLast: TelemetryMessage | null = null;
  private readonly writable: boolean;
  private readonly retentionHours: number;
  private orderedMessages: TelemetryMessage[] = [];
  private readonly messagesByDevice = new Map<string, TelemetryMessage[]>();

  constructor(baseDir = resolveStorageDir()) {
    this.rawLogPath = join(baseDir, 'telemetry-raw.ndjson');
    this.snapshotPath = join(baseDir, 'telemetry-last.json');

    let writable = true;
    try {
      mkdirSync(dirname(this.rawLogPath), { recursive: true });
      this.orderedMessages = this.readAllTelemetry();
      this.rebuildIndex(this.orderedMessages);
      this.cachedLast = this.readSnapshot() ?? this.orderedMessages.at(-1) ?? null;
    } catch {
      writable = false;
      this.cachedLast = null;
      this.orderedMessages = [];
      this.messagesByDevice.clear();
    }

    this.writable = writable;
    this.retentionHours = resolveRetentionHours();
  }

  getLast(): TelemetryMessage | null {
    return this.cachedLast;
  }

  setLast(message: TelemetryMessage): void {
    this.cachedLast = message;
    this.indexMessage(message);
    if (!this.writable) {
      return;
    }

    const line = `${JSON.stringify(message)}\n`;
    try {
      appendFileSync(this.rawLogPath, line, 'utf8');
      writeFileSync(this.snapshotPath, JSON.stringify(message), 'utf8');
    } catch {
      // Best-effort persistence. Runtime telemetry should keep flowing even if local disk fails.
    }
  }

  listHistory(query: TelemetryHistoryQuery): TelemetryHistoryResult {
    const fromTimestamp = parseIsoTimestamp(query.from);
    const toTimestamp = parseIsoTimestamp(query.to);
    const limit = Math.max(1, Math.min(query.limit ?? 200, 1000));
    const bucketMs = query.bucketMs && query.bucketMs > 0 ? Math.floor(query.bucketMs) : undefined;
    const history = this.messagesByDevice.get(query.deviceId) ?? [];
    const filtered = history.filter((message) => {

      const timestamp = Date.parse(message.receivedAt);
      if (Number.isNaN(timestamp)) {
        return false;
      }

      if (fromTimestamp !== null && timestamp < fromTimestamp) {
        return false;
      }

      if (toTimestamp !== null && timestamp > toTimestamp) {
        return false;
      }

      return true;
    });

    const totalMatched = filtered.length;
    const points = bucketMs ? this.bucketMessages(filtered, bucketMs) : filtered;
    const sliced = points.slice(-limit);

    return {
      items: sliced,
      totalMatched,
      truncated: points.length > sliced.length,
      bucketMs,
    };
  }

  listAvailableDays(query: TelemetryAvailabilityQuery): DeviceTelemetryAvailabilityDay[] {
    const fromTimestamp = parseIsoTimestamp(query.from);
    const toTimestamp = parseIsoTimestamp(query.to);
    const timezoneOffsetMinutes = clampTimezoneOffsetMinutes(query.timezoneOffsetMinutes);
    const limitDays = Math.max(1, Math.min(Math.floor(query.limitDays ?? 366), 731));
    const history = this.messagesByDevice.get(query.deviceId) ?? [];

    const byDate = new Map<string, DeviceTelemetryAvailabilityDay>();
    for (const message of history) {
      const timestamp = Date.parse(message.receivedAt);
      if (Number.isNaN(timestamp)) {
        continue;
      }
      if (fromTimestamp !== null && timestamp < fromTimestamp) {
        continue;
      }
      if (toTimestamp !== null && timestamp > toTimestamp) {
        continue;
      }

      const dateKey = toDateKeyWithTimezoneOffset(timestamp, timezoneOffsetMinutes);
      const existing = byDate.get(dateKey);
      if (!existing) {
        byDate.set(dateKey, {
          date: dateKey,
          count: 1,
          firstAt: message.receivedAt,
          lastAt: message.receivedAt,
        });
        continue;
      }

      existing.count += 1;
      if (!existing.firstAt || message.receivedAt < existing.firstAt) {
        existing.firstAt = message.receivedAt;
      }
      if (!existing.lastAt || message.receivedAt > existing.lastAt) {
        existing.lastAt = message.receivedAt;
      }
    }

    const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    if (rows.length <= limitDays) {
      return rows;
    }
    return rows.slice(rows.length - limitDays);
  }

  applyRetention(): { removed: number; kept: number; cutoffAt: string } | null {
    if (!this.writable) {
      return null;
    }

    const cutoffTimestamp = Date.now() - this.retentionHours * 60 * 60 * 1000;
    const kept = this.orderedMessages.filter((message) => {
      const timestamp = Date.parse(message.receivedAt);
      return !Number.isNaN(timestamp) && timestamp >= cutoffTimestamp;
    });

    const removed = this.orderedMessages.length - kept.length;
    if (removed <= 0) {
      return {
        removed: 0,
        kept: kept.length,
        cutoffAt: new Date(cutoffTimestamp).toISOString(),
      };
    }

    try {
      const rawContent = kept.map((message) => JSON.stringify(message)).join('\n');
      writeFileSync(this.rawLogPath, rawContent ? `${rawContent}\n` : '', 'utf8');
      this.orderedMessages = kept;
      this.rebuildIndex(kept);
      this.cachedLast = kept.at(-1) ?? null;
      if (this.cachedLast) {
        writeFileSync(this.snapshotPath, JSON.stringify(this.cachedLast), 'utf8');
      } else {
        writeFileSync(this.snapshotPath, '', 'utf8');
      }
      return {
        removed,
        kept: kept.length,
        cutoffAt: new Date(cutoffTimestamp).toISOString(),
      };
    } catch {
      return null;
    }
  }

  private readSnapshot(): TelemetryMessage | null {
    if (!existsSync(this.snapshotPath)) {
      return null;
    }

    try {
      const contents = readFileSync(this.snapshotPath, 'utf8').trim();
      if (!contents) {
        return null;
      }
      return safeParseTelemetry(contents);
    } catch {
      return null;
    }
  }

  private readAllTelemetry(): TelemetryMessage[] {
    if (!existsSync(this.rawLogPath)) {
      return [];
    }

    try {
      const contents = readFileSync(this.rawLogPath, 'utf8').trim();
      if (!contents) {
        return [];
      }

      return contents
        .split(/\r?\n/)
        .map((line) => safeParseTelemetry(line.trim()))
        .filter((message): message is TelemetryMessage => Boolean(message));
    } catch {
      return [];
    }
  }

  private indexMessage(message: TelemetryMessage): void {
    this.orderedMessages.push(message);
    const perDevice = this.messagesByDevice.get(message.deviceId) ?? [];
    perDevice.push(message);
    this.messagesByDevice.set(message.deviceId, perDevice);
  }

  private rebuildIndex(messages: TelemetryMessage[]): void {
    this.messagesByDevice.clear();
    for (const message of messages) {
      const perDevice = this.messagesByDevice.get(message.deviceId) ?? [];
      perDevice.push(message);
      this.messagesByDevice.set(message.deviceId, perDevice);
    }
  }

  private bucketMessages(messages: TelemetryMessage[], bucketMs: number): TelemetryHistoryPoint[] {
    const buckets = new Map<number, TelemetryHistoryPoint>();

    for (const message of messages) {
      const timestamp = Date.parse(message.receivedAt);
      if (Number.isNaN(timestamp)) {
        continue;
      }

      const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs;
      const existing = buckets.get(bucketStart);
      if (!existing) {
        buckets.set(bucketStart, {
          ...message,
          bucketStartedAt: new Date(bucketStart).toISOString(),
          bucketEndedAt: new Date(bucketStart + bucketMs).toISOString(),
          sampleCount: 1,
        });
        continue;
      }

      buckets.set(bucketStart, {
        ...message,
        bucketStartedAt: existing.bucketStartedAt,
        bucketEndedAt: existing.bucketEndedAt,
        sampleCount: (existing.sampleCount ?? 1) + 1,
      });
    }

    return [...buckets.values()].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
  }
}
