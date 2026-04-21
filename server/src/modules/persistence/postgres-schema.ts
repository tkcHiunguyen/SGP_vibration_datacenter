export const POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS device_metadata (
  device_id TEXT PRIMARY KEY,
  uuid TEXT,
  name TEXT,
  site TEXT,
  zone TEXT,
  firmware_version TEXT,
  sensor_version TEXT,
  notes TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS device_sessions (
  device_id TEXT PRIMARY KEY,
  socket_id TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  socket_connected BOOLEAN,
  sta_connected BOOLEAN,
  signal INTEGER,
  uptime_sec INTEGER
);

ALTER TABLE IF EXISTS device_metadata ADD COLUMN IF NOT EXISTS uuid TEXT;
ALTER TABLE IF EXISTS device_metadata ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS device_sessions ADD COLUMN IF NOT EXISTS socket_connected BOOLEAN;
ALTER TABLE IF EXISTS device_sessions ADD COLUMN IF NOT EXISTS sta_connected BOOLEAN;
ALTER TABLE IF EXISTS device_sessions ADD COLUMN IF NOT EXISTS signal INTEGER;
ALTER TABLE IF EXISTS device_sessions ADD COLUMN IF NOT EXISTS uptime_sec INTEGER;

CREATE TABLE IF NOT EXISTS alert_rules (
  rule_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  metric TEXT NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  severity TEXT NOT NULL,
  debounce_count INTEGER NOT NULL,
  cooldown_ms INTEGER NOT NULL,
  suppression_window_ms INTEGER NOT NULL,
  flapping_window_ms INTEGER NOT NULL,
  flapping_threshold INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL,
  time_window_start_hour INTEGER,
  time_window_end_hour INTEGER,
  time_window_timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  device_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  severity TEXT NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  trigger_value DOUBLE PRECISION NOT NULL,
  last_value DOUBLE PRECISION NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  noise_state TEXT NOT NULL DEFAULT 'normal',
  last_suppressed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  acknowledged_note TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  device_id TEXT,
  command_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  result TEXT NOT NULL,
  metadata JSONB
);

ALTER TABLE IF EXISTS audit_logs ALTER COLUMN device_id DROP NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_device_metadata_site ON device_metadata (site);
CREATE INDEX IF NOT EXISTS idx_device_metadata_zone ON device_metadata (zone);
CREATE INDEX IF NOT EXISTS idx_device_metadata_archived_at ON device_metadata (archived_at);
CREATE INDEX IF NOT EXISTS idx_device_sessions_connected_at ON device_sessions (connected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_rules_metric_enabled ON alert_rules (metric, enabled);
CREATE INDEX IF NOT EXISTS idx_alerts_status_updated_at ON alerts (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_rule_device_status ON alerts (rule_id, device_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_status_updated_at ON incidents (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_owner_updated_at ON incidents (owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_site_updated_at ON incidents (site, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident_created_at ON incident_timeline (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at ON audit_logs (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_device_created_at ON audit_logs (device_id, created_at DESC);
`;
