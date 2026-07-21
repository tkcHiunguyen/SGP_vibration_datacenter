import assert from "node:assert/strict";
import test from "node:test";

import type { DeviceTelemetryPoint } from "../../data/sensors";
import { buildPlottedTrendSeries, trendSegmentKey, type TrendRow } from "./chart-parts";
import { createRelativeChartRange } from "./chart-range-controller";
import { mergeFetchedRangeWithRealtime, mergeRealtimePoints } from "./useChartRangeController";

const RANGE_END = Date.parse("2026-07-21T12:10:00.000Z");

function realtimePoint(timestampMs: number, index: number): DeviceTelemetryPoint {
  return {
    receivedAt: new Date(timestampMs).toISOString(),
    messageId: `message-${index}`,
    telemetryUuid: `telemetry-${index}`,
    ax: index + 0.25,
    ay: index + 0.5,
    az: index + 0.75,
  };
}

test("twenty realtime events create one canonical point per bucket and one continuous path", () => {
  const range = createRelativeChartRange("1h", RANGE_END);
  let points: DeviceTelemetryPoint[] = [];
  const startMs = RANGE_END - 5 * 60_000;

  for (let index = 0; index < 20; index += 1) {
    points = mergeRealtimePoints(points, [realtimePoint(startMs + index * 10_000, index)], range, 10_000);
  }

  assert.equal(points.length, 20);
  assert.equal(new Set(points.map((point) => point.bucketStartedAt)).size, 20);

  const rows: TrendRow[] = points.map((point) => ({
    ts: Date.parse(point.bucketStartedAt!) + 5_000,
    ax: point.ax,
  }));
  const series = [{ key: "ax", name: "Ax", color: "#22d3ee", strokeWidth: 1.8 }];
  const plotted = buildPlottedTrendSeries(rows, series);
  assert.equal(plotted[0]?.segments.length, 1);
  assert.equal(plotted[0]?.config.strokeWidth, 1.8);

  const firstKey = trendSegmentKey("ax", plotted[0]!.segments[0]!);
  const appendedRows = [...rows, { ts: rows.at(-1)!.ts + 10_000, ax: 99 }];
  const appended = buildPlottedTrendSeries(appendedRows, series);
  assert.equal(trendSegmentKey("ax", appended[0]!.segments[0]!), firstKey);
  assert.equal(appended[0]?.segments.length, 1);
});

test("a delayed realtime event received during a fetch survives the fetched response", () => {
  const range = createRelativeChartRange("1h", RANGE_END);
  const requestStartedAtMs = 10_000;
  const delayedPoint = realtimePoint(RANGE_END - 30_000, 1);
  const merged = mergeFetchedRangeWithRealtime(
    [],
    [{ point: delayedPoint, arrivedAtMs: requestStartedAtMs + 1 }],
    range,
    10_000,
    requestStartedAtMs,
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.messageId, delayedPoint.messageId);
  assert.ok(merged[0]?.bucketStartedAt);
});
