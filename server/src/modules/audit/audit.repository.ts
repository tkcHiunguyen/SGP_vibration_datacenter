import type { AuditQueryFilters, AuditRecord } from './audit.types.js';

export interface AuditRepository {
  save(record: AuditRecord): void;
  get(auditId: string): AuditRecord | null;
  list(limit?: number): AuditRecord[];
  query(filters?: AuditQueryFilters): AuditRecord[];
  listByCommandId(commandId: string, limit?: number): AuditRecord[];
  listByDeviceId(deviceId: string, limit?: number): AuditRecord[];
  listByActor(actor: string, limit?: number): AuditRecord[];
  listByAction(action: string, limit?: number): AuditRecord[];
  listByTimeRange(from?: string | Date, to?: string | Date, limit?: number): AuditRecord[];
}
