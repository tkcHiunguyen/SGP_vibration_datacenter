import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { launch as launchChrome } from 'chrome-launcher';

const OUTPUT_DIR = resolve(process.cwd(), 'output/perf/ux-delay');
const DEFAULT_URL = 'http://127.0.0.1:8080/app/';
const DEFAULT_RUNS = 5;
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const SELECTORS = {
  deviceCard: '[data-ux="device-card"]',
  deviceSearch: '[data-ux="device-search"]',
  deviceGrid: '[data-ux="device-grid"]',
  pageSizeSelect: '[data-ux="page-size-select"]',
  chartModal: '[data-ux="chart-modal"]',
  chartClose: '[data-ux="chart-modal"] button[title="Đóng"]',
  filterOnline: '[data-ux="filter-online"]',
  filterAll: '[data-ux="filter-all"]',
};

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    runs: DEFAULT_RUNS,
    startServer: false,
  };

  for (const arg of argv) {
    if (arg === '--start-server') {
      args.startServer = true;
      continue;
    }
    if (arg.startsWith('--url=')) {
      args.url = arg.slice('--url='.length);
      continue;
    }
    if (arg.startsWith('--runs=')) {
      const parsed = Number(arg.slice('--runs='.length));
      if (Number.isFinite(parsed) && parsed > 0) {
        args.runs = Math.floor(parsed);
      }
    }
  }

  return args;
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(values) {
  const clean = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (clean.length === 0) {
    return { count: 0, min: null, p50: null, p95: null, max: null, avg: null };
  }
  return {
    count: clean.length,
    min: Math.min(...clean),
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
    max: Math.max(...clean),
    avg: clean.reduce((sum, value) => sum + value, 0) / clean.length,
  };
}

function formatMs(value) {
  return value === null || value === undefined ? 'N/A' : `${Math.round(value)}ms`;
}

