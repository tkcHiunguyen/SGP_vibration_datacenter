import assert from "node:assert/strict";
import test from "node:test";

import { parseTelemetryHistoryPayload } from "./telemetry-history";

test("parses legacy and bucket telemetry without reviving unavailable vibration", () => {
  const points = parseTelemetryHistoryPayload({
    data: {
      items: [
        {
          receivedAt: "2026-07-20T02:05:00.000Z",
          bucketStartedAt: "2026-07-20T02:00:00.000Z",
          sampleCount: 12,
          ax: "1.25",
          payload: { vibrationAvailable: true },
        },
        {
          timestamp: "2026-07-20T01:00:00.000Z",
          ax: 9,
          telemetryUuid: "ignored-while-offline",
          payload: {
            temperatureAvailable: true,
            vibrationAvailable: false,
            temperature: "31.5",
          },
        },
      ],
    },
  });

  assert.deepEqual(points.map((point) => point.receivedAt), [
    "2026-07-20T01:00:00.000Z",
    "2026-07-20T02:05:00.000Z",
  ]);
  assert.equal(points[0]?.temperature, 31.5);
  assert.equal(points[0]?.ax, undefined);
  assert.equal(points[0]?.telemetryUuid, undefined);
  assert.equal(points[1]?.sampleCount, 12);
  assert.equal(points[1]?.ax, 1.25);
});
