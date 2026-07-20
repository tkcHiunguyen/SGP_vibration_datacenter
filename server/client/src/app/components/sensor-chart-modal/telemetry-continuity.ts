type TelemetryCoverageRow = {
  ts: number;
  coverageStartMs?: number;
  coverageEndMs?: number;
};

type TelemetryContinuityStatusBand = {
  from: number;
  to: number;
  status: "online" | "offline";
  reason?: string;
};

type TelemetryContinuityGap = {
  from: number;
  to: number;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function getAdaptiveMissingDataThresholdMs(visibleWindowMs: number, expectedStepMs: number): number {
  const safeWindowMs = Math.max(1, visibleWindowMs);
  const safeStepMs = Math.max(1_000, expectedStepMs);
  const windowFloorMs = safeWindowMs <= 6 * HOUR_MS
    ? 5 * MINUTE_MS
    : safeWindowMs <= DAY_MS
      ? 10 * MINUTE_MS
      : safeWindowMs <= 3 * DAY_MS
        ? 30 * MINUTE_MS
        : safeWindowMs <= 7 * DAY_MS
          ? HOUR_MS
          : 3 * HOUR_MS;
  return Math.max(windowFloorMs, Math.round(safeStepMs * 3));
}

export function getStatusBandMinimumDurationMs(visibleWindowMs: number, expectedStepMs: number): number {
  const safeWindowMs = Math.max(1, visibleWindowMs);
  const safeStepMs = Math.max(1_000, expectedStepMs);
  return Math.max(30_000, safeStepMs, Math.round(safeWindowMs / 2_000));
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toCoverage(row: TelemetryCoverageRow): TelemetryContinuityGap | null {
  if (!finite(row.ts)) return null;
  const rawStart = finite(row.coverageStartMs) ? row.coverageStartMs : row.ts;
  const rawEnd = finite(row.coverageEndMs) ? row.coverageEndMs : row.ts;
  return {
    from: Math.min(rawStart, rawEnd),
    to: Math.max(rawStart, rawEnd),
  };
}

function mergeSegments(segments: TelemetryContinuityGap[], toleranceMs = 0): TelemetryContinuityGap[] {
  return segments
    .filter((segment) => finite(segment.from) && finite(segment.to) && segment.to >= segment.from)
    .sort((left, right) => left.from - right.from)
    .reduce<TelemetryContinuityGap[]>((merged, segment) => {
      const previous = merged[merged.length - 1];
      if (previous && segment.from <= previous.to + toleranceMs) {
        previous.to = Math.max(previous.to, segment.to);
      } else {
        merged.push({ ...segment });
      }
      return merged;
    }, []);
}

export function buildAdaptiveMissingDataBands<T extends TelemetryCoverageRow>(
  rows: T[],
  statusBands: TelemetryContinuityStatusBand[],
  options: {
    thresholdMs: number;
    expectedStepMs: number;
    windowStartMs: number;
    windowEndMs: number;
    hasValue: (row: T) => boolean;
  },
): TelemetryContinuityGap[] {
  const safeStartMs = Math.min(options.windowStartMs, options.windowEndMs);
  const safeEndMs = Math.max(options.windowStartMs, options.windowEndMs);
  if (safeEndMs <= safeStartMs || options.thresholdMs <= 0) return [];

  const coverageToleranceMs = Math.max(1_000, Math.round(options.expectedStepMs * 0.25));
  const coverage = mergeSegments(
    rows
      .filter(options.hasValue)
      .map(toCoverage)
      .filter((segment): segment is TelemetryContinuityGap => Boolean(segment))
      .map((segment) => ({
        from: Math.max(safeStartMs, segment.from),
        to: Math.min(safeEndMs, segment.to),
      }))
      .filter((segment) => segment.to >= segment.from),
    coverageToleranceMs,
  );

  const gaps: TelemetryContinuityGap[] = [];
  for (const band of statusBands) {
    if (band.status !== "online") continue;
    const bandStart = Math.max(safeStartMs, Math.min(band.from, band.to));
    const bandEnd = Math.min(safeEndMs, Math.max(band.from, band.to));
    if (bandEnd - bandStart <= options.thresholdMs) continue;

    let coveredUntil = bandStart;
    for (const segment of coverage) {
      if (segment.to < bandStart) continue;
      if (segment.from > bandEnd) break;
      const segmentStart = Math.max(bandStart, segment.from);
      const segmentEnd = Math.min(bandEnd, segment.to);
      if (segmentStart - coveredUntil > options.thresholdMs) {
        gaps.push({ from: coveredUntil, to: segmentStart });
      }
      coveredUntil = Math.max(coveredUntil, segmentEnd);
    }
    if (bandEnd - coveredUntil > options.thresholdMs) {
      gaps.push({ from: coveredUntil, to: bandEnd });
    }
  }

  return mergeSegments(gaps, coverageToleranceMs);
}

export function normalizeOfflineStatusBands(
  statusBands: TelemetryContinuityStatusBand[],
  options: {
    minimumDurationMs: number;
    mergeToleranceMs: number;
    windowStartMs: number;
    windowEndMs: number;
  },
): TelemetryContinuityStatusBand[] {
  const safeStartMs = Math.min(options.windowStartMs, options.windowEndMs);
  const safeEndMs = Math.max(options.windowStartMs, options.windowEndMs);
  return statusBands
    .filter((band) => band.status === "offline")
    .map((band) => ({
      ...band,
      from: Math.max(safeStartMs, Math.min(band.from, band.to)),
      to: Math.min(safeEndMs, Math.max(band.from, band.to)),
    }))
    .filter((band) => band.to - band.from >= options.minimumDurationMs)
    .sort((left, right) => left.from - right.from)
    .reduce<TelemetryContinuityStatusBand[]>((merged, band) => {
      const previous = merged[merged.length - 1];
      if (previous && band.from <= previous.to + options.mergeToleranceMs) {
        previous.to = Math.max(previous.to, band.to);
        if (previous.reason !== band.reason) previous.reason = previous.reason ?? band.reason;
      } else {
        merged.push({ ...band });
      }
      return merged;
    }, []);
}
