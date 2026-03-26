import type {
  AlertSeverity,
  IncidentRecord,
  IncidentStatus,
  IncidentTimelineEntry,
} from '../../shared/types.js';

export type IncidentQueryFilters = {
  status?: IncidentStatus;
  owner?: string;
  severity?: AlertSeverity;
  site?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type IncidentSummary = {
  total: number;
  byStatus: Record<IncidentStatus, number>;
  bySeverity: Record<AlertSeverity, number>;
  topSites: Array<{ key: string; count: number }>;
  topOwners: Array<{ key: string; count: number }>;
  range: {
    from?: string;
    to?: string;
  };
};

export interface IncidentRepository {
  list(filters?: IncidentQueryFilters): IncidentRecord[];
  summarize(filters?: IncidentQueryFilters): IncidentSummary;
  get(incidentId: string): IncidentRecord | null;
  save(record: IncidentRecord): void;
  update(record: IncidentRecord): void;
  addTimeline(entry: IncidentTimelineEntry): void;
  listTimeline(incidentId: string, limit?: number): IncidentTimelineEntry[];
}
