import assert from "node:assert/strict";
import test from "node:test";

import {
  CHART_RANGE_PRESET_MS,
  LatestChartRangeRequest,
  PerDeviceChartRangeLruCache,
  chartRangeReducer,
  createCalendarDayChartRange,
  createChartRangeQueryKey,
  createCustomChartRange,
  createRelativeChartRange,
  getChartRangeBucketMs,
  isRealtimeChartRange,
  type ChartRangeState,
} from "./chart-range-controller";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function stateFor(range = createRelativeChartRange("1d", NOW)): ChartRangeState {
  return { activeRange: range, pendingRange: null, status: "idle", requestId: 0, error: null };
}

test("calendar day is distinct from the last 24 hours", () => {
  const relative = createRelativeChartRange("1d", NOW);
  const calendar = createCalendarDayChartRange("2026-07-20");
  assert.ok(calendar);
  assert.equal(relative.kind, "relative");
  assert.equal(calendar.kind, "calendar-day");
  assert.notEqual(createChartRangeQueryKey("ESP-1", relative), createChartRangeQueryKey("ESP-1", calendar));
  assert.equal(isRealtimeChartRange(calendar), false);
});

test("bucket policy follows the fixed operator-facing ranges", () => {
  for (const [preset, expected] of [
    ["1h", 10_000],
    ["6h", 30_000],
    ["12h", 30_000],
    ["1d", 60_000],
    ["3d", 120_000],
    ["1w", 300_000],
    ["1m", 3_600_000],
  ] as const) {
    assert.equal(getChartRangeBucketMs(createRelativeChartRange(preset, NOW)), expected);
  }
  assert.equal(CHART_RANGE_PRESET_MS["1m"], 30 * 24 * 60 * 60 * 1000);
});

test("reducer accepts the latest range and rejects stale responses", () => {
  const first = createRelativeChartRange("1d", NOW);
  const week = createRelativeChartRange("1w", NOW);
  let state = stateFor(first);
  state = chartRangeReducer(state, { type: "select", range: week, requestId: 1 });
  assert.equal(state.status, "loading");
  state = chartRangeReducer(state, { type: "reject", requestId: 0, error: "old" });
  assert.equal(state.status, "loading");
  state = chartRangeReducer(state, { type: "resolve", range: week, requestId: 1 });
  assert.equal(state.activeRange.kind, "relative");
  assert.equal(state.activeRange.preset, "1w");
  assert.equal(state.pendingRange, null);
});

test("cached selection becomes refreshing without hiding the current chart", () => {
  const day = createRelativeChartRange("1d", NOW);
  const week = createRelativeChartRange("1w", NOW);
  const state = chartRangeReducer(stateFor(day), {
    type: "select",
    range: week,
    requestId: 3,
    cachedRange: week,
  });
  assert.equal(state.status, "refreshing");
  assert.equal(state.activeRange, week);
  assert.equal(state.pendingRange, week);
});

test("request errors retain the currently displayed chart range", () => {
  const day = createRelativeChartRange("1d", NOW);
  const week = createRelativeChartRange("1w", NOW);
  let state = chartRangeReducer(stateFor(day), { type: "select", range: week, requestId: 4 });
  state = chartRangeReducer(state, { type: "reject", requestId: 4, error: "network" });
  assert.equal(state.activeRange, day);
  assert.equal(state.pendingRange, null);
  assert.equal(state.status, "error");
});

test("realtime advances only a relative range", () => {
  const day = createRelativeChartRange("1d", NOW);
  const advanced = chartRangeReducer(stateFor(day), { type: "advance-realtime", toMs: NOW + 5_000 });
  assert.equal(advanced.activeRange.toMs, NOW + 5_000);

  const calendar = createCalendarDayChartRange("2026-07-20");
  assert.ok(calendar);
  const frozen = chartRangeReducer(stateFor(calendar), { type: "advance-realtime", toMs: calendar.toMs + 5_000 });
  assert.equal(frozen.activeRange, calendar);
});

test("LRU preserves multiple ranges and evicts the oldest per device", () => {
  const cache = new PerDeviceChartRangeLruCache<{ value: number }>(2);
  const day = createRelativeChartRange("1d", NOW);
  const week = createRelativeChartRange("1w", NOW);
  const month = createRelativeChartRange("1m", NOW);
  const put = (range: typeof day, value: number) => cache.set("ESP-1", {
    queryKey: createChartRangeQueryKey("ESP-1", range),
    semanticKey: range.kind === "relative" ? `relative:${range.preset}` : "other",
    range,
    bucketMs: getChartRangeBucketMs(range),
    value: { value },
    updatedAtMs: value,
  });
  put(day, 1);
  put(week, 2);
  assert.ok(cache.getExact("ESP-1", createChartRangeQueryKey("ESP-1", day)));
  put(month, 3);
  assert.equal(cache.size("ESP-1"), 2);
  assert.equal(cache.getExact("ESP-1", createChartRangeQueryKey("ESP-1", week)), undefined);
});

test("1d to 1w to 1m to 1d restores the cached day synchronously", () => {
  const cache = new PerDeviceChartRangeLruCache<{ points: number[] }>(4);
  const ranges = ["1d", "1w", "1m"] as const;
  ranges.forEach((preset, index) => {
    const range = createRelativeChartRange(preset, NOW);
    cache.set("ESP-1", {
      queryKey: createChartRangeQueryKey("ESP-1", range),
      semanticKey: `relative:${preset}`,
      range,
      bucketMs: getChartRangeBucketMs(range),
      value: { points: [index] },
      updatedAtMs: index,
    });
  });
  const startedAt = performance.now();
  const restored = cache.getReusable("ESP-1", createRelativeChartRange("1d", NOW + 30_000));
  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(restored?.value.points, [0]);
  assert.ok(elapsedMs < 100);
});

test("latest request coordinator aborts superseded work", () => {
  const coordinator = new LatestChartRangeRequest();
  const first = coordinator.begin();
  const second = coordinator.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(coordinator.isLatest(first.requestId), false);
  assert.equal(coordinator.isLatest(second.requestId), true);
  coordinator.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(coordinator.isLatest(second.requestId), false);
});

test("custom range validates ordering", () => {
  assert.equal(createCustomChartRange(NOW, NOW - 1), null);
  const custom = createCustomChartRange(NOW - 60_000, NOW);
  assert.ok(custom);
  assert.equal(custom.kind, "custom");
});
