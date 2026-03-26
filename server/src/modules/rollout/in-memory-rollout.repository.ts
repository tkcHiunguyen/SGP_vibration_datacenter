import type { RolloutRepository } from './rollout.repository.js';
import type {
  RolloutEvent,
  RolloutExecution,
  RolloutPlan,
  RolloutPlanFilters,
  RolloutWave,
} from './rollout.types.js';

function clonePlan(plan: RolloutPlan): RolloutPlan {
  return {
    ...plan,
    payload: { ...plan.payload },
    rollbackPayload: plan.rollbackPayload ? { ...plan.rollbackPayload } : undefined,
    targetDeviceIds: [...plan.targetDeviceIds],
    gate: { ...plan.gate },
    faultInjection: plan.faultInjection
      ? {
          ...plan.faultInjection,
          failedDeviceIds: [...(plan.faultInjection.failedDeviceIds ?? [])],
          timeoutDeviceIds: [...(plan.faultInjection.timeoutDeviceIds ?? [])],
        }
      : undefined,
  };
}

function cloneExecution(execution: RolloutExecution): RolloutExecution {
  return {
    ...execution,
    appliedDeviceIds: [...execution.appliedDeviceIds],
  };
}

function cloneWave(wave: RolloutWave): RolloutWave {
  return {
    ...wave,
    deviceIds: [...wave.deviceIds],
  };
}

function cloneEvent(event: RolloutEvent): RolloutEvent {
  return {
    ...event,
    metadata: event.metadata ? { ...event.metadata } : undefined,
  };
}

function matchesPlanFilters(plan: RolloutPlan, filters: RolloutPlanFilters): boolean {
  if (filters.status && plan.status !== filters.status) {
    return false;
  }
  if (filters.site && plan.site?.trim().toLowerCase() !== filters.site.trim().toLowerCase()) {
    return false;
  }
  if (filters.cohortRef && plan.cohortRef !== filters.cohortRef) {
    return false;
  }
  if (filters.strategy && plan.strategy !== filters.strategy) {
    return false;
  }
  if (filters.from && plan.createdAt < filters.from) {
    return false;
  }
  if (filters.to && plan.createdAt > filters.to) {
    return false;
  }
  return true;
}

export class InMemoryRolloutRepository implements RolloutRepository {
  private readonly plans = new Map<string, RolloutPlan>();
  private readonly executions = new Map<string, RolloutExecution>();
  private readonly waves = new Map<string, RolloutWave>();
  private readonly events: RolloutEvent[] = [];

  listPlans(filters: RolloutPlanFilters = {}): RolloutPlan[] {
    const all = [...this.plans.values()]
      .filter((plan) => matchesPlanFilters(plan, filters))
      .map(clonePlan)
      .reverse();
    const limit = filters.limit ?? all.length;
    return all.slice(0, limit);
  }

  getPlan(planId: string): RolloutPlan | null {
    const found = this.plans.get(planId);
    return found ? clonePlan(found) : null;
  }

  savePlan(plan: RolloutPlan): void {
    this.plans.set(plan.planId, clonePlan(plan));
  }

  listExecutions(planId?: string): RolloutExecution[] {
    const all = [...this.executions.values()]
      .filter((execution) => !planId || execution.planId === planId)
      .map(cloneExecution)
      .reverse();
    return all;
  }

  getExecution(executionId: string): RolloutExecution | null {
    const found = this.executions.get(executionId);
    return found ? cloneExecution(found) : null;
  }

  getLatestExecutionByPlan(planId: string): RolloutExecution | null {
    const found = this.listExecutions(planId)[0];
    return found ? cloneExecution(found) : null;
  }

  saveExecution(execution: RolloutExecution): void {
    this.executions.set(execution.executionId, cloneExecution(execution));
  }

  listWaves(executionId: string): RolloutWave[] {
    return [...this.waves.values()]
      .filter((wave) => wave.executionId === executionId)
      .sort((left, right) => left.index - right.index)
      .map(cloneWave);
  }

  getWave(waveId: string): RolloutWave | null {
    const found = this.waves.get(waveId);
    return found ? cloneWave(found) : null;
  }

  saveWave(wave: RolloutWave): void {
    this.waves.set(wave.waveId, cloneWave(wave));
  }

  listEvents(planId: string, limit = 200): RolloutEvent[] {
    return this.events
      .filter((event) => event.planId === planId)
      .slice(-limit)
      .map(cloneEvent)
      .reverse();
  }

  appendEvent(event: RolloutEvent): void {
    this.events.push(cloneEvent(event));
  }
}
