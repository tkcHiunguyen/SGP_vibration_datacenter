import type {
  AlertSeverity,
  IncidentEventType,
  IncidentRecord,
  IncidentStatus,
  IncidentTimelineEntry,
} from '../../shared/types.js';
import type { IncidentQueryFilters, IncidentRepository, IncidentSummary } from './incident.repository.js';

export type CreateIncidentInput = {
  title: string;
  severity: AlertSeverity;
  actor: string;
  site?: string;
  deviceId?: string;
  alertId?: string;
  owner?: string;
  note?: string;
};

export class IncidentService {
  constructor(private readonly repository: IncidentRepository) {}

  list(filters: IncidentQueryFilters = {}): IncidentRecord[] {
    return this.repository.list(filters);
  }

  summarize(filters: IncidentQueryFilters = {}): IncidentSummary {
    return this.repository.summarize(filters);
  }

  get(incidentId: string): IncidentRecord | null {
    return this.repository.get(incidentId);
  }

  listTimeline(incidentId: string, limit = 100): IncidentTimelineEntry[] {
    return this.repository.listTimeline(incidentId, limit);
  }

  create(input: CreateIncidentInput): IncidentRecord {
    const now = new Date().toISOString();
    const incident: IncidentRecord = {
      incidentId: this.createId('incident'),
      title: input.title.trim(),
      summary: input.note?.trim() || undefined,
      severity: input.severity,
      status: input.owner?.trim() ? 'assigned' : 'open',
      owner: input.owner?.trim() || undefined,
      site: input.site?.trim() || undefined,
      deviceId: input.deviceId?.trim() || undefined,
      alertIds: input.alertId ? [input.alertId] : [],
      primaryAlertId: input.alertId?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      openedAt: now,
      assignedAt: input.owner?.trim() ? now : undefined,
      assignedBy: input.owner?.trim() ? input.actor : undefined,
    };

    this.repository.save(incident);
    this.recordTimeline(incident.incidentId, 'created', input.actor, `Created incident ${incident.title}`);
    if (incident.primaryAlertId) {
      this.recordTimeline(incident.incidentId, 'linked_alert', input.actor, `Linked alert ${incident.primaryAlertId}`, {
        alertId: incident.primaryAlertId,
      });
    }
    if (incident.owner) {
      this.recordTimeline(incident.incidentId, 'assigned', input.actor, `Assigned to ${incident.owner}`, {
        owner: incident.owner,
      });
    }
    if (input.note?.trim()) {
      this.recordTimeline(incident.incidentId, 'note', input.actor, input.note.trim());
    }
    return incident;
  }

  assign(incidentId: string, owner: string, actor: string, note?: string): IncidentRecord | null {
    const existing = this.repository.get(incidentId);
    if (!existing || existing.status === 'closed' || existing.status === 'resolved') {
      return null;
    }

    const now = new Date().toISOString();
    const updated: IncidentRecord = {
      ...existing,
      owner: owner.trim(),
      status: 'assigned',
      assignedAt: now,
      assignedBy: actor,
      updatedAt: now,
    };

    this.repository.update(updated);
    this.recordTimeline(incidentId, 'assigned', actor, `Assigned to ${updated.owner}`, { owner: updated.owner });
    if (note?.trim()) {
      this.recordTimeline(incidentId, 'note', actor, note.trim());
    }
    return updated;
  }

  addNote(incidentId: string, actor: string, note: string): IncidentRecord | null {
    const existing = this.repository.get(incidentId);
    if (!existing || existing.status === 'closed') {
      return null;
    }

    const trimmed = note.trim();
    if (!trimmed) {
      return existing;
    }

    const now = new Date().toISOString();
    const nextStatus: IncidentStatus =
      existing.status === 'open' || existing.status === 'assigned' ? 'monitoring' : existing.status;
    const updated: IncidentRecord = {
      ...existing,
      status: nextStatus,
      monitoringAt: nextStatus === 'monitoring' ? existing.monitoringAt ?? now : existing.monitoringAt,
      updatedAt: now,
    };

    this.repository.update(updated);
    if (nextStatus !== existing.status) {
      this.recordTimeline(incidentId, 'monitoring', actor, 'Moved incident to monitoring');
    }
    this.recordTimeline(incidentId, 'note', actor, trimmed);
    return updated;
  }

  resolve(incidentId: string, actor: string, note?: string): IncidentRecord | null {
    const existing = this.repository.get(incidentId);
    if (!existing || existing.status === 'closed' || existing.status === 'resolved') {
      return null;
    }

    const now = new Date().toISOString();
    const updated: IncidentRecord = {
      ...existing,
      status: 'resolved',
      resolvedAt: now,
      resolvedBy: actor,
      updatedAt: now,
    };

    this.repository.update(updated);
    this.recordTimeline(incidentId, 'resolved', actor, note?.trim() || 'Resolved incident');
    return updated;
  }

  close(incidentId: string, actor: string, note?: string): IncidentRecord | null {
    const existing = this.repository.get(incidentId);
    if (!existing || existing.status !== 'resolved') {
      return null;
    }

    const now = new Date().toISOString();
    const updated: IncidentRecord = {
      ...existing,
      status: 'closed',
      closedAt: now,
      closedBy: actor,
      updatedAt: now,
    };

    this.repository.update(updated);
    this.recordTimeline(incidentId, 'closed', actor, note?.trim() || 'Closed incident');
    return updated;
  }

  private recordTimeline(
    incidentId: string,
    type: IncidentEventType,
    actor: string,
    message?: string,
    metadata?: Record<string, unknown>,
  ): IncidentTimelineEntry {
    const entry: IncidentTimelineEntry = {
      entryId: this.createId('incident-event'),
      incidentId,
      type,
      actor,
      createdAt: new Date().toISOString(),
      message,
      metadata,
    };
    this.repository.addTimeline(entry);
    return entry;
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
