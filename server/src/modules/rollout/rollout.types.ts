export type RolloutStrategy = 'all-at-once' | 'wave' | 'canary';

export type RolloutStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'canceled';

export type RolloutWaveStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'skipped';

export type RolloutEventType =
  | 'plan_created'
  | 'scheduled'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'canceled'
  | 'wave_started'
  | 'wave_completed'
  | 'auto_stopped'
  | 'rollback_started'
  | 'rollback_completed'
  | 'completed'
  | 'failed'
  | 'manual_override';

export type RolloutGateConfig = {
  maxFailureRatio: number;
  maxTimeoutRatio: number;
  minSuccessRatio: number;
};

export type RolloutFaultInjection = {
  failureRate?: number;
  timeoutRate?: number;
  failedDeviceIds?: string[];
  timeoutDeviceIds?: string[];
};

export type RolloutPlan = {
  planId: string;
  name: string;
  cohortRef: string;
  cohortName?: string;
  site?: string;
  zone?: string;
  strategy: RolloutStrategy;
  payload: Record<string, unknown>;
  rollbackPayload?: Record<string, unknown>;
  targetDeviceIds: string[];
  targetCount: number;
  waveSize: number;
  canarySize: number;
  waveIntervalMs: number;
  autoRollback: boolean;
  gate: RolloutGateConfig;
  status: RolloutStatus;
  latestExecutionId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  faultInjection?: RolloutFaultInjection;
};

export type RolloutExecution = {
  executionId: string;
  planId: string;
  status: RolloutStatus;
  currentWaveIndex: number;
  totalWaves: number;
  sentCount: number;
  ackedCount: number;
  timeoutCount: number;
  failedCount: number;
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  nextWaveAt?: string;
  failureReason?: string;
  rollbackReason?: string;
  appliedDeviceIds: string[];
};

export type RolloutWave = {
  waveId: string;
  planId: string;
  executionId: string;
  index: number;
  label: string;
  deviceIds: string[];
  targetCount: number;
  sentCount: number;
  ackedCount: number;
  timeoutCount: number;
  failedCount: number;
  status: RolloutWaveStatus;
  gateDecision?: string;
  startedAt?: string;
  completedAt?: string;
};

export type RolloutEvent = {
  eventId: string;
  planId: string;
  executionId?: string;
  type: RolloutEventType;
  actor: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type CreateRolloutPlanInput = {
  name: string;
  cohortRef: string;
  cohortName?: string;
  site?: string;
  zone?: string;
  strategy: RolloutStrategy;
  payload: Record<string, unknown>;
  rollbackPayload?: Record<string, unknown>;
  targetDeviceIds: string[];
  waveSize?: number;
  canarySize?: number;
  waveIntervalMs?: number;
  autoRollback?: boolean;
  gate?: Partial<RolloutGateConfig>;
  createdBy: string;
  faultInjection?: RolloutFaultInjection;
};

export type RolloutPlanFilters = {
  status?: RolloutStatus;
  site?: string;
  cohortRef?: string;
  strategy?: RolloutStrategy;
  from?: string;
  to?: string;
  limit?: number;
};

export type RolloutDispatchResult = {
  status: 'acked' | 'failed' | 'timeout';
  reason?: string;
};

export type RolloutSender = (
  deviceId: string,
  payload: Record<string, unknown>,
) => Promise<RolloutDispatchResult> | RolloutDispatchResult;

export type RolloutProcessSummary = {
  processedPlans: number;
  dispatched: number;
  acked: number;
  failed: number;
  timeout: number;
  waveCompleted: number;
  autoStopped: number;
  rollbacks: number;
};
