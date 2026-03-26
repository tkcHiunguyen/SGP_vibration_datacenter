type ApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  payload: T | null;
};

type MixedScenarioReport = {
  generatedAt: string;
  config: {
    baseUrl: string;
    minConnected: number;
    pollTimeoutMs: number;
    waveSize: number;
    canarySize: number;
  };
  checkpoints: {
    healthBefore: Record<string, unknown> | null;
    connectedCheckpoint: Record<string, unknown> | null;
    healthEnd: Record<string, unknown> | null;
  };
  governance: {
    batchApprovalId?: string;
    rolloutApprovalId?: string;
  };
  batch: {
    cohortId: string;
    dryRunTotal: number;
    applyAccepted: number;
    applyFailed: number;
    applyStatus: string;
  };
  rollout: {
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
    eventTypes: string[];
    autoStopDetected: boolean;
    rollbackDetected: boolean;
  };
  ops: {
    rolloutWaveCompletedTotal: number;
    rolloutAutoStopTotal: number;
    rolloutRollbackTotal: number;
    commandSendTotal: number;
    commandSendFailedTotal: number;
    alertsSummary: Record<string, unknown> | null;
    incidentsSummary: Record<string, unknown> | null;
  };
  qualityGate: {
    pass: boolean;
    checks: Array<{ name: string; pass: boolean; detail?: string }>;
  };
};

const BASE_URL = process.env.S10_BASE_URL || 'http://127.0.0.1:8080';
const ADMIN_TOKEN = process.env.S10_ADMIN_TOKEN || 'admin-local-key';
const OPERATOR_TOKEN = process.env.S10_OPERATOR_TOKEN || 'operator-local-key';
const RELEASE_MANAGER_TOKEN = process.env.S10_RELEASE_MANAGER_TOKEN || 'release-manager-local-key';
const APPROVER_TOKEN = process.env.S10_APPROVER_TOKEN || 'approver-local-key';

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

function parseMetricValue(metricsPayload: unknown, metricName: string): number {
  const data = asRecord(asRecord(metricsPayload).data);
  const counters = asArray(data.counters).map((item) => asRecord(item));
  const gauges = asArray(data.gauges).map((item) => asRecord(item));

  const counter = counters.find((item) => String(item.name || '') === metricName);
  if (counter) {
    return Number(counter.value || 0);
  }

  const gauge = gauges.find((item) => String(item.name || '') === metricName);
  if (gauge) {
    return Number(gauge.value || 0);
  }

  return 0;
}

async function waitForHealth(timeoutMs: number): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await request<Record<string, unknown>>('/health');
    if (health.ok && health.payload) {
      return health.payload;
    }
    await sleep(1000);
  }
  return null;
}

async function waitForConnected(minConnected: number, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();
  let last: Record<string, unknown> | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const health = await request<Record<string, unknown>>('/health');
    if (health.ok && health.payload) {
      last = health.payload;
      const connected = Number(health.payload.connectedDevices || 0);
      if (connected >= minConnected) {
        return health.payload;
      }
    }
    await sleep(1000);
  }
  return last;
}

async function createCohort(): Promise<string> {
  const result = await request('/api/fleet/cohorts', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      name: `s10-phase-exit-${Date.now()}`,
      filters: {
        status: 'online',
        search: 'esp-',
      },
      notes: 'phase-4-exit mixed scenario',
    },
  });

  if (!result.ok || !result.payload) {
    throw new Error(`create_cohort_failed_http_${result.status}`);
  }

  const data = asRecord(asRecord(result.payload).data);
  const cohortId = String(data.cohortId || '');
  if (!cohortId) {
    throw new Error('create_cohort_missing_id');
  }
  return cohortId;
}

