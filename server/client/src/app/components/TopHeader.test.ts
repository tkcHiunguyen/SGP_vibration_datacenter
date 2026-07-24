import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowNotificationDot } from "./TopHeader";

test("hides the notification dot when there are no alerts", () => {
  assert.equal(shouldShowNotificationDot(0), false);
  assert.equal(shouldShowNotificationDot(1), true);
});
