import { randomUUID } from 'node:crypto';
import { Pool as PgPool } from 'pg';
import { createPool as createMySqlPool } from 'mysql2/promise';
import { MYSQL_SCHEMA_SQL } from '../modules/persistence/mysql-schema.js';

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

type DeviceMetadataRow = {
  device_id: string;
  uuid: string | null;
  name: string | null;
  site: string | null;
  zone: string | null;
  firmware_version: string | null;
  sensor_version: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type AlertRuleRow = {
  rule_id: string;
  name: string;
  metric: string;
  threshold: number;
  severity: string;
  debounce_count: number;
  cooldown_ms: number;
  suppression_window_ms: number | null;
  flapping_window_ms: number | null;
  flapping_threshold: number | null;
  enabled: boolean | number;
  time_window_start_hour: number | null;
  time_window_end_hour: number | null;
  time_window_timezone: string | null;
  created_at: string;
  updated_at: string;
};

type AlertRow = {
  alert_id: string;
  rule_id: string;
  rule_name: string;
  device_id: string;
  metric: string;
  severity: string;
  threshold: number;
  trigger_value: number;
  last_value: number;
  occurrence_count: number;
  suppressed_count: number;
  noise_state: string;
  last_suppressed_at: string | null;
  status: string;
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledged_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  updated_at: string;
};

type AuditRow = {
  audit_id: string;
  action: string;
  device_id: string;
  command_id: string;
  actor: string;
  created_at: string;
  result: string;
  metadata: unknown;
};

type IncidentRow = {
  incident_id: string;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  owner: string | null;
  site: string | null;
  device_id: string | null;
  alert_ids: unknown;
  primary_alert_id: string | null;
  created_at: string;
  updated_at: string;
  opened_at: string;
  assigned_at: string | null;
  assigned_by: string | null;
  monitoring_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
};

type IncidentTimelineRow = {
  entry_id: string;
  incident_id: string;
  type: string;
  actor: string;
  created_at: string;
  message: string | null;
  metadata: unknown;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function toJsonString(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const postgresUrl = requireEnv('POSTGRES_SOURCE_URL');
  const mysqlUrl = process.env.MYSQL_URL?.trim() || requireEnv('MYSQL_TARGET_URL');

  const pg = new PgPool({ connectionString: postgresUrl });
  const mysql: any = createMySqlPool({
    uri: mysqlUrl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true,
    dateStrings: true,
    decimalNumbers: true,
  });

  try {
    await mysql.query(MYSQL_SCHEMA_SQL);

    const summary: Record<string, number> = {};

    const deviceMetadata = await pg.query<DeviceMetadataRow>(
      `SELECT device_id, uuid, name, site, zone, firmware_version, sensor_version, notes, created_at, updated_at
       FROM device_metadata`,
    );

    for (const row of deviceMetadata.rows) {
      await mysql.execute(
        `INSERT INTO devices (
           device_id, uuid, name, site, zone, firmware_version, sensor_version, notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           uuid = VALUES(uuid),
           name = VALUES(name),
           site = VALUES(site),
           zone = VALUES(zone),
           firmware_version = VALUES(firmware_version),
           sensor_version = VALUES(sensor_version),
           notes = VALUES(notes),
           created_at = VALUES(created_at),
           updated_at = VALUES(updated_at)`,
        [
          row.device_id,
          row.uuid ?? randomUUID(),
          row.name,
          row.site,
          row.zone,
          row.firmware_version,
          row.sensor_version,
          row.notes,
          row.created_at,
          row.updated_at,
        ],
      );
    }
    summary.devices = deviceMetadata.rowCount ?? 0;

    const alertRules = await pg.query<AlertRuleRow>(
      `SELECT rule_id, name, metric, threshold, severity, debounce_count, cooldown_ms, suppression_window_ms,
              flapping_window_ms, flapping_threshold, enabled, time_window_start_hour, time_window_end_hour,
              time_window_timezone, created_at, updated_at
       FROM alert_rules`,
    );

    for (const row of alertRules.rows) {
      await mysql.execute(
        `INSERT INTO alert_rules (
           rule_id, name, metric, threshold, severity, debounce_count, cooldown_ms, suppression_window_ms,
           flapping_window_ms, flapping_threshold, enabled, time_window_start_hour, time_window_end_hour,
           time_window_timezone, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           metric = VALUES(metric),
           threshold = VALUES(threshold),
           severity = VALUES(severity),
           debounce_count = VALUES(debounce_count),
           cooldown_ms = VALUES(cooldown_ms),
           suppression_window_ms = VALUES(suppression_window_ms),
           flapping_window_ms = VALUES(flapping_window_ms),
           flapping_threshold = VALUES(flapping_threshold),
           enabled = VALUES(enabled),
           time_window_start_hour = VALUES(time_window_start_hour),
           time_window_end_hour = VALUES(time_window_end_hour),
           time_window_timezone = VALUES(time_window_timezone),
           created_at = VALUES(created_at),
           updated_at = VALUES(updated_at)`,
        [
          row.rule_id,
          row.name,
          row.metric,
          row.threshold,
          row.severity,
          row.debounce_count,
          row.cooldown_ms,
          row.suppression_window_ms,
          row.flapping_window_ms,
          row.flapping_threshold,
          row.enabled,
          row.time_window_start_hour,
          row.time_window_end_hour,
          row.time_window_timezone,
          row.created_at,
          row.updated_at,
        ],
      );
    }
    summary.alert_rules = alertRules.rowCount ?? 0;

    const alerts = await pg.query<AlertRow>(
      `SELECT alert_id, rule_id, rule_name, device_id, metric, severity, threshold, trigger_value, last_value,
              occurrence_count, suppressed_count, noise_state, last_suppressed_at, status, triggered_at,
              acknowledged_at, acknowledged_by, acknowledged_note,
              resolved_at, resolved_by, resolution_note, updated_at
       FROM alerts`,
    );

    for (const row of alerts.rows) {
      await mysql.execute(
        `INSERT INTO alerts (
           alert_id, rule_id, rule_name, device_id, metric, severity, threshold, trigger_value, last_reading_value,
           occurrence_count, suppressed_count, noise_state, last_suppressed_at, status, triggered_at,
           acknowledged_at, acknowledged_by, acknowledged_note,
           resolved_at, resolved_by, resolution_note, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           rule_id = VALUES(rule_id),
           rule_name = VALUES(rule_name),
           device_id = VALUES(device_id),
           metric = VALUES(metric),
           severity = VALUES(severity),
           threshold = VALUES(threshold),
           trigger_value = VALUES(trigger_value),
           last_reading_value = VALUES(last_reading_value),
           occurrence_count = VALUES(occurrence_count),
           suppressed_count = VALUES(suppressed_count),
           noise_state = VALUES(noise_state),
           last_suppressed_at = VALUES(last_suppressed_at),
           status = VALUES(status),
           triggered_at = VALUES(triggered_at),
           acknowledged_at = VALUES(acknowledged_at),
           acknowledged_by = VALUES(acknowledged_by),
           acknowledged_note = VALUES(acknowledged_note),
           resolved_at = VALUES(resolved_at),
           resolved_by = VALUES(resolved_by),
           resolution_note = VALUES(resolution_note),
           updated_at = VALUES(updated_at)`,
        [
          row.alert_id,
          row.rule_id,
          row.rule_name,
          row.device_id,
          row.metric,
          row.severity,
          row.threshold,
          row.trigger_value,
          row.last_value,
          row.occurrence_count,
          row.suppressed_count,
          row.noise_state,
          row.last_suppressed_at,
          row.status,
          row.triggered_at,
          row.acknowledged_at,
          row.acknowledged_by,
          row.acknowledged_note,
          row.resolved_at,
          row.resolved_by,
          row.resolution_note,
          row.updated_at,
        ],
      );
    }
    summary.alerts = alerts.rowCount ?? 0;

    const audits = await pg.query<AuditRow>(
      `SELECT audit_id, action, device_id, command_id, actor, created_at, result, metadata
       FROM audit_logs`,
    );

    for (const row of audits.rows) {
      await mysql.execute(
        `INSERT INTO audit_logs (audit_id, action, device_id, command_id, actor, created_at, result, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           action = VALUES(action),
           device_id = VALUES(device_id),
           command_id = VALUES(command_id),
           actor = VALUES(actor),
           created_at = VALUES(created_at),
           result = VALUES(result),
           metadata = VALUES(metadata)`,
        [
          row.audit_id,
          row.action,
          row.device_id,
          row.command_id,
          row.actor,
          row.created_at,
          row.result,
          toJsonString(row.metadata as JsonValue),
        ],
      );
    }
    summary.audit_logs = audits.rowCount ?? 0;

    const incidents = await pg.query<IncidentRow>(
      `SELECT incident_id, title, summary, severity, status, owner, site, device_id, alert_ids, primary_alert_id,
              created_at, updated_at, opened_at, assigned_at, assigned_by, monitoring_at,
              resolved_at, resolved_by, closed_at, closed_by
       FROM incidents`,
    );

    for (const row of incidents.rows) {
      await mysql.execute(
        `INSERT INTO incidents (
           incident_id, title, summary, severity, status, owner, site, device_id, alert_ids, primary_alert_id,
           created_at, updated_at, opened_at, assigned_at, assigned_by, monitoring_at,
           resolved_at, resolved_by, closed_at, closed_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           closed_by = VALUES(closed_by)`,
        [
          row.incident_id,
          row.title,
          row.summary,
          row.severity,
          row.status,
          row.owner,
          row.site,
          row.device_id,
          toJsonString(row.alert_ids as JsonValue) ?? '[]',
          row.primary_alert_id,
          row.created_at,
          row.updated_at,
          row.opened_at,
          row.assigned_at,
          row.assigned_by,
          row.monitoring_at,
          row.resolved_at,
          row.resolved_by,
          row.closed_at,
          row.closed_by,
        ],
      );
    }
    summary.incidents = incidents.rowCount ?? 0;

    const incidentTimeline = await pg.query<IncidentTimelineRow>(
      `SELECT entry_id, incident_id, type, actor, created_at, message, metadata
       FROM incident_timeline`,
    );

    for (const row of incidentTimeline.rows) {
      await mysql.execute(
        `INSERT INTO incident_timeline (entry_id, incident_id, type, actor, created_at, message, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           incident_id = VALUES(incident_id),
           type = VALUES(type),
           actor = VALUES(actor),
           created_at = VALUES(created_at),
           message = VALUES(message),
           metadata = VALUES(metadata)`,
        [
          row.entry_id,
          row.incident_id,
          row.type,
          row.actor,
          row.created_at,
          row.message,
          toJsonString(row.metadata as JsonValue),
        ],
      );
    }
    summary.incident_timeline = incidentTimeline.rowCount ?? 0;

    console.log('[migrate:pg-to-mysql] completed:', summary);
  } finally {
    await pg.end();
    await mysql.end();
  }
}

void main().catch((error) => {
  console.error('[migrate:pg-to-mysql] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
