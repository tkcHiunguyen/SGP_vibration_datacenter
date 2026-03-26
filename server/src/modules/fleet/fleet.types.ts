import type { DeviceListItem } from '../device/device.service.js';

export type FleetCohortFilters = {
  site?: string;
  zone?: string;
  status?: 'online' | 'offline';
  search?: string;
};

export type FleetCohort = {
  id: string;
  name: string;
  filters: FleetCohortFilters;
  policyId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type FleetPolicyScope = {
  site?: string;
  zone?: string;
};

export type FleetPolicy = {
  id: string;
  name: string;
  scope: FleetPolicyScope;
  baselineConfig: Record<string, unknown>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type FleetPolicyConflictReasonCode =
  | 'POLICY_SITE_FILTER_REQUIRED'
  | 'POLICY_SITE_MISMATCH'
  | 'POLICY_ZONE_FILTER_REQUIRED'
  | 'POLICY_ZONE_MISMATCH';

export type FleetBatchCommandType = 'set_config';

export type FleetBatchStatus = 'dry_run' | 'completed' | 'partial' | 'failed';

export type FleetBatchItemStatus = 'accepted' | 'failed';

export type FleetBatchItem = {
  deviceId: string;
  status: FleetBatchItemStatus;
  reason?: string;
};

export type FleetBatchRun = {
  id: string;
  cohortRef: string;
  commandType: FleetBatchCommandType;
  payload: Record<string, unknown>;
  dryRun: boolean;
  targetCount: number;
  acceptedCount: number;
  failedCount: number;
  status: FleetBatchStatus;
  createdAt: string;
  completedAt?: string;
};

export type FleetDevice = DeviceListItem;

export type FleetSenderResult = {
  accepted: boolean;
  reason?: string;
};

export type FleetSender = (
  deviceId: string,
  payload: Record<string, unknown>,
) => Promise<FleetSenderResult> | FleetSenderResult;

export type FleetBatchApplyResult = {
  run: FleetBatchRun;
  items: FleetBatchItem[];
};

export type CreateFleetCohortInput = {
  name: string;
  filters?: FleetCohortFilters;
  notes?: string;
};

export type UpdateFleetCohortInput = {
  name?: string;
  filters?: FleetCohortFilters;
  notes?: string | null;
};

export type CreateFleetPolicyInput = {
  name: string;
  scope?: FleetPolicyScope;
  baselineConfig: Record<string, unknown>;
  notes?: string;
};

export type UpdateFleetPolicyInput = {
  name?: string;
  scope?: FleetPolicyScope;
  baselineConfig?: Record<string, unknown>;
  notes?: string | null;
};

export type AttachFleetPolicyResult =
  | {
      ok: true;
      cohort: FleetCohort;
      policy: FleetPolicy;
    }
  | {
      ok: false;
      reason: 'cohort_not_found' | 'policy_not_found' | 'policy_scope_conflict';
      details?: Record<string, unknown>;
    };

export type FleetPolicyCompatibilityResult =
  | {
      ok: true;
      cohort: FleetCohort;
      policy: FleetPolicy;
    }
  | {
      ok: false;
      reason: 'cohort_not_found' | 'policy_not_found' | 'policy_scope_conflict';
      details?: {
        reasonCode: FleetPolicyConflictReasonCode;
        field: 'site' | 'zone';
        policySite?: string;
        cohortSite?: string;
        policyZone?: string;
        cohortZone?: string;
      };
    };
