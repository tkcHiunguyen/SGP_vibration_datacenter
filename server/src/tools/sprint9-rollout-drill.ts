type ApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  payload: T | null;
};

type RolloutDrillReport = {
  generatedAt: string;
  config: {
    baseUrl: string;
    deviceCount: number;
    minConnected: number;
    registerMetadata: boolean;
    canarySize: number;
    waveSize: number;
    waveIntervalMs: number;
    pollTimeoutMs: number;
  };
  checkpoints: {
    healthBefore: Record<string, unknown> | null;
    healthAfterRegister: Record<string, unknown> | null;
    connectedCheckpoint: Record<string, unknown> | null;
  };
  rollout: {
    cohortId: string;
    planId: string;
    targetCount: number;
    finalStatus: string;
    executionStatus: string;
    sentCount: number;
    ackedCount: number;
    timeoutCount: number;
    failedCount: number;
    medianWaveDurationMs: number;
    successRatio: number;
    timeoutRatio: number;
    failureRatio: number;
    completedWaveCount: number;
    rollbackWaveCount: number;
    eventTypes: string[];
    autoStopDetected: boolean;
    rollbackCompletedDetected: boolean;
  };
  qualityGate: {
    pass: boolean;
    checks: Array<{ name: string; pass: boolean; detail?: string }>;
  };
};

const BASE_URL = process.env.S9_BASE_URL || 'http://127.0.0.1:8080';
const ADMIN_TOKEN = process.env.S9_ADMIN_TOKEN || 'admin-local-key';
const OPERATOR_TOKEN = process.env.S9_OPERATOR_TOKEN || 'operator-local-key';

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deviceIdFromIndex(index: number): string {
  return `esp-${String(index).padStart(3, '0')}`;
}

function pickDeviceIds(start: number, count: number, maxDeviceIndex: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = start + i;
    if (index > maxDeviceIndex) {
      break;
    }
    result.push(deviceIdFromIndex(index));
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
    const headers = new Headers({
      Accept: 'application/json',
    });
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

async function registerDevices(deviceCount: number, site: string, zone: string): Promise<void> {
  const registrations: Array<{
    deviceId: string;
    name: string;
    site: string;
    zone: string;
    firmwareVersion: string;
    sensorVersion: string;
  }> = [];

  for (let index = 1; index <= deviceCount; index += 1) {
    registrations.push({
      deviceId: deviceIdFromIndex(index),
      name: `ESP ${index}`,
      site,
      zone,
      firmwareVersion: '1.2.0',
      sensorVersion: '1.1.0',
    });
  }

  const batchSize = 40;
  for (let offset = 0; offset < registrations.length; offset += batchSize) {
    const chunk = registrations.slice(offset, offset + batchSize);
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
}

async function createCohort(site: string): Promise<{ cohortId: string; name: string }> {
  const hasSite = Boolean(site.trim());
  const normalizedSite = site.trim();
  const name = hasSite ? `s9-rollout-${normalizedSite}-${Date.now()}` : `s9-rollout-esp-online-${Date.now()}`;
  const result = await request('/api/fleet/cohorts', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      name,
      filters: {
        ...(hasSite ? { site: normalizedSite } : {}),
        status: 'online',
        search: 'esp-',
      },
    },
  });

  if (!result.ok || !result.payload) {
    throw new Error(`create_cohort_failed_http_${result.status}`);
  }

  const data = asRecord(asRecord(result.payload).data);
  const cohortId = String(data.cohortId || '');
  const cohortName = String(data.name || name);
  if (!cohortId) {
    throw new Error('create_cohort_missing_id');
  }
  return { cohortId, name: cohortName };
}

