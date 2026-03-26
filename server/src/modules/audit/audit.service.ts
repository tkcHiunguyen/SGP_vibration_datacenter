import type { AuditRepository } from './audit.repository.js';
import type {
  AuditQueryFilters,
  AuditRecord,
  CreateAuditRecordInput,
  AuditMetadata,
} from './audit.types.js';

function normalizeMetadata(metadata?: AuditMetadata): AuditMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const normalized: AuditMetadata = {
    ...metadata,
  };

  const summary = metadata.changeSummary;
  if (summary) {
    if (normalized.beforeSummary === undefined && summary.before !== undefined) {
      normalized.beforeSummary = summary.before;
    }

    if (normalized.afterSummary === undefined && summary.after !== undefined) {
      normalized.afterSummary = summary.after;
    }
  }

  if (
    normalized.changeSummary === undefined &&
    (normalized.beforeSummary !== undefined || normalized.afterSummary !== undefined)
  ) {
    normalized.changeSummary = {
      before: normalized.beforeSummary,
      after: normalized.afterSummary,
    };
  }

  return normalized;
}

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  record(input: CreateAuditRecordInput): AuditRecord {
    const nowIso = new Date().toISOString();
    const record: AuditRecord = {
      auditId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      action: input.action,
      deviceId: input.deviceId,
      commandId: input.commandId,
      actor: input.actor,
      createdAt: nowIso,
      result: input.result,
      metadata: normalizeMetadata(input.metadata),
    };

    this.repository.save(record);
    return record;
  }

  get(auditId: string): AuditRecord | null {
    return this.repository.get(auditId);
  }

  listRecent(limit = 100): AuditRecord[] {
    return this.repository.list(limit);
  }

  query(filters: AuditQueryFilters = {}): AuditRecord[] {
    return this.repository.query(filters);
  }

  listByCommandId(commandId: string, limit = 100): AuditRecord[] {
    return this.repository.listByCommandId(commandId, limit);
  }

  listByDeviceId(deviceId: string, limit = 100): AuditRecord[] {
    return this.repository.listByDeviceId(deviceId, limit);
  }

  listByActor(actor: string, limit = 100): AuditRecord[] {
    return this.repository.listByActor(actor, limit);
  }

  listByAction(action: string, limit = 100): AuditRecord[] {
    return this.repository.listByAction(action, limit);
  }

  listByTimeRange(from?: string | Date, to?: string | Date, limit = 100): AuditRecord[] {
    return this.repository.listByTimeRange(from, to, limit);
  }
}
