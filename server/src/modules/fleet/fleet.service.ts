import type { DeviceListItem } from '../device/device.service.js';
import type {
  AttachFleetPolicyResult,
  CreateFleetCohortInput,
  CreateFleetPolicyInput,
  FleetBatchApplyResult,
  FleetBatchItem,
  FleetBatchRun,
  FleetBatchCommandType,
  FleetCohort,
  FleetCohortFilters,
  FleetPolicyCompatibilityResult,
  FleetPolicyConflictReasonCode,
  FleetPolicy,
  FleetPolicyScope,
  FleetSender,
  UpdateFleetCohortInput,
  UpdateFleetPolicyInput,
} from './fleet.types.js';
import type { FleetRepository } from './fleet.repository.js';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value?: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeFilters(filters: FleetCohortFilters = {}): FleetCohortFilters {
  return {
    site: filters.site?.trim() || undefined,
    zone: filters.zone?.trim() || undefined,
    status: filters.status,
    search: filters.search?.trim() || undefined,
  };
}

function normalizeScope(scope: FleetPolicyScope = {}): FleetPolicyScope {
  return {
    site: scope.site?.trim() || undefined,
    zone: scope.zone?.trim() || undefined,
  };
}

function createBaseRun(
  cohortRef: string,
  payload: Record<string, unknown>,
  commandType: FleetBatchCommandType,
  targetCount: number,
  dryRun: boolean,
): FleetBatchRun {
  const now = new Date().toISOString();
  return {
    id: createId('fleet-run'),
    cohortRef,
    commandType,
    payload: { ...payload },
    dryRun,
    targetCount,
    acceptedCount: 0,
    failedCount: 0,
    status: dryRun ? 'dry_run' : 'completed',
    createdAt: now,
    completedAt: now,
  };
}

function computeStatus(acceptedCount: number, failedCount: number): FleetBatchRun['status'] {
  if (failedCount === 0) {
    return 'completed';
  }
  if (acceptedCount === 0) {
    return 'failed';
  }
  return 'partial';
}

export class FleetService {
  constructor(private readonly repository: FleetRepository) {}

  listCohorts(): FleetCohort[] {
    return this.repository.listCohorts();
  }

  getCohort(id: string): FleetCohort | null {
    return this.repository.getCohort(id);
  }

