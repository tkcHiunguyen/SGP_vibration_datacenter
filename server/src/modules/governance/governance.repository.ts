import type {
  GovernanceApprovalFilters,
  GovernanceApprovalRecord,
  GovernanceSummary,
} from './governance.types.js';

export interface GovernanceRepository {
  saveApproval(record: GovernanceApprovalRecord): void;
  getApproval(approvalId: string): GovernanceApprovalRecord | null;
  listApprovals(filters?: GovernanceApprovalFilters): GovernanceApprovalRecord[];
  summarize(): GovernanceSummary;
}
