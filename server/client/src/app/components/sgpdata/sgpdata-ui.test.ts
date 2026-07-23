import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(fileURLToPath(import.meta.url));

test("import UI uploads once with real XHR progress and creates the job from uploadId", async () => {
  const source = await readFile(join(root, "ImportUploadPanel.tsx"), "utf8");
  assert.match(source, /new XMLHttpRequest\(\)/);
  assert.match(source, /xhr\.upload\.onprogress/);
  assert.match(source, /\/api\/sgpdata\/import\/uploads/);
  assert.match(source, /JSON\.stringify\(\{ uploadId, mode \}\)/);
  assert.match(source, /"Bổ sung dữ liệu"/);
  assert.match(source, /"Thay thế dữ liệu"/);
  assert.doesNotMatch(source, /idempotent/i);
  assert.match(source, /File không có khoảng thời gian nên chỉ có thể bổ sung dữ liệu an toàn/);
  assert.match(source, /Cấu hình vị trí/);
  assert.doesNotMatch(source, /\/api\/sgpdata\/import\/preview/);
});

test("import hook restores the persistent job and polls only its detail endpoint", async () => {
  const source = await readFile(join(root, "hooks", "useImportJob.ts"), "utf8");
  assert.match(source, /localStorage\.getItem\(IMPORT_JOB_STORAGE_KEY\)/);
  assert.match(source, /\/api\/sgpdata\/import\/jobs\/\$\{encodeURIComponent\(storedId\)\}/);
  assert.match(source, /window\.setTimeout\(poll, 1500\)/);
  assert.doesNotMatch(source, /setInterval/);
});

test("export download uses a direct anchor and never buffers a browser Blob", async () => {
  const source = await readFile(join(root, "ExportJobPanel.tsx"), "utf8");
  assert.match(source, /document\.createElement\("a"\)/);
  assert.match(source, /\/download/);
  assert.doesNotMatch(source, /response\.blob\(\)|createObjectURL/);
  assert.match(source, /Khu vực và thiết bị/);
  assert.match(source, /Ngưỡng và vị trí/);
});

test("end-of-day presets include the final millisecond", async () => {
  const source = await readFile(join(root, "ExportJobPanel.tsx"), "utf8");
  assert.match(source, /23, 59, 59, 999/);
});

test("import and export progress use active motion with reduced-motion fallback", async () => {
  const importSource = await readFile(join(root, "ImportJobProgress.tsx"), "utf8");
  const exportSource = await readFile(join(root, "ExportJobPanel.tsx"), "utf8");
  const styles = await readFile(join(root, "..", "..", "..", "styles", "index.css"), "utf8");

  assert.match(importSource, /sgpdata-progress-fill/);
  assert.match(exportSource, /sgpdata-progress-fill/);
  assert.match(styles, /@keyframes sgpdata-progress-flow/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /@keyframes sgpdata-progress-breathe/);
});