async function requestApproval(input: {
  actionType: 'fleet_batch_apply' | 'rollout_start';
  targetCount: number;
  cohortId: string;
  resourceId?: string;
  strategy?: string;
  requestNote: string;
  rationale: string;
}): Promise<string> {
  const createResult = await request('/api/governance/approvals', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      actionType: input.actionType,
      riskLevel: 'high',
      requestNote: input.requestNote,
      rationale: input.rationale,
      expiresInMinutes: 120,
      target: {
        resourceType: input.actionType === 'rollout_start' ? 'rollout_plan' : 'fleet_batch',
        resourceId: input.resourceId,
        cohortRef: input.cohortId,
        targetCount: input.targetCount,
        strategy: input.strategy,
      },
    },
  });

  if (!createResult.ok || !createResult.payload) {
    throw new Error(`request_approval_failed_http_${createResult.status}`);
  }

  const approvalId = String(asRecord(asRecord(createResult.payload).data).approvalId || '');
  if (!approvalId) {
    throw new Error('request_approval_missing_id');
  }

  const approveResult = await request(`/api/governance/approvals/${encodeURIComponent(approvalId)}/approve`, {
    method: 'POST',
    token: APPROVER_TOKEN,
    body: {
      note: `approved ${input.actionType}`,
    },
  });

  if (!approveResult.ok) {
    throw new Error(`approve_approval_failed_http_${approveResult.status}`);
  }

  return approvalId;
}

async function pollRollout(
  planId: string,
  timeoutMs: number,
): Promise<{
  planStatus: string;
  execution: Record<string, unknown>;
  summary: Record<string, unknown>;
  events: Record<string, unknown>[];
}> {
  const startedAt = Date.now();
  let lastPlanStatus = 'unknown';
  let lastExecution: Record<string, unknown> = {};
  let lastSummary: Record<string, unknown> = {};
  let lastEvents: Record<string, unknown>[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    await request('/api/rollouts/process', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: {},
    });

    const [detail, events] = await Promise.all([
      request(`/api/rollouts/${encodeURIComponent(planId)}`, { token: ADMIN_TOKEN }),
      request(`/api/rollouts/${encodeURIComponent(planId)}/events?limit=200`, { token: ADMIN_TOKEN }),
    ]);

    if (detail.ok && detail.payload) {
      const data = asRecord(asRecord(detail.payload).data);
      const plan = asRecord(data.plan);
      lastExecution = asRecord(data.execution);
      lastSummary = asRecord(data.summary);
      lastPlanStatus = String(plan.status || 'unknown');
    }

    if (events.ok && events.payload) {
      lastEvents = asArray(asRecord(events.payload).data).map((item) => asRecord(item));
    }

    const executionStatus = String(lastExecution.status || '');
    if (
      ['completed', 'failed', 'rolled_back', 'canceled'].includes(lastPlanStatus)
      || ['completed', 'failed', 'rolled_back', 'canceled'].includes(executionStatus)
    ) {
      break;
    }

    await sleep(1000);
  }

  return {
    planStatus: lastPlanStatus,
    execution: lastExecution,
    summary: lastSummary,
    events: lastEvents,
  };
}

