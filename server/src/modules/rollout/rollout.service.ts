import type { RolloutRepository } from './rollout.repository.js';
import type {
  CreateRolloutPlanInput,
  RolloutDispatchResult,
  RolloutEvent,
  RolloutEventType,
  RolloutExecution,
  RolloutGateConfig,
  RolloutPlan,
  RolloutPlanFilters,
  RolloutProcessSummary,
  RolloutSender,
  RolloutStatus,
  RolloutWave,
} from './rollout.types.js';

const DEFAULT_GATE: RolloutGateConfig = {
  maxFailureRatio: 0.1,
  maxTimeoutRatio: 0.1,
  minSuccessRatio: 0.8,
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function uniqueDeviceIds(deviceIds: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of deviceIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function chunkDeviceIds(deviceIds: string[], size: number): string[][] {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: string[][] = [];
  for (let index = 0; index < deviceIds.length; index += chunkSize) {
    chunks.push(deviceIds.slice(index, index + chunkSize));
  }
  return chunks;
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
  }
  return Number(sorted[middle].toFixed(2));
}

export class RolloutService {
  constructor(private readonly repository: RolloutRepository) {}

  listPlans(filters: RolloutPlanFilters = {}): RolloutPlan[] {
    return this.repository.listPlans(filters);
  }

  getPlan(planId: string): RolloutPlan | null {
    return this.repository.getPlan(planId);
  }

  getLatestExecution(planId: string): RolloutExecution | null {
    return this.repository.getLatestExecutionByPlan(planId);
  }

  listWaves(planId: string): RolloutWave[] {
    const execution = this.repository.getLatestExecutionByPlan(planId);
    if (!execution) {
      return [];
    }
    return this.repository.listWaves(execution.executionId);
  }

  listEvents(planId: string, limit = 200): RolloutEvent[] {
    return this.repository.listEvents(planId, limit);
  }

  createPlan(input: CreateRolloutPlanInput): {
    plan: RolloutPlan;
    execution: RolloutExecution;
    waves: RolloutWave[];
  } {
    const targetDeviceIds = uniqueDeviceIds(input.targetDeviceIds);
    const targetCount = targetDeviceIds.length;
    const now = new Date().toISOString();

    const baseWaveSize = Math.max(1, Math.floor(input.waveSize ?? 100));
    const canarySize = input.strategy === 'canary' ? Math.max(1, Math.floor(input.canarySize ?? 50)) : 0;
    const waveSize = input.strategy === 'all-at-once' ? Math.max(1, targetCount || 1) : baseWaveSize;

    const gate: RolloutGateConfig = {
      maxFailureRatio: clampRatio(input.gate?.maxFailureRatio ?? DEFAULT_GATE.maxFailureRatio, DEFAULT_GATE.maxFailureRatio),
      maxTimeoutRatio: clampRatio(input.gate?.maxTimeoutRatio ?? DEFAULT_GATE.maxTimeoutRatio, DEFAULT_GATE.maxTimeoutRatio),
      minSuccessRatio: clampRatio(input.gate?.minSuccessRatio ?? DEFAULT_GATE.minSuccessRatio, DEFAULT_GATE.minSuccessRatio),
    };

    const plan: RolloutPlan = {
      planId: createId('rollout-plan'),
      name: input.name.trim(),
      cohortRef: input.cohortRef,
      cohortName: normalizeText(input.cohortName),
      site: normalizeText(input.site),
      zone: normalizeText(input.zone),
      strategy: input.strategy,
      payload: { ...input.payload },
      rollbackPayload: input.rollbackPayload ? { ...input.rollbackPayload } : undefined,
      targetDeviceIds,
      targetCount,
      waveSize,
      canarySize: Math.min(canarySize, targetCount || canarySize),
      waveIntervalMs: Math.max(500, Math.floor(input.waveIntervalMs ?? 2_000)),
      autoRollback: input.autoRollback ?? true,
      gate,
      status: 'draft',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      faultInjection: input.faultInjection
        ? {
            failureRate: clampRatio(input.faultInjection.failureRate ?? 0, 0),
            timeoutRate: clampRatio(input.faultInjection.timeoutRate ?? 0, 0),
            failedDeviceIds: uniqueDeviceIds(input.faultInjection.failedDeviceIds ?? []),
            timeoutDeviceIds: uniqueDeviceIds(input.faultInjection.timeoutDeviceIds ?? []),
          }
        : undefined,
    };

    const executionId = createId('rollout-exec');
    const waveDeviceGroups = this.createWaveGroups(plan.strategy, targetDeviceIds, plan.waveSize, plan.canarySize);
    const waves: RolloutWave[] = waveDeviceGroups.map((deviceIds, index) => ({
      waveId: createId(`rollout-wave-${index + 1}`),
      planId: plan.planId,
      executionId,
      index,
      label: index === 0 && plan.strategy === 'canary' ? 'canary' : `wave-${index + 1}`,
      deviceIds,
      targetCount: deviceIds.length,
      sentCount: 0,
      ackedCount: 0,
      timeoutCount: 0,
      failedCount: 0,
      status: 'pending',
    }));

    const execution: RolloutExecution = {
      executionId,
      planId: plan.planId,
      status: 'draft',
      currentWaveIndex: 0,
      totalWaves: waves.length,
      sentCount: 0,
      ackedCount: 0,
      timeoutCount: 0,
      failedCount: 0,
      appliedDeviceIds: [],
    };

    plan.latestExecutionId = execution.executionId;
    this.repository.savePlan(plan);
    this.repository.saveExecution(execution);
    for (const wave of waves) {
      this.repository.saveWave(wave);
    }

    this.appendEvent(plan.planId, execution.executionId, 'plan_created', input.createdBy, `Created rollout plan ${plan.name}`, {
      strategy: plan.strategy,
      targetCount: plan.targetCount,
      totalWaves: waves.length,
    });

    return { plan, execution, waves };
  }

  startPlan(planId: string, actor: string, note?: string): RolloutExecution | null {
    const plan = this.repository.getPlan(planId);
    if (!plan) {
      return null;
    }
    const execution = this.repository.getLatestExecutionByPlan(planId);
    if (!execution) {
      return null;
    }
    if (!['draft', 'scheduled', 'paused'].includes(execution.status)) {
      return execution;
    }

    const now = new Date().toISOString();
    const nextStatus: RolloutStatus = 'running';
    plan.status = nextStatus;
    plan.updatedAt = now;

    execution.status = nextStatus;
    execution.startedAt = execution.startedAt ?? now;
    execution.pausedAt = undefined;
    execution.nextWaveAt = now;

    this.repository.savePlan(plan);
    this.repository.saveExecution(execution);
    this.appendEvent(
      planId,
      execution.executionId,
      execution.startedAt === now ? 'started' : 'resumed',
      actor,
      note?.trim() || (execution.startedAt === now ? 'Started rollout execution' : 'Resumed rollout execution'),
    );

    return execution;
  }

  pausePlan(planId: string, actor: string, note?: string): RolloutExecution | null {
    const plan = this.repository.getPlan(planId);
    const execution = this.repository.getLatestExecutionByPlan(planId);
    if (!plan || !execution || execution.status !== 'running') {
      return null;
    }

    const now = new Date().toISOString();
    plan.status = 'paused';
    plan.updatedAt = now;
    execution.status = 'paused';
    execution.pausedAt = now;
    execution.nextWaveAt = undefined;

    this.repository.savePlan(plan);
    this.repository.saveExecution(execution);
    this.appendEvent(planId, execution.executionId, 'paused', actor, note?.trim() || 'Paused rollout execution');
    return execution;
  }

  cancelPlan(planId: string, actor: string, note?: string): RolloutExecution | null {
    const plan = this.repository.getPlan(planId);
    const execution = this.repository.getLatestExecutionByPlan(planId);
    if (!plan || !execution) {
      return null;
    }
    if (['completed', 'rolled_back', 'canceled'].includes(execution.status)) {
      return execution;
    }

    const now = new Date().toISOString();
    plan.status = 'canceled';
    plan.updatedAt = now;
    execution.status = 'canceled';
    execution.completedAt = now;
    execution.nextWaveAt = undefined;

    for (const wave of this.repository.listWaves(execution.executionId)) {
      if (wave.status === 'pending') {
        wave.status = 'skipped';
        wave.gateDecision = 'canceled';
        this.repository.saveWave(wave);
      }
    }

    this.repository.savePlan(plan);
    this.repository.saveExecution(execution);
    this.appendEvent(planId, execution.executionId, 'canceled', actor, note?.trim() || 'Canceled rollout execution');
    return execution;
  }

  async rollbackPlan(planId: string, actor: string, reason: string, sender: RolloutSender): Promise<RolloutExecution | null> {
    const plan = this.repository.getPlan(planId);
    const execution = this.repository.getLatestExecutionByPlan(planId);
    if (!plan || !execution) {
      return null;
    }
    if (execution.status === 'rolled_back') {
      return execution;
    }

    this.appendEvent(planId, execution.executionId, 'manual_override', actor, reason, {
      action: 'rollback',
    });
    await this.performRollback(plan, execution, reason, actor, sender);
    return this.repository.getLatestExecutionByPlan(planId);
  }

  async processRunningPlans(sender: RolloutSender): Promise<RolloutProcessSummary> {
    const summary: RolloutProcessSummary = {
      processedPlans: 0,
      dispatched: 0,
      acked: 0,
      failed: 0,
      timeout: 0,
      waveCompleted: 0,
      autoStopped: 0,
      rollbacks: 0,
    };

    for (const plan of this.repository.listPlans({ status: 'running' })) {
      const execution = this.repository.getLatestExecutionByPlan(plan.planId);
      if (!execution || execution.status !== 'running') {
        continue;
      }
      const now = Date.now();
      const nextWaveAt = execution.nextWaveAt ? Date.parse(execution.nextWaveAt) : now;
      if (Number.isFinite(nextWaveAt) && nextWaveAt > now) {
        continue;
      }

      const waveResult = await this.processOneWave(plan, execution, sender);
      summary.processedPlans += 1;
      summary.dispatched += waveResult.dispatched;
      summary.acked += waveResult.acked;
      summary.failed += waveResult.failed;
      summary.timeout += waveResult.timeout;
      summary.waveCompleted += waveResult.waveCompleted;
      summary.autoStopped += waveResult.autoStopped;
      summary.rollbacks += waveResult.rollbacks;
    }

    return summary;
  }

  summarizeExecution(planId: string): {
    medianWaveDurationMs: number;
    successRatio: number;
    timeoutRatio: number;
    failureRatio: number;
  } | null {
    const execution = this.repository.getLatestExecutionByPlan(planId);
    if (!execution) {
      return null;
    }
    const waves = this.repository.listWaves(execution.executionId).filter((wave) => wave.status === 'completed');
    const durations = waves
      .map((wave) => {
        if (!wave.startedAt || !wave.completedAt) {
          return 0;
        }
        return Math.max(0, Date.parse(wave.completedAt) - Date.parse(wave.startedAt));
      })
      .filter((value) => value > 0);
    const targetCount = Math.max(1, execution.sentCount);
    return {
      medianWaveDurationMs: median(durations),
      successRatio: Number((execution.ackedCount / targetCount).toFixed(4)),
      timeoutRatio: Number((execution.timeoutCount / targetCount).toFixed(4)),
      failureRatio: Number((execution.failedCount / targetCount).toFixed(4)),
    };
  }

  private createWaveGroups(
    strategy: RolloutPlan['strategy'],
    targetDeviceIds: string[],
    waveSize: number,
    canarySize: number,
  ): string[][] {
    if (!targetDeviceIds.length) {
      return [[]];
    }

    if (strategy === 'all-at-once') {
      return [targetDeviceIds];
    }

    if (strategy === 'wave') {
      return chunkDeviceIds(targetDeviceIds, waveSize);
    }

    const headSize = Math.min(targetDeviceIds.length, Math.max(1, canarySize));
    const canaryDevices = targetDeviceIds.slice(0, headSize);
    const rest = targetDeviceIds.slice(headSize);
    return [canaryDevices, ...chunkDeviceIds(rest, waveSize)];
  }

  private appendEvent(
    planId: string,
    executionId: string | undefined,
    type: RolloutEventType,
    actor: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.repository.appendEvent({
      eventId: createId('rollout-event'),
      planId,
      executionId,
      type,
      actor,
      message,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }

  private async processOneWave(
    plan: RolloutPlan,
    execution: RolloutExecution,
    sender: RolloutSender,
  ): Promise<{
    dispatched: number;
    acked: number;
    failed: number;
    timeout: number;
    waveCompleted: number;
    autoStopped: number;
    rollbacks: number;
  }> {
    const waves = this.repository.listWaves(execution.executionId);
    const activeWave = waves.find((wave) => wave.index === execution.currentWaveIndex);
    if (!activeWave) {
      const completedAt = new Date().toISOString();
      plan.status = 'completed';
      plan.updatedAt = completedAt;
      execution.status = 'completed';
      execution.completedAt = completedAt;
      execution.nextWaveAt = undefined;
      this.repository.savePlan(plan);
      this.repository.saveExecution(execution);
      this.appendEvent(plan.planId, execution.executionId, 'completed', 'system:rollout', 'Rollout completed');
      return { dispatched: 0, acked: 0, failed: 0, timeout: 0, waveCompleted: 0, autoStopped: 0, rollbacks: 0 };
    }

    const startedAt = new Date().toISOString();
    activeWave.status = 'running';
    activeWave.startedAt = startedAt;
    this.repository.saveWave(activeWave);
    this.appendEvent(plan.planId, execution.executionId, 'wave_started', 'system:rollout', `Started ${activeWave.label}`, {
      waveIndex: activeWave.index,
      targetCount: activeWave.targetCount,
    });

    let acked = 0;
    let failed = 0;
    let timeout = 0;

    for (const deviceId of activeWave.deviceIds) {
      const dispatch = await this.dispatchWithFaultInjection(plan, deviceId, sender);
      if (dispatch.status === 'acked') {
        acked += 1;
        execution.appliedDeviceIds.push(deviceId);
      } else if (dispatch.status === 'timeout') {
        timeout += 1;
      } else {
        failed += 1;
      }
    }
    execution.appliedDeviceIds = uniqueDeviceIds(execution.appliedDeviceIds);

    const dispatched = activeWave.deviceIds.length;
    activeWave.sentCount = dispatched;
    activeWave.ackedCount = acked;
    activeWave.timeoutCount = timeout;
    activeWave.failedCount = failed;
    activeWave.completedAt = new Date().toISOString();
    activeWave.status = 'completed';

    execution.sentCount += dispatched;
    execution.ackedCount += acked;
    execution.timeoutCount += timeout;
    execution.failedCount += failed;

    const total = Math.max(1, activeWave.targetCount);
    const failureRatio = failed / total;
    const timeoutRatio = timeout / total;
    const successRatio = acked / total;
    const gateViolation: string[] = [];
    if (failureRatio > plan.gate.maxFailureRatio) {
      gateViolation.push(`failure_ratio>${plan.gate.maxFailureRatio}`);
    }
    if (timeoutRatio > plan.gate.maxTimeoutRatio) {
      gateViolation.push(`timeout_ratio>${plan.gate.maxTimeoutRatio}`);
    }
    if (successRatio < plan.gate.minSuccessRatio) {
      gateViolation.push(`success_ratio<${plan.gate.minSuccessRatio}`);
    }

    activeWave.gateDecision = gateViolation.length ? `blocked:${gateViolation.join(',')}` : 'pass';
    this.repository.saveWave(activeWave);
    this.appendEvent(plan.planId, execution.executionId, 'wave_completed', 'system:rollout', `Completed ${activeWave.label}`, {
      waveIndex: activeWave.index,
      dispatched,
      acked,
      failed,
      timeout,
      failureRatio: Number(failureRatio.toFixed(4)),
      timeoutRatio: Number(timeoutRatio.toFixed(4)),
      successRatio: Number(successRatio.toFixed(4)),
      gateDecision: activeWave.gateDecision,
    });

    if (gateViolation.length) {
      const now = new Date().toISOString();
      execution.status = 'failed';
      execution.completedAt = now;
      execution.failureReason = `auto_stop:${gateViolation.join(',')}`;
      execution.nextWaveAt = undefined;
      plan.status = 'failed';
      plan.updatedAt = now;
      this.repository.saveExecution(execution);
      this.repository.savePlan(plan);
      this.appendEvent(
        plan.planId,
        execution.executionId,
        'auto_stopped',
        'system:rollout',
        'Rollout auto-stopped due to gate violation',
        { gateViolation },
      );
      this.appendEvent(
        plan.planId,
        execution.executionId,
        'failed',
        'system:rollout',
        `Rollout failed: ${execution.failureReason}`,
      );

      if (plan.autoRollback && execution.appliedDeviceIds.length > 0) {
        const rollbackExecuted = await this.performRollback(plan, execution, execution.failureReason, 'system:rollout', sender);
        return { dispatched, acked, failed, timeout, waveCompleted: 1, autoStopped: 1, rollbacks: rollbackExecuted ? 1 : 0 };
      }

      return { dispatched, acked, failed, timeout, waveCompleted: 1, autoStopped: 1, rollbacks: 0 };
    }

    execution.currentWaveIndex += 1;
    if (execution.currentWaveIndex >= execution.totalWaves) {
      const completedAt = new Date().toISOString();
      execution.status = 'completed';
      execution.completedAt = completedAt;
      execution.nextWaveAt = undefined;
      plan.status = 'completed';
      plan.updatedAt = completedAt;
      this.repository.saveExecution(execution);
      this.repository.savePlan(plan);
      this.appendEvent(plan.planId, execution.executionId, 'completed', 'system:rollout', 'Rollout completed');
      return { dispatched, acked, failed, timeout, waveCompleted: 1, autoStopped: 0, rollbacks: 0 };
    }

    execution.nextWaveAt = new Date(Date.now() + plan.waveIntervalMs).toISOString();
    this.repository.saveExecution(execution);
    return { dispatched, acked, failed, timeout, waveCompleted: 1, autoStopped: 0, rollbacks: 0 };
  }

  private async performRollback(
    plan: RolloutPlan,
    execution: RolloutExecution,
    reason: string,
    actor: string,
    sender: RolloutSender,
  ): Promise<boolean> {
    if (execution.status === 'rolled_back') {
      return false;
    }

    const existingRollback = this.repository
      .listWaves(execution.executionId)
      .find((wave) => wave.label === 'rollback' || wave.status === 'rolled_back');
    if (existingRollback) {
      return false;
    }

    const targetIds = uniqueDeviceIds(execution.appliedDeviceIds);
    if (!targetIds.length) {
      return false;
    }

    const payload = plan.rollbackPayload ? { ...plan.rollbackPayload } : { rollback: true, previous: plan.payload };
    this.appendEvent(plan.planId, execution.executionId, 'rollback_started', actor, 'Rollback started', {
      reason,
      targetCount: targetIds.length,
    });

    let acked = 0;
    let failed = 0;
    let timeout = 0;
    for (const deviceId of targetIds) {
      const result = await sender(deviceId, payload);
      if (result.status === 'acked') {
        acked += 1;
      } else if (result.status === 'timeout') {
        timeout += 1;
      } else {
        failed += 1;
      }
    }

    const rollbackWave: RolloutWave = {
      waveId: createId('rollout-wave-rollback'),
      planId: plan.planId,
      executionId: execution.executionId,
      index: execution.totalWaves,
      label: 'rollback',
      deviceIds: targetIds,
      targetCount: targetIds.length,
      sentCount: targetIds.length,
      ackedCount: acked,
      timeoutCount: timeout,
      failedCount: failed,
      status: 'rolled_back',
      gateDecision: 'rollback',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    this.repository.saveWave(rollbackWave);

    const now = new Date().toISOString();
    execution.status = 'rolled_back';
    execution.rollbackReason = reason;
    execution.completedAt = now;
    execution.nextWaveAt = undefined;
    plan.status = 'rolled_back';
    plan.updatedAt = now;
    this.repository.saveExecution(execution);
    this.repository.savePlan(plan);

    this.appendEvent(plan.planId, execution.executionId, 'rollback_completed', actor, 'Rollback completed', {
      reason,
      targetCount: targetIds.length,
      acked,
      failed,
      timeout,
    });
    return true;
  }

  private async dispatchWithFaultInjection(
    plan: RolloutPlan,
    deviceId: string,
    sender: RolloutSender,
  ): Promise<RolloutDispatchResult> {
    const fault = plan.faultInjection;
    if (fault) {
      const failedSet = new Set(fault.failedDeviceIds ?? []);
      const timeoutSet = new Set(fault.timeoutDeviceIds ?? []);
      if (failedSet.has(deviceId)) {
        return { status: 'failed', reason: 'fault_injection_failed_device' };
      }
      if (timeoutSet.has(deviceId)) {
        return { status: 'timeout', reason: 'fault_injection_timeout_device' };
      }
      if ((fault.timeoutRate ?? 0) > 0 && Math.random() < (fault.timeoutRate ?? 0)) {
        return { status: 'timeout', reason: 'fault_injection_timeout_rate' };
      }
      if ((fault.failureRate ?? 0) > 0 && Math.random() < (fault.failureRate ?? 0)) {
        return { status: 'failed', reason: 'fault_injection_failure_rate' };
      }
    }

    return sender(deviceId, plan.payload);
  }
}
