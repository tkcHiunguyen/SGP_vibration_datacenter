import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppVersionReloadUrl,
  parseAppVersionManifest,
  shouldReloadForAppVersion,
} from "./app-version";

test("reloads only when the server exposes a different app build", () => {
  assert.equal(shouldReloadForAppVersion("build-a", "build-a"), false);
  assert.equal(shouldReloadForAppVersion("build-a", "build-b"), true);
  assert.equal(shouldReloadForAppVersion("", "build-b"), false);
});

test("parses the generated app version manifest", () => {
  assert.deepEqual(
    parseAppVersionManifest({ buildId: " build-b ", builtAt: "2026-07-21T00:00:00.000Z" }),
    { buildId: "build-b", builtAt: "2026-07-21T00:00:00.000Z" },
  );
  assert.equal(parseAppVersionManifest({ buildId: "" }), null);
});

test("adds a cache-busting build id without changing the current page", () => {
  const url = createAppVersionReloadUrl("http://localhost:8080/dashboard?zone=A", "build-b");
  assert.equal(url, "http://localhost:8080/dashboard?zone=A&ui_version=build-b");
});
