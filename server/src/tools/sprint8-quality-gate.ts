type ApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  payload: T | null;
};

type CohortRecord = {
  cohortId: string;
  name: string;
};

type BatchSummary = {
  runId?: string;
  total: number;
  dispatched: number;
  accepted: number;
  failed: number;
  status?: string;
};

type QualityGateSummary = {
  generatedAt: string;
  registeredCount: number;
  healthBefore: Record<string, unknown> | null;
  healthAfterRegister: Record<string, unknown> | null;
  connectedCheckpoint: Record<string, unknown> | null;
  cohorts: CohortRecord[];
  runs: Array<{
    cohortId: string;
    cohortName: string;
    dryRunStatus: number;
    applyStatus: number;
    dryRun: BatchSummary | null;
    apply: BatchSummary | null;
  }>;
  totals: {
    dryRunTargets: number;
    applyAccepted: number;
    applyFailed: number;
    applySuccessRate: number;
  };
  batchRunsCount: number;
  auditApplyCount: number;
  healthEnd: Record<string, unknown> | null;
};

const BASE_URL = process.env.S8_BASE_URL || 'http://127.0.0.1:8080';
const ADMIN_TOKEN = process.env.S8_ADMIN_TOKEN || 'admin-local-key';
const OPERATOR_TOKEN = process.env.S8_OPERATOR_TOKEN || 'operator-local-key';
const VIEWER_TOKEN = process.env.S8_VIEWER_TOKEN || 'viewer-local-key';

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const MIN_CONNECTED = toInt(getArg('min-connected'), 680);
const HEALTH_TIMEOUT_MS = toInt(getArg('health-timeout-ms'), 90_000);
const CONNECT_TIMEOUT_MS = toInt(getArg('connect-timeout-ms'), 120_000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T = unknown>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<ApiResult<T>> {
  try {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (options.token) {
      headers.set('Authorization', `Bearer ${options.token}`);
    }
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      payload: payload as T,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: { error: error instanceof Error ? error.message : String(error) } as T,
    };
  }
}

async function waitForHealth(timeoutMs: number): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await request<Record<string, unknown>>('/health');
    if (health.ok && health.payload) {
      return health.payload;
    }
    await sleep(1_000);
  }
  return null;
}

async function waitForConnected(minConnected: number, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();
  let lastHealth: Record<string, unknown> | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const health = await request<Record<string, unknown>>('/health');
    if (health.ok && health.payload) {
      lastHealth = health.payload;
      const connected = Number(health.payload.connectedDevices || 0);
      if (connected >= minConnected) {
        return health.payload;
      }
    }
    await sleep(1_000);
  }
  return lastHealth;
}

async function registerDevices(): Promise<number> {
  const registrations: Array<{
    deviceId: string;
    name: string;
    site: string;
    zone: string;
    firmwareVersion: string;
    sensorVersion: string;
  }> = [];

  for (let i = 1; i <= 700; i += 1) {
    let site = 'site-a';
    let zone = 'z1';
    if (i > 250 && i <= 500) {
      site = 'site-b';
      zone = 'z2';
    } else if (i > 500) {
      site = 'site-c';
      zone = 'z3';
    }

    registrations.push({
      deviceId: `esp-${String(i).padStart(3, '0')}`,
      name: `ESP ${i}`,
      site,
      zone,
      firmwareVersion: '1.0.0',
      sensorVersion: '1.0.0',
    });
  }

  const batchSize = 40;
  for (let i = 0; i < registrations.length; i += batchSize) {
    const chunk = registrations.slice(i, i + batchSize);
    const results = await Promise.all(
      chunk.map((body) =>
        request('/api/devices', {
          method: 'POST',
          token: ADMIN_TOKEN,
          body,
        }),
      ),
    );

    const failed = results.find((result) => !result.ok);
    if (failed) {
      throw new Error(`register_devices_failed_http_${failed.status}`);
    }
  }

  return registrations.length;
}

function parseBatchSummary(payload: unknown): BatchSummary | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const data =
    root && typeof root.data === 'object' && root.data !== null
      ? (root.data as Record<string, unknown>)
      : root;

  return {
    runId: typeof data.runId === 'string' ? data.runId : undefined,
    total: Number(data.total || 0),
    dispatched: Number(data.dispatched || 0),
    accepted: Number(data.accepted || 0),
    failed: Number(data.failed || 0),
    status: typeof data.status === 'string' ? data.status : undefined,
  };
}

