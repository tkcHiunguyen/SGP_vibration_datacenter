import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ACCEL_TREND_MODE,
  DEFAULT_HISTORY_PRESET_KEY,
  FFT_AXIS_DISPLAY_ORDER,
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
