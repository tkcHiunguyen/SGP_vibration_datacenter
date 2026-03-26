export type GovernanceActionType = 'fleet_batch_apply' | 'rollout_start';

export type GovernanceRiskLevel = 'normal' | 'high' | 'critical';

export type GovernanceApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'used' | 'canceled';

export type GovernanceTargetResource = {
  resourceType: 'fleet_batch' | 'rollout_plan';
  resourceId?: string;
  cohortRef?: string;
  site?: string;
  zone?: string;
  strategy?: string;
  targetCount: number;
};

export type GovernanceApprovalRecord = {
  approvalId: string;
  actionType: GovernanceActionType;
  riskLevel: GovernanceRiskLevel;
  status: GovernanceApprovalStatus;
  requestedBy: string;
  requestNote?: string;
  rationale?: string;
  target: GovernanceTargetResource;
  approverId?: string;
  approverNote?: string;
  rejectedBy?: string;
  rejectedNote?: string;
  usedBy?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  usedAt?: string;
};

export type CreateGovernanceApprovalInput = {
  actionType: GovernanceActionType;
  riskLevel?: GovernanceRiskLevel;
  requestedBy: string;
  requestNote?: string;
  rationale?: string;
  target: GovernanceTargetResource;
  expiresInMinutes?: number;
};

export type GovernanceApprovalFilters = {
  actionType?: GovernanceActionType;
  status?: GovernanceApprovalStatus;
  requestedBy?: string;
  approverId?: string;
  limit?: number;
};

export type GovernanceConsumeApprovalInput = {
  approvalId: string;
  actionType: GovernanceActionType;
  actor: string;
  resourceId?: string;
  cohortRef?: string;
  targetCount?: number;
};

export type GovernanceApprovalDecision =
  | { ok: true; approval: GovernanceApprovalRecord }
  | { ok: false; reason: string; details?: Record<string, unknown> };

export type GovernanceSummary = {
  pending: number;
  approved: number;
  rejected: number;
  used: number;
  expired: number;
  canceled: number;
};
