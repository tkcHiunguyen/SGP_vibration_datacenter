import type {
  AlertSeverity,
  IncidentEventType,
  IncidentRecord,
  IncidentStatus,
  IncidentTimelineEntry,
} from '../../shared/types.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import { getSharedMySqlAccess } from '../persistence/mysql-access.js';
import type { IncidentQueryFilters, IncidentRepository, IncidentSummary } from './incident.repository.js';

type IncidentRow = {
  incident_id: string;
  title: string;
  summary: string | null;
  severity: AlertSeverity;
  status: IncidentStatus;
  owner: string | null;
  site: string | null;
  device_id: string | null;
  alert_ids: string[] | string | null;
  primary_alert_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  opened_at: string | Date;
  assigned_at: string | Date | null;
  assigned_by: string | null;
  monitoring_at: string | Date | null;
  resolved_at: string | Date | null;
  resolved_by: string | null;
  closed_at: string | Date | null;
  closed_by: string | null;
};

type IncidentTimelineRow = {
  entry_id: string;
  incident_id: string;
  type: IncidentEventType;
  actor: string;
  created_at: string | Date;
  message: string | null;
  metadata: Record<string, unknown> | string | null;
};

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toOptionalIsoTimestamp(value: string | Date | null): string | undefined {
  return value ? toIsoTimestamp(value) : undefined;
}