async function run(): Promise<void> {
  const minConnected = toPositiveInt(getArg('min-connected'), 1000);
  const healthTimeoutMs = toPositiveInt(getArg('health-timeout-ms'), 120_000);
  const connectTimeoutMs = toPositiveInt(getArg('connect-timeout-ms'), 180_000);
  const pollTimeoutMs = toPositiveInt(getArg('poll-timeout-ms'), 300_000);
  const waveSize = toPositiveInt(getArg('wave-size'), 320);
  const canarySize = toPositiveInt(getArg('canary-size'), 120);
  const waveIntervalMs = toPositiveInt(getArg('wave-interval-ms'), 1000);

  const healthBefore = await waitForHealth(healthTimeoutMs);
  if (!healthBefore) {
    throw new Error('health_timeout');
  }

  const connectedCheckpoint = await waitForConnected(minConnected, connectTimeoutMs);
  if (!connectedCheckpoint) {
    throw new Error('connected_timeout');
  }

  const cohortId = await createCohort();

  const dryRun = await request('/api/fleet/batches/dry-run', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      cohortId,
      payload: {
        sampleRate: 220,
        fftWindow: 1024,
        profile: 'phase4-exit',
      },
      note: 'phase4 mixed dry-run',
    },
  });

  if (!dryRun.ok || !dryRun.payload) {
    throw new Error(`batch_dry_run_failed_http_${dryRun.status}`);
  }

  const dryRunData = asRecord(asRecord(dryRun.payload).data);
  const dryRunTotal = Number(dryRunData.total || 0);
  if (dryRunTotal <= 0) {
    throw new Error('batch_dry_run_no_targets');
  }

  const batchApprovalId = await requestApproval({
    actionType: 'fleet_batch_apply',
    targetCount: dryRunTotal,
    cohortId,
    requestNote: 'phase4 batch apply approval',
    rationale: 'phase4 quality gate requires governed fleet-wide apply',
  });

  const applyBatch = await request('/api/fleet/batches/apply', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      cohortId,
      payload: {
        sampleRate: 220,
        fftWindow: 1024,
        profile: 'phase4-exit',
      },
      note: 'phase4 mixed apply',
      approvalId: batchApprovalId,
    },
  });

  if (!applyBatch.ok || !applyBatch.payload) {
    throw new Error(`batch_apply_failed_http_${applyBatch.status}`);
  }

  const applyData = asRecord(asRecord(applyBatch.payload).data);
  const applyAccepted = Number(applyData.accepted || 0);
  const applyFailed = Number(applyData.failed || 0);
  const applyStatus = String(applyData.status || 'unknown');

  const rolloutCreate = await request('/api/rollouts', {
    method: 'POST',
    token: OPERATOR_TOKEN,
    body: {
      name: `s10-rollout-${Date.now()}`,
      cohortId,
      strategy: 'canary',
      payload: {
        sampleRate: 250,
        fftWindow: 1024,
        profile: 'phase4-rollout',
      },
      rollbackPayload: {
        sampleRate: 220,
        fftWindow: 1024,
        profile: 'phase4-exit',
      },
      waveSize,
      canarySize,
      waveIntervalMs,
      autoRollback: true,
      gate: {
        maxFailureRatio: 0.03,
        maxTimeoutRatio: 0.03,
        minSuccessRatio: 0.93,
      },
      faultInjection: {
        failureRate: 0.01,
        timeoutRate: 0.01,
      },
    },
  });

  if (!rolloutCreate.ok || !rolloutCreate.payload) {
    throw new Error(`rollout_create_failed_http_${rolloutCreate.status}`);
  }

  const rolloutData = asRecord(asRecord(rolloutCreate.payload).data);
  const rolloutPlan = asRecord(rolloutData.plan);
  const planId = String(rolloutPlan.planId || '');
  const targetCount = Number(rolloutPlan.targetCount || 0);
  if (!planId || targetCount <= 0) {
    throw new Error('rollout_create_invalid_plan');
  }

  const rolloutApprovalId = await requestApproval({
    actionType: 'rollout_start',
    targetCount,
    cohortId,
    resourceId: planId,
    strategy: 'canary',
    requestNote: 'phase4 rollout start approval',
    rationale: 'production-scale rollout requires 2-step governance',
  });

  const startRollout = await request(`/api/rollouts/${encodeURIComponent(planId)}/start`, {
    method: 'POST',
    token: RELEASE_MANAGER_TOKEN,
    body: {
      note: 'phase4 exit rollout start',
      approvalId: rolloutApprovalId,
    },
  });

  if (!startRollout.ok) {
    throw new Error(`rollout_start_failed_http_${startRollout.status}`);
  }

  const finalRollout = await pollRollout(planId, pollTimeoutMs);
  const eventTypes = [...new Set(finalRollout.events.map((event) => String(event.type || 'unknown')))].sort();
  const autoStopDetected = eventTypes.includes('auto_stopped');
  const rollbackDetected = eventTypes.includes('rollback_completed');

  const [metricsSnapshot, alertsSummary, incidentsSummary, healthEndResult] = await Promise.all([
    request('/api/ops/metrics', { token: ADMIN_TOKEN }),
    request('/api/alerts/summary', { token: OPERATOR_TOKEN }),
    request('/api/incidents/summary', { token: OPERATOR_TOKEN }),
    request('/health'),
  ]);

  const rolloutWaveCompletedTotal = parseMetricValue(metricsSnapshot.payload, 'rollout_wave_completed_total');
  const rolloutAutoStopTotal = parseMetricValue(metricsSnapshot.payload, 'rollout_auto_stop_total');
  const rolloutRollbackTotal = parseMetricValue(metricsSnapshot.payload, 'rollout_rollback_total');
  const commandSendTotal = parseMetricValue(metricsSnapshot.payload, 'command_send_total');
  const commandSendFailedTotal = parseMetricValue(metricsSnapshot.payload, 'command_send_failed_total');

  const batchTotal = applyAccepted + applyFailed;
  const batchSuccessRatio = batchTotal > 0 ? applyAccepted / batchTotal : 0;

  const checks: MixedScenarioReport['qualityGate']['checks'] = [
    {
      name: 'connected_1000_plus',
      pass: Number(connectedCheckpoint.connectedDevices || 0) >= minConnected,
      detail: `connected=${Number(connectedCheckpoint.connectedDevices || 0)} min=${minConnected}`,
    },
    {
      name: 'batch_apply_success_ratio',
      pass: batchSuccessRatio >= 0.9,
      detail: `successRatio=${batchSuccessRatio.toFixed(4)}`,
    },
    {
      name: 'rollout_terminal_status',
      pass: ['completed', 'rolled_back'].includes(finalRollout.planStatus) || ['completed', 'rolled_back'].includes(String(finalRollout.execution.status || '')),
      detail: `plan=${finalRollout.planStatus},execution=${String(finalRollout.execution.status || '')}`,
    },
    {
      name: 'rollout_metrics_emitted',
      pass: rolloutWaveCompletedTotal > 0,
      detail: `rolloutWaveCompletedTotal=${rolloutWaveCompletedTotal}`,
    },
    {
      name: 'command_pipeline_active',
      pass: commandSendTotal > 0,
      detail: `commandSendTotal=${commandSendTotal},commandSendFailedTotal=${commandSendFailedTotal}`,
    },
    {
      name: 'rollback_safety_observable',
      pass: finalRollout.planStatus !== 'rolled_back' || rollbackDetected || rolloutRollbackTotal > 0,
      detail: `planStatus=${finalRollout.planStatus},rollbackDetected=${rollbackDetected},rolloutRollbackTotal=${rolloutRollbackTotal}`,
    },
  ];

  const report: MixedScenarioReport = {
    generatedAt: new Date().toISOString(),
    config: {
      baseUrl: BASE_URL,
      minConnected,
      pollTimeoutMs,
      waveSize,
      canarySize,
    },
    checkpoints: {
      healthBefore,
      connectedCheckpoint,
      healthEnd: healthEndResult.payload ? asRecord(healthEndResult.payload) : null,
    },
    governance: {
      batchApprovalId,
      rolloutApprovalId,
    },
    batch: {
      cohortId,
      dryRunTotal,
      applyAccepted,
      applyFailed,
      applyStatus,
    },
    rollout: {
      planId,
      targetCount,
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
      eventTypes,
      autoStopDetected,
      rollbackDetected,
    },
    ops: {
      rolloutWaveCompletedTotal,
      rolloutAutoStopTotal,
      rolloutRollbackTotal,
      commandSendTotal,
      commandSendFailedTotal,
      alertsSummary: alertsSummary.payload ? asRecord(asRecord(alertsSummary.payload).data) : null,
      incidentsSummary: incidentsSummary.payload ? asRecord(asRecord(incidentsSummary.payload).data) : null,
    },
    qualityGate: {
      pass: checks.every((item) => item.pass),
      checks,
    },
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void run();