  createCohort(input: CreateFleetCohortInput): FleetCohort {
    const now = new Date().toISOString();
    const cohort: FleetCohort = {
      id: createId('fleet-cohort'),
      name: input.name.trim(),
      filters: normalizeFilters(input.filters),
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.repository.saveCohort(cohort);
    return cohort;
  }

  updateCohort(id: string, input: UpdateFleetCohortInput): FleetCohort | null {
    const existing = this.repository.getCohort(id);
    if (!existing) {
      return null;
    }

    const cohort: FleetCohort = {
      ...existing,
      name: input.name?.trim() || existing.name,
      notes: input.notes === undefined ? existing.notes : input.notes?.trim() || undefined,
      filters: {
        ...existing.filters,
        ...normalizeFilters(input.filters ?? {}),
      },
      updatedAt: new Date().toISOString(),
    };
    this.repository.saveCohort(cohort);
    return cohort;
  }

  deleteCohort(id: string): boolean {
    return this.repository.deleteCohort(id);
  }

  listPolicies(): FleetPolicy[] {
    return this.repository.listPolicies();
  }

  getPolicy(id: string): FleetPolicy | null {
    return this.repository.getPolicy(id);
  }

  createPolicy(input: CreateFleetPolicyInput): FleetPolicy {
    const now = new Date().toISOString();
    const policy: FleetPolicy = {
      id: createId('fleet-policy'),
      name: input.name.trim(),
      scope: normalizeScope(input.scope),
      baselineConfig: { ...input.baselineConfig },
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.repository.savePolicy(policy);
    return policy;
  }

  updatePolicy(id: string, input: UpdateFleetPolicyInput): FleetPolicy | null {
    const existing = this.repository.getPolicy(id);
    if (!existing) {
      return null;
    }

    const nextScope = input.scope
      ? {
          ...existing.scope,
          ...normalizeScope(input.scope),
        }
      : existing.scope;

    const policy: FleetPolicy = {
      ...existing,
      name: input.name?.trim() || existing.name,
      scope: nextScope,
      baselineConfig: input.baselineConfig ? { ...input.baselineConfig } : { ...existing.baselineConfig },
      notes: input.notes === undefined ? existing.notes : input.notes?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    this.repository.savePolicy(policy);
    return policy;
  }

  deletePolicy(id: string):
    | { ok: true }
    | { ok: false; reason: 'policy_not_found' | 'policy_attached'; details?: Record<string, unknown> } {
    const existing = this.repository.getPolicy(id);
    if (!existing) {
      return { ok: false, reason: 'policy_not_found' };
    }

    const attachedCohortIds = this.repository
      .listCohorts()
      .filter((cohort) => cohort.policyId === id)
      .map((cohort) => cohort.id);
    if (attachedCohortIds.length > 0) {
      return {
        ok: false,
        reason: 'policy_attached',
        details: { attachedCohortIds },
      };
    }

    this.repository.deletePolicy(id);
    return { ok: true };
  }

  attachPolicyToCohort(cohortId: string, policyId: string): AttachFleetPolicyResult {
    const compatibility = this.evaluatePolicyCompatibility(cohortId, policyId);
    if (!compatibility.ok) {
      return compatibility;
    }

    const { cohort, policy } = compatibility;
    const updated: FleetCohort = {
      ...cohort,
      policyId: policy.id,
      updatedAt: new Date().toISOString(),
    };
    this.repository.saveCohort(updated);
    return { ok: true, cohort: updated, policy };
  }

  evaluatePolicyCompatibility(cohortId: string, policyId: string): FleetPolicyCompatibilityResult {
    const cohort = this.repository.getCohort(cohortId);
    if (!cohort) {
      return { ok: false, reason: 'cohort_not_found' };
    }

    const policy = this.repository.getPolicy(policyId);
    if (!policy) {
      return { ok: false, reason: 'policy_not_found' };
    }

    const conflict = this.validatePolicyCompatibility(cohort, policy);
    if (conflict) {
      return {
        ok: false,
        reason: 'policy_scope_conflict',
        details: conflict,
      };
    }
    return { ok: true, cohort, policy };
  }

  detachPolicyFromCohort(cohortId: string): FleetCohort | null {
    const cohort = this.repository.getCohort(cohortId);
    if (!cohort) {
      return null;
    }

    const updated: FleetCohort = {
      ...cohort,
      policyId: undefined,
      updatedAt: new Date().toISOString(),
    };
    this.repository.saveCohort(updated);
    return updated;
  }

  previewByFilters(devices: DeviceListItem[], filters: FleetCohortFilters): DeviceListItem[] {
    const normalized = normalizeFilters(filters);
    return devices.filter((device) => this.matchesFilters(device, normalized));
  }

  previewByCohort(devices: DeviceListItem[], cohortId: string): DeviceListItem[] {
    const cohort = this.repository.getCohort(cohortId);
    if (!cohort) {
      return [];
    }
    return this.previewByFilters(devices, cohort.filters);
  }

  runDryRun(
    devices: DeviceListItem[],
    payload: Record<string, unknown>,
    commandType: FleetBatchCommandType = 'set_config',
    cohortRef = 'adhoc',
  ): FleetBatchRun {
    const run = createBaseRun(cohortRef, payload, commandType, devices.length, true);
    this.repository.saveBatchRun(run);
    return run;
  }

  async runApply(
    devices: DeviceListItem[],
    payload: Record<string, unknown>,
    sender: FleetSender,
    commandType: FleetBatchCommandType = 'set_config',
    cohortRef = 'adhoc',
  ): Promise<FleetBatchApplyResult> {
    const run = createBaseRun(cohortRef, payload, commandType, devices.length, false);
    const items: FleetBatchItem[] = [];

    for (const device of devices) {
      try {
        const result = await sender(device.deviceId, payload);
        if (result.accepted) {
          items.push({
            deviceId: device.deviceId,
            status: 'accepted',
            commandId: result.commandId,
          });
          continue;
        }
        items.push({
          deviceId: device.deviceId,
          status: 'failed',
          reason: result.reason?.trim() || 'rejected',
        });
      } catch (error: unknown) {
        items.push({
          deviceId: device.deviceId,
          status: 'failed',
          reason: this.describeError(error),
        });
      }
    }

    const acceptedCount = items.filter((item) => item.status === 'accepted').length;
    const failedCount = items.length - acceptedCount;
    const completedAt = new Date().toISOString();
    const completedRun: FleetBatchRun = {
      ...run,
      acceptedCount,
      failedCount,
      status: computeStatus(acceptedCount, failedCount),
      completedAt,
    };
    this.repository.saveBatchRun(completedRun);
    return { run: completedRun, items };
  }

  listBatchRuns(): FleetBatchRun[] {
    return this.repository.listBatchRuns();
  }

  getBatchRun(id: string): FleetBatchRun | null {
    return this.repository.getBatchRun(id);
  }

  private validatePolicyCompatibility(
    cohort: FleetCohort,
    policy: FleetPolicy,
  ): {
    reasonCode: FleetPolicyConflictReasonCode;
    field: 'site' | 'zone';
    policySite?: string;
    cohortSite?: string;
    policyZone?: string;
    cohortZone?: string;
  } | null {
    const cohortSite = normalizeText(cohort.filters.site);
    const cohortZone = normalizeText(cohort.filters.zone);
    const policySite = normalizeText(policy.scope.site);
    const policyZone = normalizeText(policy.scope.zone);

    if (policySite && !cohortSite) {
      return {
        reasonCode: 'POLICY_SITE_FILTER_REQUIRED',
        field: 'site',
        policySite: policy.scope.site,
      };
    }
    if (policySite && cohortSite !== policySite) {
      return {
        reasonCode: 'POLICY_SITE_MISMATCH',
        field: 'site',
        policySite: policy.scope.site,
        cohortSite: cohort.filters.site,
      };
    }

    if (policyZone && !cohortZone) {
      return {
        reasonCode: 'POLICY_ZONE_FILTER_REQUIRED',
        field: 'zone',
        policyZone: policy.scope.zone,
      };
    }
    if (policyZone && cohortZone !== policyZone) {
      return {
        reasonCode: 'POLICY_ZONE_MISMATCH',
        field: 'zone',
        policyZone: policy.scope.zone,
        cohortZone: cohort.filters.zone,
      };
    }

    return null;
  }

  private matchesFilters(device: DeviceListItem, filters: FleetCohortFilters): boolean {
    if (filters.status === 'online' && !device.online) {
      return false;
    }

    if (filters.status === 'offline' && device.online) {
      return false;
    }

    if (filters.site && normalizeText(device.metadata?.site) !== normalizeText(filters.site)) {
      return false;
    }

    if (filters.zone && normalizeText(device.metadata?.zone) !== normalizeText(filters.zone)) {
      return false;
    }

    if (filters.search && !this.matchesSearch(device, filters.search)) {
      return false;
    }

    return true;
  }

  private matchesSearch(device: DeviceListItem, search: string): boolean {
    const needle = normalizeText(search);
    if (!needle) {
      return true;
    }

    const haystack = [
      device.deviceId,
      device.socketId,
      device.connectedAt,
      device.metadata?.name,
      device.metadata?.site,
      device.metadata?.zone,
      device.metadata?.firmwareVersion,
      device.metadata?.sensorVersion,
      device.metadata?.notes,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
      .join(' ');

    return haystack.includes(needle);
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.trim();
      return message || 'sender_error';
    }
    if (typeof error === 'string') {
      const message = error.trim();
      return message || 'sender_error';
    }
    return 'sender_error';
  }
}
