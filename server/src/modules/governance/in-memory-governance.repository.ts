import type { GovernanceRepository } from './governance.repository.js';
import type {
  GovernanceApprovalFilters,
  GovernanceApprovalRecord,
  GovernanceSummary,
} from './governance.types.js';

function cloneApproval(record: GovernanceApprovalRecord): GovernanceApprovalRecord {
  return {
    ...record,
    target: { ...record.target },
  };
}

export class InMemoryGovernanceRepository implements GovernanceRepository {
  private readonly approvals = new Map<string, GovernanceApprovalRecord>();

  saveApproval(record: GovernanceApprovalRecord): void {
    this.approvals.set(record.approvalId, cloneApproval(record));
  }

  getApproval(approvalId: string): GovernanceApprovalRecord | null {
    const found = this.approvals.get(approvalId);
    return found ? cloneApproval(found) : null;
  }

  listApprovals(filters: GovernanceApprovalFilters = {}): GovernanceApprovalRecord[] {
    const all = [...this.approvals.values()]
      .filter((record) => {
        if (filters.actionType && record.actionType !== filters.actionType) {
          return false;
        }
        if (filters.status && record.status !== filters.status) {
          return false;
        }
        if (filters.requestedBy && record.requestedBy !== filters.requestedBy) {
          return false;
        }
        if (filters.approverId && record.approverId !== filters.approverId) {
          return false;
        }
        return true;
      })
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(cloneApproval);

    return all.slice(0, filters.limit ?? all.length);
  }

  summarize(): GovernanceSummary {
    const counters: GovernanceSummary = {
      pending: 0,
      approved: 0,
      rejected: 0,
      used: 0,
      expired: 0,
      canceled: 0,
    };

    for (const approval of this.approvals.values()) {
      if (approval.status in counters) {
        counters[approval.status] += 1;
      }
    }

    return counters;
  }
}