async function createRolloutPlan(input: {
  cohortId: string;
  deviceCount: number;
  canarySize: number;
  waveSize: number;
  waveIntervalMs: number;
}): Promise<{ planId: string; targetCount: number }> {
  const thirdWaveStart = input.canarySize + input.waveSize + 1;
  const failedDeviceIds = pickDeviceIds(thirdWaveStart, Math.max(24, Math.floor(input.waveSize * 0.08)), input.deviceCount);
  const timeoutDeviceIds = pickDeviceIds(
    thirdWaveStart + failedDeviceIds.length,
    Math.max(12, Math.floor(input.waveSize * 0.04)),
    input.deviceCount,
  );

  const result = await request('/api/rollouts', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      name: `s9-rollout-900-devices-${Date.now()}`,
      cohortId: input.cohortId,
      strategy: 'canary',
      payload: {
        sampleRate: 250,
        fftWindow: 1024,
        profile: 's9-rollout-profile',
      },
      rollbackPayload: {
        sampleRate: 100,
        fftWindow: 512,
        profile: 'rollback-safe-profile',
      },
      waveSize: input.waveSize,
      canarySize: input.canarySize,
      waveIntervalMs: input.waveIntervalMs,
      autoRollback: true,
      gate: {
        maxFailureRatio: 0.05,
        maxTimeoutRatio: 0.05,
        minSuccessRatio: 0.9,
      },
      faultInjection: {
        failedDeviceIds,
        timeoutDeviceIds,
      },
    },
  });

  if (!result.ok || !result.payload) {
    throw new Error(`create_rollout_failed_http_${result.status}`);
  }

  const data = asRecord(asRecord(result.payload).data);
  const plan = asRecord(data.plan);
  const planId = String(plan.planId || '');
  const targetCount = Number(plan.targetCount || 0);
  if (!planId) {
    throw new Error('create_rollout_missing_plan_id');
  }
  return {
    planId,
    targetCount,
  };
}

async function startRollout(planId: string): Promise<void> {
  const result = await request(`/api/rollouts/${encodeURIComponent(planId)}/start`, {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      note: 'Sprint 9 rollout drill start',
    },
  });
  if (!result.ok) {
    throw new Error(`start_rollout_failed_http_${result.status}`);
  }
}

async function pollRolloutUntilDone(
  planId: string,
  timeoutMs: number,
): Promise<{
  planStatus: string;
  execution: Record<string, unknown>;
  summary: Record<string, unknown>;
  waves: Record<string, unknown>[];
  events: Record<string, unknown>[];
}> {
  const startedAt = Date.now();
  let lastPlanStatus = 'unknown';
  let lastExecution: Record<string, unknown> = {};
  let lastSummary: Record<string, unknown> = {};
  let lastWaves: Record<string, unknown>[] = [];
  let lastEvents: Record<string, unknown>[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    await request('/api/rollouts/process', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: {},
    });

    const [detail, waves, events] = await Promise.all([
      request(`/api/rollouts/${encodeURIComponent(planId)}`, { token: ADMIN_TOKEN }),
      request(`/api/rollouts/${encodeURIComponent(planId)}/waves`, { token: ADMIN_TOKEN }),
      request(`/api/rollouts/${encodeURIComponent(planId)}/events?limit=200`, { token: ADMIN_TOKEN }),
    ]);

    if (detail.ok && detail.payload) {
      const data = asRecord(asRecord(detail.payload).data);
      const plan = asRecord(data.plan);
      const execution = asRecord(data.execution);
      const summary = asRecord(data.summary);
      lastPlanStatus = String(plan.status || lastPlanStatus);
      lastExecution = execution;
      lastSummary = summary;
    }

    if (waves.ok && waves.payload) {
      lastWaves = asArray(asRecord(waves.payload).data).map((item) => asRecord(item));
    }

    if (events.ok && events.payload) {
      lastEvents = asArray(asRecord(events.payload).data).map((item) => asRecord(item));
    }

    if (
      ['completed', 'failed', 'rolled_back', 'canceled'].includes(lastPlanStatus) ||
      ['completed', 'failed', 'rolled_back', 'canceled'].includes(String(lastExecution.status || ''))
    ) {
      break;
    }

    await sleep(1_000);
  }

  return {
    planStatus: lastPlanStatus,
    execution: lastExecution,
    summary: lastSummary,
    waves: lastWaves,
    events: lastEvents,
  };
}

