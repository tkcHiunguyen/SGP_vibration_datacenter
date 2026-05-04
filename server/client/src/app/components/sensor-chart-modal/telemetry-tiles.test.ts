import assert from "node:assert/strict";
import test from "node:test";

import {
  DETAIL_TILE_RAW_LIMIT,
  buildTelemetryDetailTileRequests,
  getTelemetryDetailMode,
} from "./telemetry-tiles";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test("builds raw detail tiles for a small zoom window and skips cached tiles", () => {
  const loadedStartMs = Date.parse("2026-04-30T00:00:00.000Z");
  const visibleStartMs = loadedStartMs + 2 * HOUR_MS;
  const visibleEndMs = visibleStartMs + HOUR_MS;
  const cached = new Set<string>();
  const firstPass = buildTelemetryDetailTileRequests({
    deviceId: "ESP-1",
    visibleStartMs,
    visibleEndMs,
    loadedStartMs,
    loadedEndMs: loadedStartMs + DAY_MS,
    cachedKeys: cached,
  });

  assert.ok(firstPass.length >= 2);
  assert.equal(getTelemetryDetailMode(HOUR_MS, DAY_MS), "raw");
  assert.ok(firstPass.every((tile) => tile.mode === "raw"));
  assert.ok(firstPass.every((tile) => tile.bucketMs === undefined));
  assert.ok(firstPass.every((tile) => tile.limit === DETAIL_TILE_RAW_LIMIT));
  assert.ok(firstPass.every((tile) => tile.tileMs > 0));
  assert.ok(firstPass[0]);

  cached.add(firstPass[0].cacheKey);
  const secondPass = buildTelemetryDetailTileRequests({
    deviceId: "ESP-1",
    visibleStartMs,
    visibleEndMs,
    loadedStartMs,
    loadedEndMs: loadedStartMs + DAY_MS,
    cachedKeys: cached,
  });

  assert.equal(secondPass.some((tile) => tile.cacheKey === firstPass[0]?.cacheKey), false);
});

test("does not fetch extra detail for an unzoomed full-day overview", () => {
  const loadedStartMs = Date.parse("2026-04-30T00:00:00.000Z");

  assert.deepEqual(
    buildTelemetryDetailTileRequests({
      deviceId: "ESP-1",
      visibleStartMs: loadedStartMs,
      visibleEndMs: loadedStartMs + DAY_MS,
      loadedStartMs,
      loadedEndMs: loadedStartMs + DAY_MS,
      cachedKeys: new Set(),
    }),
    [],
  );
});

test("uses a finer bucket for medium zoom windows", () => {
  const loadedStartMs = Date.parse("2026-04-30T00:00:00.000Z");
  const tiles = buildTelemetryDetailTileRequests({
    deviceId: "ESP-1",
    visibleStartMs: loadedStartMs + 4 * HOUR_MS,
    visibleEndMs: loadedStartMs + 12 * HOUR_MS,
    loadedStartMs,
    loadedEndMs: loadedStartMs + DAY_MS,
    cachedKeys: new Set(),
  });

  assert.equal(getTelemetryDetailMode(8 * HOUR_MS, DAY_MS), "bucket-10s");
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every((tile) => tile.mode === "bucket-10s"));
  assert.ok(tiles.every((tile) => tile.bucketMs === 10_000));
  assert.ok(tiles.every((tile) => tile.limit === undefined));
});
