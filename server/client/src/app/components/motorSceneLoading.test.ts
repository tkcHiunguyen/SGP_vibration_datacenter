import assert from "node:assert/strict";
import test from "node:test";

import { calculateSceneLoadProgress } from "./motorSceneLoading";

test("aggregates environment and motor loading into one scene progress value", () => {
  assert.equal(calculateSceneLoadProgress({ environment: 20, motor: 0 }), 10);
  assert.equal(calculateSceneLoadProgress({ environment: 100, motor: 30 }), 65);
  assert.equal(calculateSceneLoadProgress({ environment: 100, motor: 100 }), 100);
});

test("clamps scene loading progress to a valid percentage", () => {
  assert.equal(calculateSceneLoadProgress({ environment: -40, motor: 20 }), 10);
  assert.equal(calculateSceneLoadProgress({ environment: 180, motor: 60 }), 80);
});
