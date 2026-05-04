export const DETAIL_TILE_RAW_LIMIT = 12_000;
export const DETAIL_TILE_FETCH_DEBOUNCE_MS = 260;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DETAIL_TILE_MAX_TILES_PER_PASS = 8;
const DETAIL_TILE_PREFETCH_RATIO = 0.15;
const DETAIL_TILE_FULL_WINDOW_RATIO = 0.75;

export type TelemetryDetailMode = "raw" | "bucket-10s";

type DetailTileResolution = {
  mode: TelemetryDetailMode;
  bucketMs?: number;
  tileMs: number;
  limit?: number;
};

export type TelemetryDetailTileRequest = {
  cacheKey: string;
  mode: TelemetryDetailMode;
  fromMs: number;
  toExclusiveMs: number;
  tileMs: number;
  bucketMs?: number;
  limit?: number;
};

export type BuildTelemetryDetailTileRequestsOptions = {
  deviceId: string;
  visibleStartMs: number;
  visibleEndMs: number;
  loadedStartMs: number;
  loadedEndMs: number;
  cachedKeys?: ReadonlySet<string>;
  maxTiles?: number;
};

function isFiniteTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function getDetailTileResolution(visibleWindowMs: number, loadedWindowMs: number): DetailTileResolution | null {
  if (!Number.isFinite(visibleWindowMs) || !Number.isFinite(loadedWindowMs) || visibleWindowMs <= 0 || loadedWindowMs <= 0) {
    return null;
  }

  const zoomedIntoLargeWindow = visibleWindowMs <= Math.min(12 * HOUR_MS, loadedWindowMs * DETAIL_TILE_FULL_WINDOW_RATIO);
  const naturallySmallWindow = loadedWindowMs <= 6 * HOUR_MS;
  if (!zoomedIntoLargeWindow && !naturallySmallWindow) {
    return null;
  }

  if (visibleWindowMs <= 30 * MINUTE_MS) {
    return { mode: "raw", tileMs: 10 * MINUTE_MS, limit: DETAIL_TILE_RAW_LIMIT };
  }

  if (visibleWindowMs <= 2 * HOUR_MS) {
    return { mode: "raw", tileMs: 30 * MINUTE_MS, limit: DETAIL_TILE_RAW_LIMIT };
  }

  if (visibleWindowMs <= 6 * HOUR_MS) {
    return { mode: "raw", tileMs: HOUR_MS, limit: DETAIL_TILE_RAW_LIMIT };
  }

  if (visibleWindowMs <= 12 * HOUR_MS) {
    return { mode: "bucket-10s", bucketMs: 10_000, tileMs: 2 * HOUR_MS };
  }

  return null;
}


export function getTelemetryDetailMode(visibleWindowMs: number, loadedWindowMs: number): TelemetryDetailMode | null {
  return getDetailTileResolution(visibleWindowMs, loadedWindowMs)?.mode ?? null;
}

function createTileCacheKey(deviceId: string, resolution: DetailTileResolution, fromMs: number, toExclusiveMs: number): string {
  return [
    "telemetry-detail-tile-v1",
    deviceId,
    resolution.bucketMs ? `bucket-${resolution.bucketMs}` : "raw",
    Math.floor(fromMs),
    Math.floor(toExclusiveMs),
  ].join(":");
}

export function buildTelemetryDetailTileRequests({
  deviceId,
  visibleStartMs,
  visibleEndMs,
  loadedStartMs,
  loadedEndMs,
  cachedKeys = new Set(),
  maxTiles = DETAIL_TILE_MAX_TILES_PER_PASS,
}: BuildTelemetryDetailTileRequestsOptions): TelemetryDetailTileRequest[] {
  const safeDeviceId = deviceId.trim();
  if (!safeDeviceId) {
    return [];
  }

  if (
    !isFiniteTimestamp(visibleStartMs)
    || !isFiniteTimestamp(visibleEndMs)
    || !isFiniteTimestamp(loadedStartMs)
    || !isFiniteTimestamp(loadedEndMs)
  ) {
    return [];
  }

  const boundedVisibleStartMs = Math.max(loadedStartMs, Math.min(visibleStartMs, loadedEndMs));
  const boundedVisibleEndMs = Math.max(loadedStartMs, Math.min(visibleEndMs, loadedEndMs));
  const visibleWindowMs = boundedVisibleEndMs - boundedVisibleStartMs;
  const loadedWindowMs = loadedEndMs - loadedStartMs;
  const resolution = getDetailTileResolution(visibleWindowMs, loadedWindowMs);
  if (!resolution) {
    return [];
  }

  const prefetchMs = Math.round(visibleWindowMs * DETAIL_TILE_PREFETCH_RATIO);
  const fetchStartMs = Math.max(loadedStartMs, boundedVisibleStartMs - prefetchMs);
  const fetchEndMs = Math.min(loadedEndMs, boundedVisibleEndMs + prefetchMs);
  if (fetchEndMs <= fetchStartMs) {
    return [];
  }

  const tileMs = Math.max(MINUTE_MS, resolution.tileMs);
  const firstTileStartMs = Math.floor(fetchStartMs / tileMs) * tileMs;
  const tiles: TelemetryDetailTileRequest[] = [];
  for (let tileStartMs = firstTileStartMs; tileStartMs < fetchEndMs; tileStartMs += tileMs) {
    const fromMs = Math.max(loadedStartMs, tileStartMs);
    const toExclusiveMs = Math.min(loadedEndMs, tileStartMs + tileMs);
    if (toExclusiveMs <= fetchStartMs || fromMs >= fetchEndMs || toExclusiveMs <= fromMs) {
      continue;
    }

    const cacheKey = createTileCacheKey(safeDeviceId, resolution, fromMs, toExclusiveMs);
    if (cachedKeys.has(cacheKey)) {
      continue;
    }

    tiles.push({
      cacheKey,
      mode: resolution.mode,
      fromMs,
      toExclusiveMs,
      tileMs,
      bucketMs: resolution.bucketMs,
      limit: resolution.limit,
    });
  }

  return tiles.slice(0, Math.max(1, Math.floor(maxTiles)));
}
