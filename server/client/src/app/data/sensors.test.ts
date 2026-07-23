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

test("does not mark a device abnormal because of weak RSSI", () => {
  const sensors = mapDevicesToSensors([
    {
      deviceId: "ESP-WEAK-RSSI",
      online: true,
      heartbeat: { signal: -100 },
    },
  ]);

  assert.equal(sensors[0]?.status, "normal");
  assert.equal(sensors[0]?.signal, "-100 dBm");
});

test("maps all device setpoints and active alert state", () => {
  const sensors = mapDevicesToSensors(
    [
      {
        deviceId: "ESP-SETPOINT",
        online: true,
        metadata: {
          accelerationSetpoint: 2.5,
          vibrationSetpoint: 12.5,
          displacementSetpoint: 0.4,
          temperatureSetpoint: 45,
        },
      },
    ],
    new Set(["ESP-SETPOINT"]),
  );

  assert.deepEqual(
    {
      acceleration: sensors[0]?.accelerationSetpoint,
      velocity: sensors[0]?.velocitySetpoint,
      displacement: sensors[0]?.displacementSetpoint,
      temperature: sensors[0]?.temperatureSetpoint,
    },
    { acceleration: 2.5, velocity: 12.5, displacement: 0.4, temperature: 45 },
  );
  assert.equal(sensors[0]?.status, "abnormal");
});
