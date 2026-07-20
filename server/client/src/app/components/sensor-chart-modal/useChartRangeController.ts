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

function pointKey(point: DeviceTelemetryPoint): string {
  return point.messageId || point.telemetryUuid || point.receivedAt;
}

function pointTimestamp(point: DeviceTelemetryPoint): number {
  const timestamp = Date.parse(point.receivedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function mergeRealtimePoints(
  current: DeviceTelemetryPoint[],
  incoming: DeviceTelemetryPoint[],
  range: ChartRange,
): DeviceTelemetryPoint[] {
  if (!isRealtimeChartRange(range) || incoming.length === 0) return current;
  const unique = new Map<string, DeviceTelemetryPoint>();
  for (const point of current) unique.set(pointKey(point), point);
  for (const point of incoming) {
    const timestamp = pointTimestamp(point);
    if (timestamp >= range.fromMs) unique.set(pointKey(point), point);
  }
  const merged = [...unique.values()]
    .filter((point) => pointTimestamp(point) >= range.fromMs)
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
  if (
    merged.length === current.length
    && merged.every((point, index) => point === current[index])
  ) {
    return current;
  }
  return merged;
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

export function useChartRangeController({
  deviceId,
  initialPreset,
  realtimePoints,
  fetchRange,
}: UseChartRangeControllerOptions) {
  const normalizedDeviceId = deviceId?.trim() || null;
  const initialRange = useMemo(() => createRelativeChartRange(initialPreset), [initialPreset, normalizedDeviceId]);
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
  const [metadata, setMetadata] = useState<ChartRangeResponseMetadata | null>(null);
  const [activeQueryKey, setActiveQueryKey] = useState("");
  const requestRef = useRef(new LatestChartRangeRequest());
  const stateRef = useRef(state);
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

    if (cached) {
      setData(cached.value.points);
      setMetadata(cached.value.metadata);
      setActiveQueryKey(cached.queryKey);
    }
    dispatch({ type: "select", range, requestId, cachedRange: cached?.range });

    try {
      const response = await fetchRange(normalizedDeviceId, range, bucketMs, signal);
      if (!requestRef.current.isLatest(requestId)) return;
      rangeCache.set(normalizedDeviceId, {
        queryKey,
        semanticKey: createChartRangeSemanticKey(range),
        range,
        bucketMs,
        value: response,
        updatedAtMs: Date.now(),
      });
      setData(response.points);
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
    const nextRange = createRelativeChartRange(initialPreset);
    dispatch({ type: "reset", range: nextRange });
    setData([]);
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
    const latestTimestamp = realtimePoints.reduce(
      (latest, point) => Math.max(latest, pointTimestamp(point)),
      Number.NEGATIVE_INFINITY,
    );
    if (Number.isFinite(latestTimestamp) && latestTimestamp > activeRange.toMs) {
      dispatch({ type: "advance-realtime", toMs: latestTimestamp });
    }
    setData((current) => mergeRealtimePoints(current, realtimePoints, {
      ...activeRange,
      fromMs: Number.isFinite(latestTimestamp)
        ? latestTimestamp - (activeRange.toMs - activeRange.fromMs)
        : activeRange.fromMs,
      toMs: Number.isFinite(latestTimestamp) ? Math.max(activeRange.toMs, latestTimestamp) : activeRange.toMs,
    }));
  }, [realtimePoints]);

  return {
    state,
    data,
    metadata,
    activeQueryKey,
    selectedRange: state.pendingRange ?? state.activeRange,
    selectRange,
  };
}