async function canReach(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (await canReach(url)) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function maybeStartServer(url, enabled) {
  if (!enabled || await canReach(url)) {
    return null;
  }

  const child = spawn('pnpm', ['-C', 'server', 'start:prod'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForUrl(url);
    return child;
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\n${stderr.trim()}`);
  }
}

async function stopServer(child) {
  if (!child) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise((resolveStop) => {
    child.once('exit', resolveStop);
    setTimeout(resolveStop, 2000);
  });
}

async function waitForPaint(page) {
  await page.evaluate(
    () => new Promise((resolvePaint) => {
      requestAnimationFrame(() => requestAnimationFrame(resolvePaint));
    }),
  );
}

async function measure(name, action) {
  const startedAt = performance.now();
  await action();
  return {
    name,
    ms: performance.now() - startedAt,
  };
}

async function countCards(page) {
  return page.$$eval(SELECTORS.deviceCard, (cards) => cards.length);
}

async function getFirstDevice(page) {
  return page.$eval(SELECTORS.deviceCard, (card) => ({
    id: card.getAttribute('data-device-id') || '',
    name: card.getAttribute('data-device-name') || '',
    online: card.getAttribute('data-device-online') === 'true',
  }));
}

async function setSearchValue(page, value) {
  await page.$eval(
    SELECTORS.deviceSearch,
    (input, nextValue) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, nextValue);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(nextValue) }));
    },
    value,
  );
}

async function installPageInstrumentation(page) {
  await page.evaluateOnNewDocument(() => {
    window.__uxLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__uxLongTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // Long Task API is best-effort in benchmark mode.
    }
  });
}

async function collectBrowserStats(page) {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    }));
    const navigation = performance.getEntriesByType('navigation')[0];
    const apiDevices = resources.filter((entry) => entry.name.includes('/api/devices?limit=500')).at(-1) || null;
    const telemetry = resources.filter((entry) => /\/api\/devices\/.+\/telemetry\?/.test(entry.name));
    return {
      navigation: navigation
        ? {
            domInteractive: navigation.domInteractive,
            domContentLoaded: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
            responseStart: navigation.responseStart,
          }
        : null,
      apiDevices,
      telemetryRequests: telemetry.map((entry) => ({
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
      })),
      longTasks: window.__uxLongTasks || [],
    };
  });
}

async function runSingleBenchmark(browser, url, runIndex) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setCacheEnabled(false);
  await installPageInstrumentation(page);

  const interactions = {};
  const skipped = [];
  let initialCardCount = 0;
  let firstDevice = null;

  try {
    const appReady = await measure('dashboardReady', async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForSelector(SELECTORS.deviceCard, { visible: true, timeout: 30_000 });
      await waitForPaint(page);
    });
    interactions[appReady.name] = appReady.ms;

    initialCardCount = await countCards(page);
    firstDevice = await getFirstDevice(page);

    if (firstDevice.id) {
      const searchExact = await measure('searchExactDevice', async () => {
        await setSearchValue(page, firstDevice.id);
        await page.waitForFunction(
          (selector, deviceId) => {
            const cards = Array.from(document.querySelectorAll(selector));
            return cards.length > 0 && cards.every((card) => card.getAttribute('data-device-id') === deviceId);
          },
          { timeout: 10_000 },
          SELECTORS.deviceCard,
          firstDevice.id,
        );
        await waitForPaint(page);
      });
      interactions[searchExact.name] = searchExact.ms;

      const clearSearch = await measure('clearSearch', async () => {
        await setSearchValue(page, '');
        await page.waitForFunction(
          (selector, expectedCount) => document.querySelectorAll(selector).length >= expectedCount,
          { timeout: 10_000 },
          SELECTORS.deviceCard,
          Math.min(initialCardCount, 10),
        );
        await waitForPaint(page);
      });
      interactions[clearSearch.name] = clearSearch.ms;
    } else {
      skipped.push('searchExactDevice');
      skipped.push('clearSearch');
    }

    const filterOnline = await measure('filterOnline', async () => {
      await page.click(SELECTORS.filterOnline);
      await waitForPaint(page);
    });
    interactions[filterOnline.name] = filterOnline.ms;

    const filterAll = await measure('filterAll', async () => {
      await page.click(SELECTORS.filterAll);
      await page.waitForSelector(SELECTORS.deviceCard, { visible: true, timeout: 10_000 });
      await waitForPaint(page);
    });
    interactions[filterAll.name] = filterAll.ms;

    const pageSizeOptions = await page.$$eval(`${SELECTORS.pageSizeSelect} option`, (options) =>
      options.map((option) => option.value),
    );
    const targetPageSize = pageSizeOptions.includes('50') ? '50' : pageSizeOptions.at(-1);
    if (targetPageSize) {
      const pageSizeChange = await measure(`pageSize${targetPageSize}`, async () => {
        await page.select(SELECTORS.pageSizeSelect, targetPageSize);
        await waitForPaint(page);
      });
      interactions.pageSizeChange = pageSizeChange.ms;
    } else {
      skipped.push('pageSizeChange');
    }

    const openChartCold = await measure('openDataModalCold', async () => {
      await page.$eval(SELECTORS.deviceCard, (card) => card.click());
      await page.waitForSelector(SELECTORS.chartModal, { visible: true, timeout: 20_000 });
      await page.waitForFunction(
        (selector) => {
          const modal = document.querySelector(selector);
          return Boolean(modal) && Number(getComputedStyle(modal).opacity) > 0.9;
        },
        { timeout: 20_000 },
        SELECTORS.chartModal,
      );
      await waitForPaint(page);
    });
    interactions[openChartCold.name] = openChartCold.ms;

    const chartReady = await measure('openDataModalReady', async () => {
      await page.waitForFunction(
        (selector) => {
          const modal = document.querySelector(selector);
          return Boolean(modal) && modal.getAttribute('data-ux-chart-ready') === 'true';
        },
        { timeout: 30_000 },
        SELECTORS.chartModal,
      );
      await waitForPaint(page);
    });
    interactions[chartReady.name] = chartReady.ms;

    await page.click(SELECTORS.chartClose);
    await page.waitForFunction(
      (selector) => !document.querySelector(selector),
      { timeout: 10_000 },
      SELECTORS.chartModal,
    );

    const openChartWarm = await measure('openDataModalWarm', async () => {
      await page.hover(SELECTORS.deviceCard);
      await waitForPaint(page);
      await page.click(SELECTORS.deviceCard);
      await page.waitForSelector(SELECTORS.chartModal, { visible: true, timeout: 20_000 });
      await page.waitForFunction(
        (selector) => {
          const modal = document.querySelector(selector);
          return Boolean(modal) && Number(getComputedStyle(modal).opacity) > 0.9;
        },
        { timeout: 20_000 },
        SELECTORS.chartModal,
      );
      await waitForPaint(page);
    });
    interactions[openChartWarm.name] = openChartWarm.ms;

    const browserStats = await collectBrowserStats(page);

    return {
      run: runIndex,
      viewport: VIEWPORT,
      initialCardCount,
      firstDevice,
      interactions,
      skipped,
      browserStats,
    };
  } finally {
    await page.close();
  }
}

function printSummary(summary) {
  console.log('\nDesktop UX delay benchmark');
  console.log(`Runs: ${summary.runs.length}`);
  console.log(`URL: ${summary.url}`);
  console.log('\nMetric                 p50     p95     avg     max');
  for (const [name, stats] of Object.entries(summary.metrics)) {
    console.log(
      `${name.padEnd(22)} ${formatMs(stats.p50).padStart(7)} ${formatMs(stats.p95).padStart(7)} ${formatMs(stats.avg).padStart(7)} ${formatMs(stats.max).padStart(7)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = await maybeStartServer(args.url, args.startServer);
  let chrome;
  let browser;

  try {
    chrome = await launchChrome({
      chromeFlags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      ],
    });
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${chrome.port}`,
      defaultViewport: VIEWPORT,
    });

    const runs = [];
    for (let i = 1; i <= args.runs; i += 1) {
      runs.push(await runSingleBenchmark(browser, args.url, i));
    }

    const metricNames = [...new Set(runs.flatMap((run) => Object.keys(run.interactions)))];
    const metrics = Object.fromEntries(
      metricNames.map((name) => [
        name,
        summarize(runs.map((run) => run.interactions[name])),
      ]),
    );

    const apiDevices = summarize(
      runs
        .map((run) => run.browserStats.apiDevices?.duration)
        .filter((value) => typeof value === 'number'),
    );
    const longTasks = runs.flatMap((run) => run.browserStats.longTasks || []);
    const result = {
      generatedAt: new Date().toISOString(),
      url: args.url,
      runs,
      metrics,
      api: {
        devicesListDuration: apiDevices,
      },
      longTasks: {
        count: longTasks.length,
        maxDuration: longTasks.length ? Math.max(...longTasks.map((task) => task.duration)) : 0,
        totalDuration: longTasks.reduce((sum, task) => sum + task.duration, 0),
      },
    };

    await mkdir(OUTPUT_DIR, { recursive: true });
    const outputPath = resolve(OUTPUT_DIR, 'summary.json');
    await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
    printSummary(result);
    console.log(`\nSaved summary: ${outputPath}`);
  } finally {
    if (browser) {
      await browser.disconnect();
    }
    if (chrome) {
      await chrome.kill();
    }
    await stopServer(server);
  }
}

await main();