async function run(): Promise<void> {
  const deviceCount = toPositiveInt(getArg('device-count'), 900);
  const minConnected = toPositiveInt(getArg('min-connected'), Math.floor(deviceCount * 0.95));
  const pollTimeoutMs = toPositiveInt(getArg('poll-timeout-ms'), 180_000);
  const healthTimeoutMs = toPositiveInt(getArg('health-timeout-ms'), 90_000);
  const connectTimeoutMs = toPositiveInt(getArg('connect-timeout-ms'), 120_000);
  const waveIntervalMs = toPositiveInt(getArg('wave-interval-ms'), 1_000);
  const registerMetadata = process.argv.includes('--register-metadata');
  const site = registerMetadata ? getArg('site') || `s9-site-${Date.now()}` : '';
  const zone = getArg('zone') || 'rollout';

  const canarySize = Math.max(1, Math.floor(deviceCount * 0.1));
  const waveSize = Math.max(1, Math.floor((deviceCount - canarySize) / 3));

  const healthBefore = await waitForHealth(healthTimeoutMs);
  if (!healthBefore) {
    throw new Error('health_check_timeout');
  }

  if (registerMetadata) {
    await registerDevices(deviceCount, site, zone);
  }
  const healthAfterRegisterResult = await request<Record<string, unknown>>('/health');
  const connectedCheckpoint = await waitForConnected(minConnected, connectTimeoutMs);

  const cohort = await createCohort(site);
  const rollout = await createRolloutPlan({
    cohortId: cohort.cohortId,
    deviceCount,
    canarySize,
    waveSize,
    waveIntervalMs,
  });
  await startRollout(rollout.planId);

  const finalRollout = await pollRolloutUntilDone(rollout.planId, pollTimeoutMs);
  const eventTypes = [...new Set(finalRollout.events.map((event) => String(event.type || 'unknown')))];
  const autoStopDetected = eventTypes.includes('auto_stopped');
  const rollbackCompletedDetected = eventTypes.includes('rollback_completed');
  const completedWaveCount = finalRollout.waves.filter((wave) => String(wave.status) === 'completed').length;
  const rollbackWaveCount = finalRollout.waves.filter((wave) => String(wave.status) === 'rolled_back').length;

  const checks: RolloutDrillReport['qualityGate']['checks'] = [
    {
      name: 'connected_devices_gate',
      pass: Number(connectedCheckpoint?.connectedDevices || 0) >= minConnected,
      detail: `connected=${Number(connectedCheckpoint?.connectedDevices || 0)} min=${minConnected}`,
    },
    {
      name: 'rollout_target_900',
      pass: rollout.targetCount >= deviceCount,
      detail: `targetCount=${rollout.targetCount}`,
    },
    {
      name: 'auto_stop_triggered',
      pass: autoStopDetected,
      detail: `eventTypes=${eventTypes.join(',')}`,
    },
    {
      name: 'rollback_completed',
      pass: rollbackCompletedDetected,
      detail: `eventTypes=${eventTypes.join(',')}`,
    },
    {
      name: 'has_3_completed_waves_before_stop',
      pass: completedWaveCount >= 3,
      detail: `completedWaveCount=${completedWaveCount}`,
    },
    {
      name: 'final_status_rolled_back',
      pass:
        finalRollout.planStatus === 'rolled_back' ||
        String(finalRollout.execution.status || '') === 'rolled_back',
      detail: `plan=${finalRollout.planStatus}, execution=${String(finalRollout.execution.status || '')}`,
    },
  ];

  const report: RolloutDrillReport = {
    generatedAt: new Date().toISOString(),
    config: {
      baseUrl: BASE_URL,
      deviceCount,
      minConnected,
      registerMetadata,
      canarySize,
      waveSize,
      waveIntervalMs,
      pollTimeoutMs,
    },
    checkpoints: {
      healthBefore,
      healthAfterRegister: healthAfterRegisterResult.payload || null,
      connectedCheckpoint,
    },
    rollout: {
      cohortId: cohort.cohortId,
      planId: rollout.planId,
      targetCount: rollout.targetCount,
      finalStatus: finalRollout.planStatus,
      executionStatus: String(finalRollout.execution.status || ''),
      sentCount: Number(finalRollout.execution.sentCount || 0),
      ackedCount: Number(finalRollout.execution.ackedCount || 0),
      timeoutCount: Number(finalRollout.execution.timeoutCount || 0),
      failedCount: Number(finalRollout.execution.failedCount || 0),
      medianWaveDurationMs: Number(finalRollout.summary.medianWaveDurationMs || 0),
      successRatio: Number(finalRollout.summary.successRatio || 0),
      timeoutRatio: Number(finalRollout.summary.timeoutRatio || 0),
      failureRatio: Number(finalRollout.summary.failureRatio || 0),
      completedWaveCount,
      rollbackWaveCount,
      eventTypes,
      autoStopDetected,
      rollbackCompletedDetected,
    },
    qualityGate: {
      pass: checks.every((check) => check.pass),
      checks,
    },
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void run();