export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly incidents = new Map<string, IncidentRecord>();
  private readonly timelineByIncident = new Map<string, IncidentTimelineEntry[]>();
  private readonly order: string[] = [];
  private readonly mysql: MySqlAccess | null;

  private constructor(mysql: MySqlAccess | null = getSharedMySqlAccess()) {
    this.mysql = mysql;
  }

  static async create(mysql: MySqlAccess | null = getSharedMySqlAccess()): Promise<InMemoryIncidentRepository> {
    const repository = new InMemoryIncidentRepository(mysql);
    await repository.ensurePersistenceShape();
    await repository.loadFromPersistence();
    return repository;
  }

  list(filters: IncidentQueryFilters = {}): IncidentRecord[] {
    const { limit = 100 } = filters;
    return this.getFilteredRecords(filters)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  summarize(filters: IncidentQueryFilters = {}): IncidentSummary {
    const incidents = this.getFilteredRecords({ ...filters, limit: undefined });
    const byStatus: Record<IncidentStatus, number> = {
      open: 0,
      assigned: 0,
      monitoring: 0,
      resolved: 0,
      closed: 0,
    };
    const bySeverity: Record<AlertSeverity, number> = {
      warning: 0,
      critical: 0,
    };
    const siteCounts = new Map<string, number>();
    const ownerCounts = new Map<string, number>();

    incidents.forEach((incident) => {
      byStatus[incident.status] += 1;
      bySeverity[incident.severity] += 1;
      if (incident.site) {
        siteCounts.set(incident.site, (siteCounts.get(incident.site) ?? 0) + 1);
      }
      if (incident.owner) {
        ownerCounts.set(incident.owner, (ownerCounts.get(incident.owner) ?? 0) + 1);
      }
    });

    return {
      total: incidents.length,
      byStatus,
      bySeverity,
      topSites: this.toTopCounts(siteCounts),
      topOwners: this.toTopCounts(ownerCounts),
      range: {
        from: filters.from,
        to: filters.to,
      },
    };
  }

  private getFilteredRecords(filters: IncidentQueryFilters): IncidentRecord[] {
    const { status, owner, severity, site, from, to } = filters;
    const normalizedOwner = String(owner || '').trim().toLowerCase();
    const normalizedSite = String(site || '').trim().toLowerCase();
    const fromTime = this.parseTime(from);
    const toTime = this.parseTime(to);

    return this.order
      .map((incidentId) => this.incidents.get(incidentId))
      .filter((record): record is IncidentRecord => Boolean(record))
      .filter((record) => !status || record.status === status)
      .filter((record) => !normalizedOwner || String(record.owner || '').toLowerCase().includes(normalizedOwner))
      .filter((record) => !severity || record.severity === severity)
      .filter((record) => !normalizedSite || String(record.site || '').toLowerCase().includes(normalizedSite))
      .filter((record) => {
        const updatedTime = this.parseTime(record.updatedAt);
        if (updatedTime === null) {
          return true;
        }
        if (fromTime !== null && updatedTime < fromTime) {
          return false;
        }
        if (toTime !== null && updatedTime > toTime) {
          return false;
        }
        return true;
      });
  }

  private parseTime(value?: string): number | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  private toTopCounts(source: Map<string, number>): Array<{ key: string; count: number }> {
    return [...source.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([key, count]) => ({ key, count }));
  }

  get(incidentId: string): IncidentRecord | null {
    return this.incidents.get(incidentId) || null;
  }

  save(record: IncidentRecord): void {
    this.incidents.set(record.incidentId, record);
    this.order.push(record.incidentId);
    void this.persistIncident(record);
  }

  update(record: IncidentRecord): void {
    this.incidents.set(record.incidentId, record);
    void this.persistIncident(record);
  }

  addTimeline(entry: IncidentTimelineEntry): void {
    const entries = this.timelineByIncident.get(entry.incidentId) ?? [];
    entries.push(entry);
    this.timelineByIncident.set(entry.incidentId, entries);
    void this.persistTimeline(entry);
  }

  listTimeline(incidentId: string, limit = 100): IncidentTimelineEntry[] {
    const entries = this.timelineByIncident.get(incidentId) ?? [];
    return [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-limit);
  }

  private async ensurePersistenceShape(): Promise<void> {
    if (!this.mysql) {
      return;
    }

    // Schema is initialized globally in MySqlAccess.
    await this.mysql.execute('SELECT 1');
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.mysql) {
      return;
    }

    const incidents = await this.mysql.query<IncidentRow>(`
      SELECT incident_id, title, summary, severity, status, owner, site, device_id, alert_ids, primary_alert_id,
             created_at, updated_at, opened_at, assigned_at, assigned_by, monitoring_at,
             resolved_at, resolved_by, closed_at, closed_by
      FROM incidents
      ORDER BY created_at ASC
    `);

    for (const row of incidents) {
      const record: IncidentRecord = {
        incidentId: row.incident_id,
        title: row.title,
        summary: row.summary ?? undefined,
        severity: row.severity,
        status: row.status,
        owner: row.owner ?? undefined,
        site: row.site ?? undefined,
        deviceId: row.device_id ?? undefined,
        alertIds:
          typeof row.alert_ids === 'string'
            ? (JSON.parse(row.alert_ids) as string[])
            : (row.alert_ids ?? []),
        primaryAlertId: row.primary_alert_id ?? undefined,
        createdAt: toIsoTimestamp(row.created_at),
        updatedAt: toIsoTimestamp(row.updated_at),
        openedAt: toIsoTimestamp(row.opened_at),
        assignedAt: toOptionalIsoTimestamp(row.assigned_at),
        assignedBy: row.assigned_by ?? undefined,
        monitoringAt: toOptionalIsoTimestamp(row.monitoring_at),
        resolvedAt: toOptionalIsoTimestamp(row.resolved_at),
        resolvedBy: row.resolved_by ?? undefined,
        closedAt: toOptionalIsoTimestamp(row.closed_at),
        closedBy: row.closed_by ?? undefined,
      };
      this.incidents.set(record.incidentId, record);
      this.order.push(record.incidentId);
    }

    const timeline = await this.mysql.query<IncidentTimelineRow>(`
      SELECT entry_id, incident_id, type, actor, created_at, message, metadata
      FROM incident_timeline
      ORDER BY created_at ASC
    `);

    for (const row of timeline) {
      const entry: IncidentTimelineEntry = {
        entryId: row.entry_id,
        incidentId: row.incident_id,
        type: row.type,
        actor: row.actor,
        createdAt: toIsoTimestamp(row.created_at),
        message: row.message ?? undefined,
        metadata:
          typeof row.metadata === 'string'
            ? (JSON.parse(row.metadata) as Record<string, unknown>)
            : (row.metadata ?? undefined),
      };
      const entries = this.timelineByIncident.get(entry.incidentId) ?? [];
      entries.push(entry);
      this.timelineByIncident.set(entry.incidentId, entries);
    }
  }

  private async persistIncident(record: IncidentRecord): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute(
      `
        INSERT INTO incidents (
          incident_id, title, summary, severity, status, owner, site, device_id, alert_ids, primary_alert_id,
          created_at, updated_at, opened_at, assigned_at, assigned_by, monitoring_at,
          resolved_at, resolved_by, closed_at, closed_by
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          summary = VALUES(summary),
          severity = VALUES(severity),
          status = VALUES(status),
          owner = VALUES(owner),
          site = VALUES(site),
          device_id = VALUES(device_id),
          alert_ids = VALUES(alert_ids),
          primary_alert_id = VALUES(primary_alert_id),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at),
          opened_at = VALUES(opened_at),
          assigned_at = VALUES(assigned_at),
          assigned_by = VALUES(assigned_by),
          monitoring_at = VALUES(monitoring_at),
          resolved_at = VALUES(resolved_at),
          resolved_by = VALUES(resolved_by),
          closed_at = VALUES(closed_at),
          closed_by = VALUES(closed_by)
      `,
      [
        record.incidentId,
        record.title,
        record.summary ?? null,
        record.severity,
        record.status,
        record.owner ?? null,
        record.site ?? null,
        record.deviceId ?? null,
        JSON.stringify(record.alertIds),
        record.primaryAlertId ?? null,
        record.createdAt,
        record.updatedAt,
        record.openedAt,
        record.assignedAt ?? null,
        record.assignedBy ?? null,
        record.monitoringAt ?? null,
        record.resolvedAt ?? null,
        record.resolvedBy ?? null,
        record.closedAt ?? null,
        record.closedBy ?? null,
      ],
    );
  }

  private async persistTimeline(entry: IncidentTimelineEntry): Promise<void> {
    if (!this.mysql) {
      return;
    }

    await this.mysql.execute(
      `
        INSERT INTO incident_timeline (
          entry_id, incident_id, type, actor, created_at, message, metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          incident_id = VALUES(incident_id),
          type = VALUES(type),
          actor = VALUES(actor),
          created_at = VALUES(created_at),
          message = VALUES(message),
          metadata = VALUES(metadata)
      `,
      [
        entry.entryId,
        entry.incidentId,
        entry.type,
        entry.actor,
        entry.createdAt,
        entry.message ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ],
    );
  }
}
