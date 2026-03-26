import type { FleetBatchRun, FleetCohort, FleetPolicy } from './fleet.types.js';

export interface FleetRepository {
  listCohorts(): FleetCohort[];
  getCohort(id: string): FleetCohort | null;
  saveCohort(cohort: FleetCohort): void;
  deleteCohort(id: string): boolean;

  listPolicies(): FleetPolicy[];
  getPolicy(id: string): FleetPolicy | null;
  savePolicy(policy: FleetPolicy): void;
  deletePolicy(id: string): boolean;

  listBatchRuns(): FleetBatchRun[];
  getBatchRun(id: string): FleetBatchRun | null;
  saveBatchRun(run: FleetBatchRun): void;
}
