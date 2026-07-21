export type ChartRangePreset = "1h" | "6h" | "12h" | "1d" | "3d" | "1w" | "1m";

export type ChartRange =
  | {
      kind: "relative";
      preset: ChartRangePreset;
      fromMs: number;
      toMs: number;
    }
  | {
      kind: "calendar-day";
      date: string;
      fromMs: number;
      toMs: number;
    }
  | {
      kind: "custom";
      fromMs: number;
      toMs: number;
    };

type ChartRangeStatus = "idle" | "loading" | "refreshing" | "error";

export type ChartRangeState = {
  activeRange: ChartRange;
  pendingRange: ChartRange | null;
  status: ChartRangeStatus;
  requestId: number;
  error: string | null;
};

type ChartRangeAction =
  | { type: "reset"; range: ChartRange }
  | {
      type: "select";
      range: ChartRange;
      requestId: number;
      cachedRange?: ChartRange;
    }
  | { type: "resolve"; range: ChartRange; requestId: number }
  | { type: "reject"; requestId: number; error: string }
  | { type: "advance-realtime"; toMs: number };

export const CHART_RANGE_PRESET_MS: Record<ChartRangePreset, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
};

export const CHART_RANGE_PRESET_LABELS: Record<ChartRangePreset, string> = {
  "1h": "1 giờ",
  "6h": "6 giờ",
  "12h": "12 giờ",
  "1d": "24 giờ",
  "3d": "3 ngày",
  "1w": "7 ngày",
  "1m": "30 ngày",
};

export const QUICK_CHART_RANGE_PRESETS: readonly ChartRangePreset[] = ["1h", "6h", "1d", "1w", "1m"];
export const EXTRA_CHART_RANGE_PRESETS: readonly ChartRangePreset[] = ["12h", "3d"];

export function createRelativeChartRange(preset: ChartRangePreset, toMs = Date.now()): ChartRange {
  const safeToMs = Math.floor(toMs);
  return {
    kind: "relative",
    preset,
    fromMs: safeToMs - CHART_RANGE_PRESET_MS[preset],
    toMs: safeToMs,
  };
}

export function createCalendarDayChartRange(date: string): ChartRange | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    localStart.getFullYear() !== year
    || localStart.getMonth() !== month - 1
    || localStart.getDate() !== day
  ) {
    return null;
  }
  const fromMs = localStart.getTime();
  const toMs = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime();
  return { kind: "calendar-day", date, fromMs, toMs };
}

export function createCustomChartRange(fromMs: number, toMs: number): ChartRange | null {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return null;
  }
  return { kind: "custom", fromMs: Math.floor(fromMs), toMs: Math.floor(toMs) };
}

export function getChartRangeBucketMs(range: ChartRange): number {
  if (range.kind === "relative") {
    switch (range.preset) {
      case "1h":
        return 10_000;
      case "6h":
      case "12h":
        return 30_000;
      case "1d":
        return 60_000;
      case "3d":
        return 120_000;
      case "1w":
        return 300_000;
      case "1m":
        return 3_600_000;
    }
  }

  const durationMs = Math.max(1, range.toMs - range.fromMs);
  if (durationMs <= CHART_RANGE_PRESET_MS["1h"]) return 10_000;
  if (durationMs <= CHART_RANGE_PRESET_MS["12h"]) return 30_000;
  if (durationMs <= CHART_RANGE_PRESET_MS["1d"]) return 60_000;
  if (durationMs <= CHART_RANGE_PRESET_MS["3d"]) return 120_000;
  if (durationMs <= CHART_RANGE_PRESET_MS["1w"]) return 300_000;
  return 3_600_000;
}

export function createChartRangeQueryKey(deviceId: string, range: ChartRange, bucketMs = getChartRangeBucketMs(range)): string {
  return [deviceId.trim(), Math.floor(range.fromMs), Math.floor(range.toMs), Math.floor(bucketMs)].join(":");
}

export function createChartRangeSemanticKey(range: ChartRange): string {
  if (range.kind === "relative") return `relative:${range.preset}`;
  if (range.kind === "calendar-day") return `calendar-day:${range.date}`;
  return `custom:${Math.floor(range.fromMs)}:${Math.floor(range.toMs)}`;
}

export function isRealtimeChartRange(range: ChartRange): boolean {
  return range.kind === "relative";
}

