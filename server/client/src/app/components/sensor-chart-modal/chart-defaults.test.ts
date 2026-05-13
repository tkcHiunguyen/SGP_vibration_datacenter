import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ACCEL_TREND_MODE,
  DEFAULT_HISTORY_PRESET_KEY,
  FFT_AXIS_DISPLAY_ORDER,
  toSpectrumChartData,
  VIBRATION_AXIS_LABELS,
} from "./chart-parts";

test("opens the data view with RMS acceleration over the last hour", () => {
  assert.equal(DEFAULT_ACCEL_TREND_MODE, "rms");
  assert.equal(DEFAULT_HISTORY_PRESET_KEY, "1h");
});

test("keeps the default Axial FFT chart in its original middle position", () => {
  assert.deepEqual(
    FFT_AXIS_DISPLAY_ORDER.map((item) => VIBRATION_AXIS_LABELS[item.deviceAxis]),
    ["Radial H", "Axial", "Radial V"],
  );
});

test("keeps spectrum amplitudes as RMS m/s² values", () => {
  const data = toSpectrumChartData({
    receivedAt: "2026-05-06T10:00:00.000Z",
    axis: "x",
    amplitudes: [2, 4, 1],
    binCount: 3,
    binHz: 10,
    magnitudeUnit: "m/s²",
  });

  assert.deepEqual(
    data.map((row) => ({
      bin: row.bin,
      freq: row.freq,
      amp: row.amp,
      unit: row.unit,
    })),
    [
      { bin: 1, freq: 10, amp: 2, unit: "m/s²" },
      { bin: 2, freq: 20, amp: 4, unit: "m/s²" },
      { bin: 3, freq: 30, amp: 1, unit: "m/s²" },
    ],
  );
});

test("keeps RMS spectrum zero when all amplitudes are zero", () => {
  const data = toSpectrumChartData({
    receivedAt: "2026-05-06T10:00:00.000Z",
    axis: "y",
    amplitudes: [0, 0, 0],
    binCount: 3,
    binHz: 10,
  });

  assert.equal(data.every((row) => row.amp === 0), true);
  assert.equal(data.every((row) => row.unit === "m/s²"), true);
});
