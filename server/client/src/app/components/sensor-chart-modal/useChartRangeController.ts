import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DeviceTelemetryPoint } from "../../data/sensors";
import {
  LatestChartRangeRequest,
  PerDeviceChartRangeLruCache,
  chartRangeReducer,
  createChartRangeQueryKey,
  createChartRangeSemanticKey,
  createRelativeChartRange,
  getChartRangeBucketMs,
  isRealtimeChartRange,
  type ChartRange,
  type ChartRangePreset,
  type ChartRangeState,
} from "./chart-range-controller";

type ChartRangeResponseMetadata = {
  from: string | null;
  to: string | null;
  bucketMs: number;
  sampleCount: number;
  totalMatched: number;
  complete: boolean;
};

export type ChartRangeResponse = {
  points: DeviceTelemetryPoint[];
  metadata: ChartRangeResponseMetadata;
};

type ChartRangeFetcher = (
  deviceId: string,
  range: ChartRange,
  bucketMs: number,
  signal: AbortSignal,
) => Promise<ChartRangeResponse>;

type UseChartRangeControllerOptions = {
  deviceId: string | null | undefined;
  initialPreset: ChartRangePreset;
  realtimePoints: DeviceTelemetryPoint[];
  fetchRange: ChartRangeFetcher;
};

const rangeCache = new PerDeviceChartRangeLruCache<ChartRangeResponse>(12);
const prefetchInFlight = new Set<string>();

export type RealtimeArrival = {
  point: DeviceTelemetryPoint;
  arrivedAtMs: number;
};

export type ChartDataSource = "empty" | "cache" | "fetch" | "realtime";

const AVERAGED_POINT_KEYS = [
  "temperature",
  "ax",
  "ay",
  "az",
  "vrmsXMms",
  "vrmsYMms",
  "vrmsZMms",
  "drmsXUm",
  "drmsYUm",
  "drmsZUm",
  "drmsBandMinHz",
  "drmsBandMaxHz",
] as const satisfies readonly (keyof DeviceTelemetryPoint)[];

function pointKey(point: DeviceTelemetryPoint): string {
  if (point.bucketStartedAt) return `bucket:${point.bucketStartedAt}`;
  return point.messageId || point.telemetryUuid || point.receivedAt;
}

