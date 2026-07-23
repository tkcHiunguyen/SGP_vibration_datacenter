import assert from "node:assert/strict";
import test from "node:test";

import { includeTrendReferenceValueInDomain } from "./chart-parts";

test("trend reference value remains visible after y-axis zoom", () => {
  assert.deepEqual(includeTrendReferenceValueInDomain([0, 20], 10), [0, 20]);

  const expanded = includeTrendReferenceValueInDomain([0, 8], 10);
  assert.equal(expanded[0], 0);
  assert.ok(expanded[1] > 10);
});
