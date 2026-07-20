import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdaptiveMissingDataBands,
  getAdaptiveMissingDataThresholdMs,
  getStatusBandMinimumDurationMs,
  normalizeOfflineStatusBands,
} from "./telemetry-continuity";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test("hourly buckets do not become no-data stripes on a 30-day chart", () => {
  const startMs = Date.parse("2026-06-19T00:00:00.000Z");
  const rows = Array.from({ length: 24 }, (_, index) => ({
    ts: startMs + index * HOUR_MS + 12 * 60 * 1000,
    coverageStartMs: startMs + index * HOUR_MS,
    coverageEndMs: startMs + (index + 1) * HOUR_MS,
    value: 1,
  }));
  const thresholdMs = getAdaptiveMissingDataThresholdMs(30 * DAY_MS, HOUR_MS);
  const gaps = buildAdaptiveMissingDataBands(rows, [{
    status: "online",
    from: startMs,
    to: startMs + DAY_MS,
  }], {
    thresholdMs,
    expectedStepMs: HOUR_MS,
    windowStartMs: startMs,
    windowEndMs: startMs + DAY_MS,
    hasValue: (row) => row.value > 0,
  });

  assert.equal(thresholdMs, 3 * HOUR_MS);
  assert.deepEqual(gaps, []);
});

test("a sustained outage remains visible after adaptive filtering", () => {
  const startMs = Date.parse("2026-06-19T00:00:00.000Z");
  const rows = [0, 1, 2, 8, 9].map((hour) => ({
    ts: startMs + hour * HOUR_MS + HOUR_MS / 2,
    coverageStartMs: startMs + hour * HOUR_MS,
    coverageEndMs: startMs + (hour + 1) * HOUR_MS,
    value: 1,
  }));
  const gaps = buildAdaptiveMissingDataBands(rows, [{
    status: "online",
    from: startMs,
    to: startMs + 10 * HOUR_MS,
  }], {
    thresholdMs: 3 * HOUR_MS,
    expectedStepMs: HOUR_MS,
    windowStartMs: startMs,
    windowEndMs: startMs + 10 * HOUR_MS,
    hasValue: (row) => row.value > 0,
  });

  assert.deepEqual(gaps, [{ from: startMs + 3 * HOUR_MS, to: startMs + 8 * HOUR_MS }]);
});

test("bucket coverage wins over a delayed received timestamp", () => {
  const startMs = Date.parse("2026-06-19T00:00:00.000Z");
  const rows = [0, 1, 2].map((hour) => ({
    ts: startMs + hour * HOUR_MS + 55 * 60 * 1000,
    coverageStartMs: startMs + hour * HOUR_MS,
    coverageEndMs: startMs + (hour + 1) * HOUR_MS,
    value: 1,
  }));
  const gaps = buildAdaptiveMissingDataBands(rows, [{
    status: "online",
    from: startMs,
    to: startMs + 3 * HOUR_MS,
  }], {
    thresholdMs: HOUR_MS,
    expectedStepMs: HOUR_MS,
    windowStartMs: startMs,
    windowEndMs: startMs + 3 * HOUR_MS,
    hasValue: (row) => row.value > 0,
  });

  assert.deepEqual(gaps, []);
});

test("long-range status display hides short flickers and merges nearby outages", () => {
  const startMs = Date.parse("2026-06-19T00:00:00.000Z");
  const minimumDurationMs = getStatusBandMinimumDurationMs(30 * DAY_MS, HOUR_MS);
  const normalized = normalizeOfflineStatusBands([
    { status: "offline", from: startMs, to: startMs + 20 * 60 * 1000, reason: "ping timeout" },
    { status: "offline", from: startMs + 2 * HOUR_MS, to: startMs + 4 * HOUR_MS, reason: "server_offline" },
    { status: "offline", from: startMs + 4 * HOUR_MS + 10 * 60 * 1000, to: startMs + 6 * HOUR_MS, reason: "server_offline" },
  ], {
    minimumDurationMs,
    mergeToleranceMs: HOUR_MS,
    windowStartMs: startMs,
    windowEndMs: startMs + DAY_MS,
  });

  assert.equal(minimumDurationMs, HOUR_MS);
  assert.deepEqual(normalized, [{
    status: "offline",
    from: startMs + 2 * HOUR_MS,
    to: startMs + 6 * HOUR_MS,
    reason: "server_offline",
  }]);
});
