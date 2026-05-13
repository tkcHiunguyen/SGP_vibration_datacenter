import assert from "node:assert/strict";
import test from "node:test";

import { calculateSceneLoadProgress } from "./motorSceneLoading";

test("aggregates environment, motor model, machine train, and sensor loading into one scene progress value", () => {
  assert.equal(calculateSceneLoadProgress({ environment: 30, motorModel: 0, machineTrainModel: 0, sensorModel: 0 }), 8);
  assert.equal(calculateSceneLoadProgress({ environment: 100, motorModel: 50, machineTrainModel: 30, sensorModel: 20 }), 50);
  assert.equal(calculateSceneLoadProgress({ environment: 100, motorModel: 100, machineTrainModel: 100, sensorModel: 100 }), 100);
});

test("clamps scene loading progress to a valid percentage", () => {
  assert.equal(calculateSceneLoadProgress({ environment: -40, motorModel: 20, machineTrainModel: 20, sensorModel: 20 }), 15);
  assert.equal(calculateSceneLoadProgress({ environment: 180, motorModel: 60, machineTrainModel: 60, sensorModel: 60 }), 70);
});
