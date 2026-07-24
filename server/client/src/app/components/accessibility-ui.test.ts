import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(fileURLToPath(import.meta.url));

test("file uploaders keep native label and input keyboard behavior", async () => {
  const ota = await readFile(join(root, "OtaManagement.tsx"), "utf8");
  const sgpdata = await readFile(join(root, "sgpdata", "ImportUploadPanel.tsx"), "utf8");

  for (const [source, inputId] of [[ota, "ota-firmware-file"], [sgpdata, "sgpdata-import-file"]] as const) {
    const fileInput = source.match(new RegExp(`<input[\\s\\S]*?id="${inputId}"[\\s\\S]*?\\/>`));

    assert.ok(fileInput);
    assert.match(source, /<label[\s\S]*?htmlFor=/);
    assert.match(fileInput[0], /className="dc-file-input-native"[\s\S]*?type="file"/);
    assert.match(fileInput[0], /event\.key === "Enter"[\s\S]*?event\.key === " "[\s\S]*?event\.currentTarget\.click\(\)/);
    assert.doesNotMatch(fileInput[0], /display:\s*"none"/);
    assert.doesNotMatch(source, /inputRef[\s\S]*?\.click\(\)/);
  }
});

test("sidebar uses separate native navigation and pin buttons", async () => {
  const source = await readFile(join(root, "LeftPanel.tsx"), "utf8");
  const styles = await readFile(join(root, "..", "..", "styles", "index.css"), "utf8");

  assert.match(source, /className="dc-sidebar-nav-link"[\s\S]*?type="button"/);
  assert.match(source, /className="dc-sidebar-pin-button"[\s\S]*?type="button"/);
  assert.doesNotMatch(source, /role="button"/);
  assert.match(styles, /\.dc-wallboard-mode \.dc-sidebar-nav-link/);
  assert.doesNotMatch(styles, /\.dc-sidebar-nav-item > div:first-of-type/);
});

test("routes expose page landmarks, headings, and route-specific titles", async () => {
  const app = await readFile(join(root, "..", "..", "App.tsx"), "utf8");
  const mainPanel = await readFile(join(root, "MainPanel.tsx"), "utf8");
  const page = await readFile(join(root, "ui", "Page.tsx"), "utf8");
  const threeD = await readFile(join(root, "ThreeDPage.tsx"), "utf8");

  assert.match(app, /const NAV_TO_TITLE/);
  assert.match(app, /document\.title = `\$\{NAV_TO_TITLE\[activeNav\]/);
  assert.match(mainPanel, /<main[\s\S]*?<h1/);
  assert.match(page, /<h1/);
  assert.match(threeD, /<main[\s\S]*?<h1/);
});

test("wallboard text follows the active theme palette", async () => {
  const app = await readFile(join(root, "..", "..", "App.tsx"), "utf8");
  const chart = await readFile(join(root, "SensorChartModal.tsx"), "utf8");
  const styles = await readFile(join(root, "..", "..", "styles", "index.css"), "utf8");

  assert.match(app, /"--dc-theme-text-bright": C\.textBright/);
  assert.match(app, /"--dc-theme-text-muted": C\.textMuted/);
  assert.match(chart, /chartTextStyle = \{ fill: C\.textMuted/);
  assert.doesNotMatch(styles, /#c5d5e8|#f8fbff|#fbbf24/);
});
