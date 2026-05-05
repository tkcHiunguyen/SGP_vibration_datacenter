import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeviceAxisLabelUpdate,
  buildDeviceTelemetrySummary,
  DEFAULT_DEVICE_SORT,
  DEVICE_AXIS_DIRECTION_LABELS,
  formatDeviceZoneOptionLabel,
  getLatestDeviceTelemetryPoint,
} from "./device-display";

test("uses zone as the default device sort", () => {
  assert.equal(DEFAULT_DEVICE_SORT, "zone");
});

test("uses user-facing direction labels for axes", () => {
  assert.deepEqual(DEVICE_AXIS_DIRECTION_LABELS, {
    ax: "Horizontal Direction",
    ay: "Axial Direction",
    az: "Vertical Direction",
  });
});

test("formats device edit zone options without duplicated code and name", () => {
  assert.equal(formatDeviceZoneOptionLabel({ code: "TM5", name: "TM5." }), "TM5");
  assert.equal(formatDeviceZoneOptionLabel({ code: "TM5", name: "TM5" }), "TM5");
  assert.equal(formatDeviceZoneOptionLabel({ code: "TM5", name: "Tầng máy 5" }), "TM5 - Tầng máy 5");
  assert.equal(formatDeviceZoneOptionLabel({ code: "TM5", name: "" }), "TM5");
});

test("selects the latest telemetry point by received time", () => {
  const latest = getLatestDeviceTelemetryPoint([
    { receivedAt: "2026-05-05T01:00:00.000Z", temperature: 26.1, ax: 0.1 },
    { receivedAt: "2026-05-05T01:02:00.000Z", temperature: 27.4, ax: 0.2 },
    { receivedAt: "bad-date", temperature: 30, ax: 0.3 },
  ]);

  assert.equal(latest?.temperature, 27.4);
  assert.equal(latest?.ax, 0.2);
});

test("builds compact telemetry stats for device cards", () => {
  assert.deepEqual(
    buildDeviceTelemetrySummary({
      receivedAt: "2026-05-05T01:02:00.000Z",
      temperature: 27.42,
      ax: 0.1234,
      ay: -0.056,
      az: 1.008,
    }),
    [
      { label: "T", value: "27.4°C" },
      { label: "X", value: "0.12g" },
      { label: "Y", value: "-0.06g" },
      { label: "Z", value: "1.01g" },
    ],
  );
});

test("leaves missing telemetry values blank on device cards", () => {
  assert.deepEqual(
    buildDeviceTelemetrySummary({ receivedAt: "2026-05-05T01:02:00.000Z", temperature: 27.42 }),
    [
      { label: "T", value: "27.4°C" },
      { label: "X", value: "" },
      { label: "Y", value: "" },
      { label: "Z", value: "" },
    ],
  );
});

test("uses per-device axis labels on device cards", () => {
  assert.deepEqual(
    buildDeviceTelemetrySummary(
      {
        receivedAt: "2026-05-05T01:02:00.000Z",
        ax: 0.12,
        ay: 0.34,
        az: 0.56,
      },
      { ax: "Ngang", ay: "Tâm", az: "Dọc" },
    ),
    [
      { label: "T", value: "" },
      { label: "Ngang", value: "0.12g" },
      { label: "Tâm", value: "0.34g" },
      { label: "Dọc", value: "0.56g" },
    ],
  );
});

test("builds an axis-label update for one clicked FFT label", () => {
  assert.deepEqual(
    buildDeviceAxisLabelUpdate(
      { ax: "Radial H", ay: "Axial", az: "Radial V" },
      "ay",
      "  Tâm trục  ",
    ),
    { ax: "Radial H", ay: "Tâm trục", az: "Radial V" },
  );

  assert.deepEqual(buildDeviceAxisLabelUpdate({ ax: "Ngang" }, "ax", "   "), undefined);
});
