import assert from "node:assert/strict";
import test from "node:test";

import { mapDevicesToSensors } from "./sensors";

test("maps per-device axis labels from metadata", () => {
  const sensors = mapDevicesToSensors([
    {
      deviceId: "ESP-AXIS",
      online: true,
      metadata: {
        name: "Axis device",
        axisLabels: {
          ax: "Motor ngang",
          ay: "Tâm trục",
          az: "Motor dọc",
        },
      },
    },
  ]);

  assert.deepEqual(sensors[0]?.axisLabels, {
    ax: "Motor ngang",
    ay: "Tâm trục",
    az: "Motor dọc",
  });
});
