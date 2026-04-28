type AuditTargetResource = {
  resourceType: string;
  resourceId: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
};

type AuditChangeSummary = {
  before?: string;
  after?: string;
};

export type AuditMetadata = Record<string, unknown> & {
  targetResource?: AuditTargetResource;
  beforeSummary?: string;
  afterSummary?: string;
  changeSummary?: AuditChangeSummary;
};

export type AuditRecord = {
  auditId: string;
  action: string;
  deviceId: string;
  commandId: string;
  actor: string;
  createdAt: string;
  result: string;
  metadata?: AuditMetadata;
};

export type CreateAuditRecordInput = {
  action: string;
  deviceId: string;
  commandId: string;
  actor: string;
  result: string;
  metadata?: AuditMetadata;
};

export type AuditQueryFilters = {
  actor?: string;
  action?: string;
  commandId?: string;
  deviceId?: string;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
};
