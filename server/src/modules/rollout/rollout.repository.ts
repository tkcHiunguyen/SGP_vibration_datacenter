import type {
  RolloutEvent,
  RolloutExecution,
  RolloutPlan,
  RolloutPlanFilters,
  RolloutWave,
} from './rollout.types.js';

export interface RolloutRepository {
  listPlans(filters?: RolloutPlanFilters): RolloutPlan[];
  getPlan(planId: string): RolloutPlan | null;
  savePlan(plan: RolloutPlan): void;

  listExecutions(planId?: string): RolloutExecution[];
  getExecution(executionId: string): RolloutExecution | null;
  getLatestExecutionByPlan(planId: string): RolloutExecution | null;
  saveExecution(execution: RolloutExecution): void;

  listWaves(executionId: string): RolloutWave[];
  getWave(waveId: string): RolloutWave | null;
  saveWave(wave: RolloutWave): void;

  listEvents(planId: string, limit?: number): RolloutEvent[];
  appendEvent(event: RolloutEvent): void;
}