export function chartRangeReducer(state: ChartRangeState, action: ChartRangeAction): ChartRangeState {
  switch (action.type) {
    case "reset":
      return {
        activeRange: action.range,
        pendingRange: null,
        status: "idle",
        requestId: 0,
        error: null,
      };
    case "select":
      return {
        activeRange: action.cachedRange ?? state.activeRange,
        pendingRange: action.range,
        status: action.cachedRange ? "refreshing" : "loading",
        requestId: action.requestId,
        error: null,
      };
    case "resolve":
      if (action.requestId !== state.requestId) return state;
      const resolvedRange = state.activeRange.kind === "relative"
        && action.range.kind === "relative"
        && state.activeRange.preset === action.range.preset
        && state.activeRange.toMs > action.range.toMs
        ? state.activeRange
        : action.range;
      return {
        activeRange: resolvedRange,
        pendingRange: null,
        status: "idle",
        requestId: action.requestId,
        error: null,
      };
    case "reject":
      if (action.requestId !== state.requestId) return state;
      return {
        ...state,
        pendingRange: null,
        status: "error",
        error: action.error,
      };
    case "advance-realtime": {
      if (state.activeRange.kind !== "relative" || action.toMs <= state.activeRange.toMs) return state;
      const durationMs = CHART_RANGE_PRESET_MS[state.activeRange.preset];
      return {
        ...state,
        activeRange: {
          ...state.activeRange,
          fromMs: action.toMs - durationMs,
          toMs: action.toMs,
        },
      };
    }
  }
}

type ChartRangeCacheEntry<T> = {
  queryKey: string;
  semanticKey: string;
  range: ChartRange;
  bucketMs: number;
  value: T;
  updatedAtMs: number;
};

export class PerDeviceChartRangeLruCache<T> {
  private readonly entriesByDevice = new Map<string, Map<string, ChartRangeCacheEntry<T>>>();

  constructor(private readonly maxEntriesPerDevice = 12) {}

  getExact(deviceId: string, queryKey: string): ChartRangeCacheEntry<T> | undefined {
    const deviceEntries = this.entriesByDevice.get(deviceId);
    const entry = deviceEntries?.get(queryKey);
    if (!deviceEntries || !entry) return undefined;
    deviceEntries.delete(queryKey);
    deviceEntries.set(queryKey, entry);
    return entry;
  }

  getReusable(deviceId: string, range: ChartRange): ChartRangeCacheEntry<T> | undefined {
    const deviceEntries = this.entriesByDevice.get(deviceId);
    if (!deviceEntries) return undefined;
    const semanticKey = createChartRangeSemanticKey(range);
    let reusable: ChartRangeCacheEntry<T> | undefined;
    for (const entry of deviceEntries.values()) {
      if (entry.semanticKey === semanticKey && (!reusable || entry.updatedAtMs > reusable.updatedAtMs)) {
        reusable = entry;
      }
    }
    if (reusable) {
      deviceEntries.delete(reusable.queryKey);
      deviceEntries.set(reusable.queryKey, reusable);
    }
    return reusable;
  }

  set(deviceId: string, entry: ChartRangeCacheEntry<T>): void {
    let deviceEntries = this.entriesByDevice.get(deviceId);
    if (!deviceEntries) {
      deviceEntries = new Map();
      this.entriesByDevice.set(deviceId, deviceEntries);
    }
    deviceEntries.delete(entry.queryKey);
    deviceEntries.set(entry.queryKey, entry);
    while (deviceEntries.size > Math.max(1, this.maxEntriesPerDevice)) {
      const oldestKey = deviceEntries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      deviceEntries.delete(oldestKey);
    }
  }

  size(deviceId: string): number {
    return this.entriesByDevice.get(deviceId)?.size ?? 0;
  }

  clearDevice(deviceId: string): void {
    this.entriesByDevice.delete(deviceId);
  }
}

export class LatestChartRangeRequest {
  private nextRequestId = 0;
  private abortController: AbortController | null = null;

  begin(): { requestId: number; signal: AbortSignal } {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.nextRequestId += 1;
    return { requestId: this.nextRequestId, signal: this.abortController.signal };
  }

  isLatest(requestId: number): boolean {
    return requestId === this.nextRequestId;
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.nextRequestId += 1;
  }
}

export function formatChartRangeLabel(range: ChartRange): string {
  if (range.kind === "relative") return CHART_RANGE_PRESET_LABELS[range.preset];
  if (range.kind === "calendar-day") {
    const [year, month, day] = range.date.split("-");
    return `Ngày ${day}/${month}/${year}`;
  }
  const formatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(range.fromMs)} - ${formatter.format(range.toMs)}`;
}

export function formatChartRangeLoadingLabel(range: ChartRange, refreshing: boolean): string {
  if (refreshing) return "Đang cập nhật dữ liệu…";
  return `Đang tải ${formatChartRangeLabel(range).toLowerCase()}…`;
}
