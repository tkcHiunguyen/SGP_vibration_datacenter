import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUTPUT_ROOT = resolve(process.cwd(), 'output/perf/lighthouse');
const MODES = ['mobile', 'desktop'];
const CATEGORY_KEYS = ['performance', 'accessibility', 'best-practices', 'seo'];

const METRIC_KEYS = {
  firstContentfulPaint: 'first-contentful-paint',
  largestContentfulPaint: 'largest-contentful-paint',
  totalBlockingTime: 'total-blocking-time',
  cumulativeLayoutShift: 'cumulative-layout-shift',
  speedIndex: 'speed-index',
};

function average(values) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMsToSeconds(value) {
  if (value === null) {
    return 'N/A';
  }
  return `${(value / 1000).toFixed(2)}s`;
}

function formatMs(value) {
  if (value === null) {
    return 'N/A';
  }
  return `${value.toFixed(0)}ms`;
}

function formatScore(score) {
  if (score === null) {
    return 'N/A';
  }
  return `${Math.round(score * 100)}`;
}

function formatCls(value) {
  if (value === null) {
    return 'N/A';
  }
  return value.toFixed(3);
}

async function findLhrFiles(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return findLhrFiles(fullPath);
      }
      if (/\.report\.json$/i.test(entry.name) || /^lhr-.*\.json$/i.test(entry.name)) {
        return [fullPath];
      }
      return [];
    }),
  );

  return nested.flat();
}

async function loadRuns(mode) {
  const modeDir = join(OUTPUT_ROOT, mode);
  const files = await findLhrFiles(modeDir);
  const runs = await Promise.all(
    files.map(async (filePath) => {
      const [fileStat, fileContent] = await Promise.all([stat(filePath), readFile(filePath, 'utf8')]);
      return {
        filePath,
        mtimeMs: fileStat.mtimeMs,
        report: JSON.parse(fileContent),
      };
    }),
  );

  runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runs.slice(0, 3);
}

function summarizeReports(reports) {
  const categories = Object.fromEntries(
    CATEGORY_KEYS.map((key) => {
      const values = reports
        .map((report) => report.categories?.[key]?.score)
        .filter((value) => typeof value === 'number');
      return [key, average(values)];
    }),
  );

  const metrics = Object.fromEntries(
    Object.entries(METRIC_KEYS).map(([label, auditId]) => {
      const values = reports
        .map((report) => report.audits?.[auditId]?.numericValue)
        .filter((value) => typeof value === 'number');
      return [label, average(values)];
    }),
  );

  return { categories, metrics };
}

function printModeSummary(mode, summary, runCount) {
  console.log(`\n${mode.toUpperCase()} (${runCount} runs)`);
  console.log(
    `Scores  perf:${formatScore(summary.categories.performance)}  a11y:${formatScore(summary.categories.accessibility)}  best:${formatScore(summary.categories['best-practices'])}  seo:${formatScore(summary.categories.seo)}`,
  );
  console.log(
    `Vitals  FCP:${formatMsToSeconds(summary.metrics.firstContentfulPaint)}  LCP:${formatMsToSeconds(summary.metrics.largestContentfulPaint)}  TBT:${formatMs(summary.metrics.totalBlockingTime)}  CLS:${formatCls(summary.metrics.cumulativeLayoutShift)}  SI:${formatMsToSeconds(summary.metrics.speedIndex)}`,
  );
}

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    modes: {},
  };

  for (const mode of MODES) {
    const runs = await loadRuns(mode);
    if (runs.length === 0) {
      console.log(`\n${mode.toUpperCase()} (0 runs)`);
      console.log('Scores  N/A');
      console.log('Vitals  N/A');
      result.modes[mode] = { runCount: 0, categories: {}, metrics: {} };
      continue;
    }

    const reports = runs.map((run) => run.report);
    const summary = summarizeReports(reports);
    printModeSummary(mode, summary, runs.length);
    result.modes[mode] = {
      runCount: runs.length,
      categories: summary.categories,
      metrics: summary.metrics,
      reports: runs.map((run) => run.filePath),
    };
  }

  await mkdir(OUTPUT_ROOT, { recursive: true });
  const summaryPath = join(OUTPUT_ROOT, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nSaved summary: ${summaryPath}`);
}

await main();
