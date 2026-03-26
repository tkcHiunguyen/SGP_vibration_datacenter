import type {
  HealthCheckResult,
  HealthProbeKind,
  HealthSnapshot,
  HealthStatus,
} from './observability.types.js';

export type HealthCheckInput = Omit<HealthCheckResult, 'checkedAt'> & {
  checkedAt?: string;
};

export type HealthSnapshotInput = {
  service: string;
  kind?: HealthProbeKind;
  checks?: HealthCheckInput[];
  checkedAt?: string;
};

export function createHealthCheckResult(input: HealthCheckInput): HealthCheckResult {
  return {
    name: input.name,
    status: input.status,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    message: input.message,
    details: input.details,
  };
}

export function combineHealthStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.status === 'unhealthy')) {
    return 'unhealthy';
  }

  if (checks.some((check) => check.status === 'degraded')) {
    return 'degraded';
  }

  return 'healthy';
}

export function createHealthSnapshot(input: HealthSnapshotInput): HealthSnapshot {
  const checks = (input.checks ?? []).map((check) => createHealthCheckResult(check));
  const checkedAt = input.checkedAt ?? new Date().toISOString();

  return {
    service: input.service,
    kind: input.kind ?? 'readiness',
    status: combineHealthStatus(checks),
    checkedAt,
    checks,
  };
}

export function isReady(snapshot: HealthSnapshot): boolean {
  return snapshot.status !== 'unhealthy';
}

export function isAlive(snapshot: HealthSnapshot): boolean {
  return snapshot.status !== 'unhealthy';
}

export function createHealthySnapshot(service: string, kind: HealthProbeKind = 'readiness'): HealthSnapshot {
  return createHealthSnapshot({
    service,
    kind,
    checks: [
      {
        name: `${kind}:self`,
        status: 'healthy',
        message: `${service} is ${kind}`,
      },
    ],
  });
}