function pointTimestamp(point: DeviceTelemetryPoint): number {
  const timestamp = Date.parse(point.receivedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function pointSortTimestamp(point: DeviceTelemetryPoint): number {
  const bucketStartedAt = point.bucketStartedAt ? Date.parse(point.bucketStartedAt) : Number.NaN;
  return Number.isFinite(bucketStartedAt) ? bucketStartedAt : pointTimestamp(point);
}

function pointOverlapsRange(point: DeviceTelemetryPoint, range: ChartRange): boolean {
  const bucketStartedAt = point.bucketStartedAt ? Date.parse(point.bucketStartedAt) : Number.NaN;
  const bucketEndedAt = point.bucketEndedAt ? Date.parse(point.bucketEndedAt) : Number.NaN;
  if (Number.isFinite(bucketStartedAt) && Number.isFinite(bucketEndedAt)) {
    return bucketEndedAt > range.fromMs && bucketStartedAt <= range.toMs;
  }
  const timestamp = pointTimestamp(point);
  return timestamp >= range.fromMs && timestamp <= range.toMs;
}

function normalizeRealtimePoint(point: DeviceTelemetryPoint, bucketMs: number): DeviceTelemetryPoint {
  const timestamp = pointTimestamp(point);
  if (!Number.isFinite(timestamp) || bucketMs <= 0) return point;
  const bucketStartedMs = Math.floor(timestamp / bucketMs) * bucketMs;
  return {
    ...point,
    bucketStartedAt: new Date(bucketStartedMs).toISOString(),
    bucketEndedAt: new Date(bucketStartedMs + bucketMs).toISOString(),
    sampleCount: 1,
  };
}

function mergeBucketPoint(existing: DeviceTelemetryPoint, incoming: DeviceTelemetryPoint): DeviceTelemetryPoint {
  if (
    (incoming.messageId && incoming.messageId === existing.messageId)
    || (incoming.telemetryUuid && incoming.telemetryUuid === existing.telemetryUuid)
  ) {
    return existing;
  }

  const existingCount = Math.max(1, Math.floor(existing.sampleCount ?? 1));
  const nextCount = existingCount + 1;
  const merged: DeviceTelemetryPoint = {
    ...existing,
    receivedAt: incoming.receivedAt,
    messageId: incoming.messageId ?? existing.messageId,
    telemetryUuid: incoming.telemetryUuid ?? existing.telemetryUuid,
    uuid: incoming.uuid ?? existing.uuid,
    sampleCount: nextCount,
    temperatureAvailable: incoming.temperatureAvailable ?? existing.temperatureAvailable,
    vibrationAvailable: incoming.vibrationAvailable ?? existing.vibrationAvailable,
    available: incoming.available ?? existing.available,
    adxlStatus: incoming.adxlStatus ?? existing.adxlStatus,
    adxlFaultReason: incoming.adxlFaultReason ?? existing.adxlFaultReason,
    vrmsUnit: incoming.vrmsUnit ?? existing.vrmsUnit,
    drmsUnit: incoming.drmsUnit ?? existing.drmsUnit,
  };

  for (const key of AVERAGED_POINT_KEYS) {
    const previousValue = existing[key];
    const nextValue = incoming[key];
    if (typeof nextValue !== "number" || !Number.isFinite(nextValue)) continue;
    (merged as unknown as Record<string, unknown>)[key] = typeof previousValue === "number" && Number.isFinite(previousValue)
      ? (previousValue * existingCount + nextValue) / nextCount
      : nextValue;
  }
  return merged;
}

export function mergeRealtimePoints(
  current: DeviceTelemetryPoint[],
  incoming: DeviceTelemetryPoint[],
  range: ChartRange,
  bucketMs = getChartRangeBucketMs(range),
): DeviceTelemetryPoint[] {
  if (!isRealtimeChartRange(range) || incoming.length === 0) return current;
  const unique = new Map<string, DeviceTelemetryPoint>();
  for (const point of current) unique.set(pointKey(point), point);
  for (const point of [...incoming].sort((left, right) => pointTimestamp(left) - pointTimestamp(right))) {
    const timestamp = pointTimestamp(point);
    if (timestamp < range.fromMs || timestamp > range.toMs) continue;
    const normalized = normalizeRealtimePoint(point, bucketMs);
    const key = pointKey(normalized);
    const existing = unique.get(key);
    unique.set(key, existing ? mergeBucketPoint(existing, normalized) : normalized);
  }
  const merged = [...unique.values()]
    .filter((point) => pointOverlapsRange(point, range))
    .sort((left, right) => pointSortTimestamp(left) - pointSortTimestamp(right));
  if (
    merged.length === current.length
    && merged.every((point, index) => point === current[index])
  ) {
    return current;
  }
  return merged;
}

export function mergeFetchedRangeWithRealtime(
  fetched: DeviceTelemetryPoint[],
  arrivals: RealtimeArrival[],
  range: ChartRange,
  bucketMs: number,
  requestStartedAtMs: number,
): DeviceTelemetryPoint[] {
  const arrivedDuringRequest = arrivals
    .filter((arrival) => arrival.arrivedAtMs >= requestStartedAtMs)
    .map((arrival) => arrival.point);
  return mergeRealtimePoints(fetched, arrivedDuringRequest, range, bucketMs);
}

function advanceRangeToPoints(range: ChartRange, points: DeviceTelemetryPoint[]): ChartRange {
  if (!isRealtimeChartRange(range) || points.length === 0) return range;
  const latestTimestamp = points.reduce(
    (latest, point) => Math.max(latest, pointTimestamp(point)),
    Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(latestTimestamp) || latestTimestamp <= range.toMs) return range;
  const durationMs = range.toMs - range.fromMs;
  return {
    ...range,
    fromMs: latestTimestamp - durationMs,
    toMs: latestTimestamp,
  };
}

function nextPrefetchPreset(preset: ChartRangePreset): ChartRangePreset | null {
  switch (preset) {
    case "1h": return "6h";
    case "6h": return "1d";
    case "12h": return "1d";
    case "1d": return "1w";
    case "3d": return "1w";
    case "1w": return "1m";
    case "1m": return null;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "telemetry_range_failed";
}

export function resolveRangeForDeviceTransition(
  state: Pick<ChartRangeState, "activeRange" | "pendingRange">,
  initialPreset: ChartRangePreset,
  previousDeviceId: string | null | undefined,
  nextDeviceId: string | null,
): ChartRange {
  if (previousDeviceId !== undefined && previousDeviceId !== nextDeviceId) {
    return state.pendingRange ?? state.activeRange;
  }
  return createRelativeChartRange(initialPreset);
}

export function useChartRangeController({
  deviceId,
  initialPreset,
  realtimePoints,
  fetchRange,
}: UseChartRangeControllerOptions) {
  const normalizedDeviceId = deviceId?.trim() || null;
  const initialRange = useMemo(() => createRelativeChartRange(initialPreset), [initialPreset]);
  const [state, dispatch] = useReducer(
    chartRangeReducer,
    initialRange,
    (range): ChartRangeState => ({
      activeRange: range,
      pendingRange: null,
      status: "idle",
      requestId: 0,
      error: null,
    }),
  );
  const [data, setData] = useState<DeviceTelemetryPoint[]>([]);
  const [dataSource, setDataSource] = useState<ChartDataSource>("empty");
  const [metadata, setMetadata] = useState<ChartRangeResponseMetadata | null>(null);
  const [activeQueryKey, setActiveQueryKey] = useState("");
  const requestRef = useRef(new LatestChartRangeRequest());
  const stateRef = useRef(state);
  const previousDeviceIdRef = useRef<string | null | undefined>(undefined);
  const realtimeArrivalsRef = useRef(new Map<string, RealtimeArrival>());
  const prefetchCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const prefetchAdjacentRange = useCallback((range: ChartRange) => {
    if (!normalizedDeviceId || range.kind !== "relative") return;
    const nextPreset = nextPrefetchPreset(range.preset);
    if (!nextPreset) return;
    const adjacentRange = createRelativeChartRange(nextPreset, range.toMs);
    const bucketMs = getChartRangeBucketMs(adjacentRange);
    const queryKey = createChartRangeQueryKey(normalizedDeviceId, adjacentRange, bucketMs);
    if (rangeCache.getExact(normalizedDeviceId, queryKey) || prefetchInFlight.has(queryKey)) return;

    const run = () => {
      const abortController = new AbortController();
      prefetchInFlight.add(queryKey);
      void fetchRange(normalizedDeviceId, adjacentRange, bucketMs, abortController.signal)
        .then((response) => {
          rangeCache.set(normalizedDeviceId, {
            queryKey,
            semanticKey: createChartRangeSemanticKey(adjacentRange),
            range: adjacentRange,
            bucketMs,
            value: response,
            updatedAtMs: Date.now(),
          });
        })
        .catch(() => undefined)
        .finally(() => {
          prefetchInFlight.delete(queryKey);
        });
      prefetchCleanupRef.current = () => abortController.abort();
    };

    const browserWindow = typeof window === "undefined" ? null : window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (browserWindow?.requestIdleCallback) {
      const idleId = browserWindow.requestIdleCallback(run, { timeout: 1_500 });
      prefetchCleanupRef.current = () => browserWindow.cancelIdleCallback?.(idleId);
    } else if (browserWindow) {
      const timerId = browserWindow.setTimeout(run, 250);
      prefetchCleanupRef.current = () => browserWindow.clearTimeout(timerId);
    }
  }, [fetchRange, normalizedDeviceId]);

  const selectRange = useCallback(async (range: ChartRange): Promise<void> => {
    if (!normalizedDeviceId) return;
    prefetchCleanupRef.current?.();
    prefetchCleanupRef.current = null;

    const bucketMs = getChartRangeBucketMs(range);
    const queryKey = createChartRangeQueryKey(normalizedDeviceId, range, bucketMs);
    const cached = rangeCache.getExact(normalizedDeviceId, queryKey)
      ?? rangeCache.getReusable(normalizedDeviceId, range);
    const { requestId, signal } = requestRef.current.begin();
    const requestStartedAtMs = Date.now();

    if (cached) {
      const arrivals = [...realtimeArrivalsRef.current.values()];
      const cachedRange = advanceRangeToPoints(range, arrivals.map((arrival) => arrival.point));
      setData(mergeRealtimePoints(cached.value.points, arrivals.map((arrival) => arrival.point), cachedRange, bucketMs));
      setDataSource("cache");
      setMetadata(cached.value.metadata);
      setActiveQueryKey(cached.queryKey);
    }
    dispatch({ type: "select", range, requestId, cachedRange: cached?.range });

    try {
      const response = await fetchRange(normalizedDeviceId, range, bucketMs, signal);
      if (!requestRef.current.isLatest(requestId)) return;
      const arrivals = [...realtimeArrivalsRef.current.values()];
      const resolvedRange = advanceRangeToPoints(range, arrivals.map((arrival) => arrival.point));
      const mergedPoints = mergeFetchedRangeWithRealtime(
        response.points,
        arrivals,
        resolvedRange,
        bucketMs,
        requestStartedAtMs,
      );
      rangeCache.set(normalizedDeviceId, {
        queryKey,
        semanticKey: createChartRangeSemanticKey(range),
        range,
        bucketMs,
        value: { ...response, points: mergedPoints },
        updatedAtMs: Date.now(),
      });
      setData(mergedPoints);
      setDataSource("fetch");
      setMetadata(response.metadata);
      setActiveQueryKey(queryKey);
      dispatch({ type: "resolve", range, requestId });
      prefetchAdjacentRange(range);
    } catch (error) {
      if ((error as Error)?.name === "AbortError" || !requestRef.current.isLatest(requestId)) return;
      dispatch({ type: "reject", requestId, error: toErrorMessage(error) });
    }
  }, [fetchRange, normalizedDeviceId, prefetchAdjacentRange]);

  useEffect(() => {
    requestRef.current.cancel();
    prefetchCleanupRef.current?.();
    prefetchCleanupRef.current = null;
    const nextRange = resolveRangeForDeviceTransition(
      stateRef.current,
      initialPreset,
      previousDeviceIdRef.current,
      normalizedDeviceId,
    );
    previousDeviceIdRef.current = normalizedDeviceId;
    dispatch({ type: "reset", range: nextRange });
    realtimeArrivalsRef.current.clear();
    setData([]);
    setDataSource("empty");
    setMetadata(null);
    setActiveQueryKey("");
    if (normalizedDeviceId) void selectRange(nextRange);
    return () => {
      requestRef.current.cancel();
      prefetchCleanupRef.current?.();
      prefetchCleanupRef.current = null;
    };
  }, [initialPreset, normalizedDeviceId, selectRange]);

  useEffect(() => {
    const activeRange = stateRef.current.activeRange;
    if (!isRealtimeChartRange(activeRange) || realtimePoints.length === 0) return;
    const arrivedAtMs = Date.now();
    for (const point of realtimePoints) {
      realtimeArrivalsRef.current.set(pointKey(point), { point, arrivedAtMs });
    }
    const latestTimestamp = realtimePoints.reduce(
      (latest, point) => Math.max(latest, pointTimestamp(point)),
      Number.NEGATIVE_INFINITY,
    );
    if (Number.isFinite(latestTimestamp) && latestTimestamp > activeRange.toMs) {
      dispatch({ type: "advance-realtime", toMs: latestTimestamp });
    }
    const nextRange = {
      ...activeRange,
      fromMs: Number.isFinite(latestTimestamp)
        ? latestTimestamp - (activeRange.toMs - activeRange.fromMs)
        : activeRange.fromMs,
      toMs: Number.isFinite(latestTimestamp) ? Math.max(activeRange.toMs, latestTimestamp) : activeRange.toMs,
    };
    for (const [key, arrival] of realtimeArrivalsRef.current) {
      if (!pointOverlapsRange(arrival.point, nextRange)) {
        realtimeArrivalsRef.current.delete(key);
      }
    }
    setData((current) => mergeRealtimePoints(current, realtimePoints, nextRange, getChartRangeBucketMs(nextRange)));
    setDataSource("realtime");
  }, [realtimePoints]);

  return {
    state,
    data,
    dataSource,
    metadata,
    activeQueryKey,
    selectedRange: state.pendingRange ?? state.activeRange,
    selectRange,
  };
}
