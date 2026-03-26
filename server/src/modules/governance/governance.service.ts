import type { GovernanceRepository } from './governance.repository.js';
import type {
  CreateGovernanceApprovalInput,
  GovernanceApprovalDecision,
  GovernanceApprovalFilters,
  GovernanceApprovalRecord,
  GovernanceConsumeApprovalInput,
  GovernanceSummary,
} from './governance.types.js';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function safeDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export class GovernanceService {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly defaultTtlMinutes = 60,
  ) {}

  createApprovalRequest(input: CreateGovernanceApprovalInput): GovernanceApprovalRecord {
    const now = new Date();
    const ttlMinutes = Number.isFinite(input.expiresInMinutes)
      ? Math.max(5, Math.floor(input.expiresInMinutes ?? this.defaultTtlMinutes))
      : this.defaultTtlMinutes;

    const record: GovernanceApprovalRecord = {
      approvalId: createId('approval'),
      actionType: input.actionType,
      riskLevel: input.riskLevel ?? 'high',
      status: 'pending',
      requestedBy: input.requestedBy,
      requestNote: normalizeText(input.requestNote),
      rationale: normalizeText(input.rationale),
      target: {
        ...input.target,
        resourceId: normalizeText(input.target.resourceId),
        cohortRef: normalizeText(input.target.cohortRef),
        site: normalizeText(input.target.site),
        zone: normalizeText(input.target.zone),
        strategy: normalizeText(input.target.strategy),
        targetCount: Math.max(0, Math.floor(input.target.targetCount)),
      },
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.repository.saveApproval(record);
    return record;
  }

  approve(approvalId: string, approverId: string, note?: string): GovernanceApprovalDecision {
    const approval = this.repository.getApproval(approvalId);
    if (!approval) {
      return { ok: false, reason: 'approval_not_found' };
    }

    this.expireIfNeeded(approval);

    if (approval.status !== 'pending') {
      return {
        ok: false,
        reason: 'approval_not_pending',
        details: {
          status: approval.status,
        },
      };
    }

    if (approval.requestedBy === approverId) {
      return {
        ok: false,
        reason: 'approver_must_differ_from_requester',
      };
    }

    const now = new Date().toISOString();
    approval.status = 'approved';
    approval.approverId = approverId;
    approval.approverNote = normalizeText(note);
    approval.approvedAt = now;
    approval.updatedAt = now;
    this.repository.saveApproval(approval);

    return {
      ok: true,
      approval,
    };
  }

  reject(approvalId: string, actor: string, note?: string): GovernanceApprovalDecision {
    const approval = this.repository.getApproval(approvalId);
    if (!approval) {
      return { ok: false, reason: 'approval_not_found' };
    }

    this.expireIfNeeded(approval);
    if (approval.status !== 'pending') {
      return {
        ok: false,
        reason: 'approval_not_pending',
        details: {
          status: approval.status,
        },
      };
    }

    const now = new Date().toISOString();
    approval.status = 'rejected';
    approval.rejectedBy = actor;
    approval.rejectedNote = normalizeText(note);
    approval.rejectedAt = now;
    approval.updatedAt = now;
    this.repository.saveApproval(approval);

    return {
      ok: true,
      approval,
    };
  }

  consumeApproval(input: GovernanceConsumeApprovalInput): GovernanceApprovalDecision {
    const approval = this.repository.getApproval(input.approvalId);
    if (!approval) {
      return { ok: false, reason: 'approval_not_found' };
    }

    this.expireIfNeeded(approval);

    if (approval.status !== 'approved') {
      return {
        ok: false,
        reason: 'approval_not_approved',
        details: {
          status: approval.status,
        },
      };
    }

    if (approval.actionType !== input.actionType) {
      return {
        ok: false,
        reason: 'approval_action_mismatch',
        details: {
          expected: approval.actionType,
          received: input.actionType,
        },
      };
    }

    const normalizedResourceId = normalizeText(input.resourceId);
    if (approval.target.resourceId && normalizedResourceId && approval.target.resourceId !== normalizedResourceId) {
      return {
        ok: false,
        reason: 'approval_resource_mismatch',
        details: {
          expected: approval.target.resourceId,
          received: normalizedResourceId,
        },
      };
    }

    const normalizedCohortRef = normalizeText(input.cohortRef);
    if (approval.target.cohortRef && normalizedCohortRef && approval.target.cohortRef !== normalizedCohortRef) {
      return {
        ok: false,
        reason: 'approval_cohort_mismatch',
        details: {
          expected: approval.target.cohortRef,
          received: normalizedCohortRef,
        },
      };
    }

    if (typeof input.targetCount === 'number' && Number.isFinite(input.targetCount)) {
      const requestedTargetCount = Math.max(0, Math.floor(input.targetCount));
      if (requestedTargetCount > approval.target.targetCount) {
        return {
          ok: false,
          reason: 'approval_target_count_exceeded',
          details: {
            approvedTargetCount: approval.target.targetCount,
            requestedTargetCount,
          },
        };
      }
    }

    const now = new Date().toISOString();
    approval.status = 'used';
    approval.usedBy = input.actor;
    approval.usedAt = now;
    approval.updatedAt = now;
    this.repository.saveApproval(approval);

    return {
      ok: true,
      approval,
    };
  }

  getApproval(approvalId: string): GovernanceApprovalRecord | null {
    const approval = this.repository.getApproval(approvalId);
    if (!approval) {
      return null;
    }
    this.expireIfNeeded(approval);
    return this.repository.getApproval(approvalId);
  }

  listApprovals(filters: GovernanceApprovalFilters = {}): GovernanceApprovalRecord[] {
    this.expirePending();
    return this.repository.listApprovals(filters);
  }

  expirePending(nowIso = new Date().toISOString()): number {
    let changed = 0;
    for (const approval of this.repository.listApprovals({ status: 'pending', limit: 10_000 })) {
      const expiresAt = safeDate(approval.expiresAt);
      const now = safeDate(nowIso);
      if (expiresAt === null || now === null || expiresAt > now) {
        continue;
      }
      approval.status = 'expired';
      approval.updatedAt = nowIso;
      this.repository.saveApproval(approval);
      changed += 1;
    }
    return changed;
  }

  summarize(): GovernanceSummary {
    this.expirePending();
    return this.repository.summarize();
  }

  private expireIfNeeded(approval: GovernanceApprovalRecord): void {
    if (approval.status !== 'pending') {
      return;
    }

    const expiresAt = safeDate(approval.expiresAt);
    if (expiresAt === null) {
      return;
    }

    if (expiresAt <= Date.now()) {
      approval.status = 'expired';
      approval.updatedAt = new Date().toISOString();
      this.repository.saveApproval(approval);
    }
  }
}
