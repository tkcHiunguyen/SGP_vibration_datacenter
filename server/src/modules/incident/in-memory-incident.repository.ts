import type {
  AlertSeverity,
  IncidentEventType,
  IncidentRecord,
  IncidentStatus,
  IncidentTimelineEntry,
} from '../../shared/types.js';
import type { PostgresAccess } from '../persistence/postgres-access.js';
import { getSharedPostgresAccess } from '../persistence/postgres-access.js';
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
  alert_ids: string[] | null;
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
  metadata: Record<string, unknown> | null;
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
  private readonly postgres: PostgresAccess | null;

  private constructor(postgres: PostgresAccess | null = getSharedPostgresAccess()) {
    this.postgres = postgres;
  }

  static async create(postgres: PostgresAccess | null = getSharedPostgresAccess()): Promise<InMemoryIncidentRepository> {
    const repository = new InMemoryIncidentRepository(postgres);
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
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(`
      CREATE TABLE IF NOT EXISTS incidents (
        incident_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        owner TEXT,
        site TEXT,
        device_id TEXT,
        alert_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        primary_alert_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        opened_at TIMESTAMPTZ NOT NULL,
        assigned_at TIMESTAMPTZ,
        assigned_by TEXT,
        monitoring_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT,
        closed_at TIMESTAMPTZ,
        closed_by TEXT
      );

      CREATE TABLE IF NOT EXISTS incident_timeline (
        entry_id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        message TEXT,
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_incidents_status_updated_at ON incidents (status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incidents_owner_updated_at ON incidents (owner, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incidents_site_updated_at ON incidents (site, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident_created_at ON incident_timeline (incident_id, created_at ASC);
    `);
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.postgres) {
      return;
    }

    const incidents = await this.postgres.query<IncidentRow>(`
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
        alertIds: row.alert_ids ?? [],
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

    const timeline = await this.postgres.query<IncidentTimelineRow>(`
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
        metadata: row.metadata ?? undefined,
      };
      const entries = this.timelineByIncident.get(entry.incidentId) ?? [];
      entries.push(entry);
      this.timelineByIncident.set(entry.incidentId, entries);
    }
  }

  private async persistIncident(record: IncidentRecord): Promise<void> {
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(
      `
        INSERT INTO incidents (
          incident_id, title, summary, severity, status, owner, site, device_id, alert_ids, primary_alert_id,
          created_at, updated_at, opened_at, assigned_at, assigned_by, monitoring_at,
          resolved_at, resolved_by, closed_at, closed_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
          $11::timestamptz, $12::timestamptz, $13::timestamptz, $14::timestamptz, $15, $16::timestamptz,
          $17::timestamptz, $18, $19::timestamptz, $20
        )
        ON CONFLICT (incident_id) DO UPDATE SET
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          severity = EXCLUDED.severity,
          status = EXCLUDED.status,
          owner = EXCLUDED.owner,
          site = EXCLUDED.site,
          device_id = EXCLUDED.device_id,
          alert_ids = EXCLUDED.alert_ids,
          primary_alert_id = EXCLUDED.primary_alert_id,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          opened_at = EXCLUDED.opened_at,
          assigned_at = EXCLUDED.assigned_at,
          assigned_by = EXCLUDED.assigned_by,
          monitoring_at = EXCLUDED.monitoring_at,
          resolved_at = EXCLUDED.resolved_at,
          resolved_by = EXCLUDED.resolved_by,
          closed_at = EXCLUDED.closed_at,
          closed_by = EXCLUDED.closed_by
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
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(
      `
        INSERT INTO incident_timeline (
          entry_id, incident_id, type, actor, created_at, message, metadata
        )
        VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7::jsonb)
        ON CONFLICT (entry_id) DO UPDATE SET
          incident_id = EXCLUDED.incident_id,
          type = EXCLUDED.type,
          actor = EXCLUDED.actor,
          created_at = EXCLUDED.created_at,
          message = EXCLUDED.message,
          metadata = EXCLUDED.metadata
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
