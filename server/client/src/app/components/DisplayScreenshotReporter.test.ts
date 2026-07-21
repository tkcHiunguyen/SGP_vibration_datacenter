import assert from "node:assert/strict";
import test from "node:test";

import {
  createUuidV4,
  getScreenshotRetryDelay,
  isRetryableScreenshotStatus,
} from "./DisplayScreenshotReporter";

test("creates an RFC 4122 UUID without randomUUID for HTTP LAN clients", () => {
  let nextValue = 0;
  const uuid = createUuidV4({
    getRandomValues(array) {
      const bytes = array as Uint8Array;
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = nextValue++;
      return array;
    },
  });

  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(createUuidV4(undefined), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("uses bounded screenshot retry backoff", () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => getScreenshotRetryDelay(index)),
    [1_000, 5_000, 15_000, 30_000, 60_000, null],
  );
  assert.equal(isRetryableScreenshotStatus(500), true);
  assert.equal(isRetryableScreenshotStatus(429), true);
  assert.equal(isRetryableScreenshotStatus(401), false);
  assert.equal(isRetryableScreenshotStatus(413), false);
});