async function createCohort(name: string, filters: Record<string, unknown>): Promise<CohortRecord> {
  const created = await request('/api/fleet/cohorts', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      name,
      filters,
    },
  });

  if (!created.ok || !created.payload) {
    throw new Error(`create_cohort_failed_${name}_http_${created.status}`);
  }

  const data = (created.payload as Record<string, unknown>).data as Record<string, unknown> | undefined;
  const cohortId = data && typeof data.cohortId === 'string' ? data.cohortId : '';
  const cohortName = data && typeof data.name === 'string' ? data.name : name;
  if (!cohortId) {
    throw new Error(`create_cohort_missing_id_${name}`);
  }

  return {
    cohortId,
    name: cohortName,
  };
}

async function run(): Promise<void> {
  const healthBefore = await waitForHealth(HEALTH_TIMEOUT_MS);
  if (!healthBefore) {
    throw new Error('health_check_timeout');
  }

  const registeredCount = await registerDevices();
  const healthAfterRegisterResult = await request<Record<string, unknown>>('/health');
  const connectedCheckpoint = await waitForConnected(MIN_CONNECTED, CONNECT_TIMEOUT_MS);

  const cohorts: CohortRecord[] = [
    await createCohort(`site-a-${Date.now()}`, { site: 'site-a', status: 'online' }),
    await createCohort(`site-b-${Date.now()}`, { site: 'site-b', status: 'online' }),
    await createCohort(`site-c-${Date.now()}`, { site: 'site-c', status: 'online' }),
  ];

  const runs: QualityGateSummary['runs'] = [];
  for (const cohort of cohorts) {
    const payload = {
      sampleRate: 200,
      fftWindow: 512,
      profile: cohort.name,
    };

    const dryRunResult = await request('/api/fleet/batches/dry-run', {
      method: 'POST',
      token: VIEWER_TOKEN,
      body: {
        cohortId: cohort.cohortId,
        payload,
        note: `dry-run ${cohort.name}`,
      },
    });

    const applyResult = await request('/api/fleet/batches/apply', {
      method: 'POST',
      token: OPERATOR_TOKEN,
      body: {
        cohortId: cohort.cohortId,
        payload,
        note: `apply ${cohort.name}`,
      },
    });

    runs.push({
      cohortId: cohort.cohortId,
      cohortName: cohort.name,
      dryRunStatus: dryRunResult.status,
      applyStatus: applyResult.status,
      dryRun: parseBatchSummary(dryRunResult.payload),
      apply: parseBatchSummary(applyResult.payload),
    });
  }

  await sleep(5_000);

  const batchRuns = await request<Record<string, unknown>>('/api/fleet/batches?limit=20', {
    token: VIEWER_TOKEN,
  });
  const auditApply = await request<Record<string, unknown>>('/api/audit-logs?action=fleet_batch_apply&limit=50', {
    token: ADMIN_TOKEN,
  });
  const healthEndResult = await request<Record<string, unknown>>('/health');

  const totalDryRunTargets = runs.reduce((sum, runItem) => sum + Number(runItem.dryRun?.total || 0), 0);
  const totalApplyAccepted = runs.reduce((sum, runItem) => sum + Number(runItem.apply?.accepted || 0), 0);
  const totalApplyFailed = runs.reduce((sum, runItem) => sum + Number(runItem.apply?.failed || 0), 0);
  const totalApply = totalApplyAccepted + totalApplyFailed;

  const summary: QualityGateSummary = {
    generatedAt: new Date().toISOString(),
    registeredCount,
    healthBefore,
    healthAfterRegister: healthAfterRegisterResult.payload || null,
    connectedCheckpoint,
    cohorts,
    runs,
    totals: {
      dryRunTargets: totalDryRunTargets,
      applyAccepted: totalApplyAccepted,
      applyFailed: totalApplyFailed,
      applySuccessRate: totalApply > 0 ? Number(((totalApplyAccepted / totalApply) * 100).toFixed(2)) : 0,
    },
    batchRunsCount: Array.isArray((batchRuns.payload as Record<string, unknown> | null)?.data)
      ? ((batchRuns.payload as Record<string, unknown>).data as unknown[]).length
      : 0,
    auditApplyCount: Array.isArray((auditApply.payload as Record<string, unknown> | null)?.data)
      ? ((auditApply.payload as Record<string, unknown>).data as unknown[]).length
      : 0,
    healthEnd: healthEndResult.payload || null,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void run();
