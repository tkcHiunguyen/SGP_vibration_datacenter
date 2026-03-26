import type { FleetRepository } from './fleet.repository.js';
import type { FleetBatchRun, FleetCohort, FleetPolicy } from './fleet.types.js';

function cloneCohort(cohort: FleetCohort): FleetCohort {
  return {
    ...cohort,
    filters: { ...cohort.filters },
  };
}

function cloneRun(run: FleetBatchRun): FleetBatchRun {
  return {
    ...run,
    payload: { ...run.payload },
  };
}

function clonePolicy(policy: FleetPolicy): FleetPolicy {
  return {
    ...policy,
    scope: { ...policy.scope },
    baselineConfig: { ...policy.baselineConfig },
  };
}

export class InMemoryFleetRepository implements FleetRepository {
  private readonly cohorts = new Map<string, FleetCohort>();
  private readonly policies = new Map<string, FleetPolicy>();
  private readonly runs = new Map<string, FleetBatchRun>();

  listCohorts(): FleetCohort[] {
    return [...this.cohorts.values()].map(cloneCohort).reverse();
  }

  getCohort(id: string): FleetCohort | null {
    const found = this.cohorts.get(id);
    return found ? cloneCohort(found) : null;
  }

  saveCohort(cohort: FleetCohort): void {
    this.cohorts.set(cohort.id, cloneCohort(cohort));
  }

  deleteCohort(id: string): boolean {
    return this.cohorts.delete(id);
  }

  listPolicies(): FleetPolicy[] {
    return [...this.policies.values()].map(clonePolicy).reverse();
  }

  getPolicy(id: string): FleetPolicy | null {
    const found = this.policies.get(id);
    return found ? clonePolicy(found) : null;
  }

  savePolicy(policy: FleetPolicy): void {
    this.policies.set(policy.id, clonePolicy(policy));
  }

  deletePolicy(id: string): boolean {
    return this.policies.delete(id);
  }

  listBatchRuns(): FleetBatchRun[] {
    return [...this.runs.values()].map(cloneRun).reverse();
  }

  getBatchRun(id: string): FleetBatchRun | null {
    const found = this.runs.get(id);
    return found ? cloneRun(found) : null;
  }

  saveBatchRun(run: FleetBatchRun): void {
    this.runs.set(run.id, cloneRun(run));
  }
}
