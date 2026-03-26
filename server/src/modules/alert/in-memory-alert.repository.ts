import type { AlertRecord, AlertRule, AlertStatus, AlertTimeWindow } from '../../shared/types.js';
import type { AlertRepository, AlertSummary } from './alert.repository.js';
import type { PostgresAccess } from '../persistence/postgres-access.js';
import { getSharedPostgresAccess } from '../persistence/postgres-access.js';

type AlertRuleRow = {
  rule_id: string;
  name: string;
  metric: 'temperature' | 'vibration';
  threshold: number | string;
  severity: 'warning' | 'critical';
  debounce_count: number | string;
  cooldown_ms: number | string;
  suppression_window_ms: number | string | null;
  flapping_window_ms: number | string | null;
  flapping_threshold: number | string | null;
  enabled: boolean;
  time_window_start_hour: number | string | null;
  time_window_end_hour: number | string | null;
  time_window_timezone: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type AlertRecordRow = {
  alert_id: string;
  rule_id: string;
  rule_name: string;
  device_id: string;
  metric: 'temperature' | 'vibration';
  severity: 'warning' | 'critical';
  threshold: number | string;
  trigger_value: number | string;
  last_value: number | string;
  occurrence_count: number | string | null;
  suppressed_count: number | string | null;
  noise_state: 'normal' | 'coalesced' | 'suppressed' | 'flapping' | null;
  last_suppressed_at: string | Date | null;
  status: AlertStatus;
  triggered_at: string | Date;
  acknowledged_at: string | Date | null;
  acknowledged_by: string | null;
  acknowledged_note: string | null;
  resolved_at: string | Date | null;
  resolved_by: string | null;
  resolution_note: string | null;
  updated_at: string | Date;
};

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNullableIsoTimestamp(value: string | Date | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return toIsoTimestamp(value);
}

function normalizeTimeWindowRow(row: AlertRuleRow): AlertTimeWindow | undefined {
  if (row.time_window_start_hour === null || row.time_window_end_hour === null) {
    return undefined;
  }

  return {
    startHour: Number(row.time_window_start_hour),
    endHour: Number(row.time_window_end_hour),
    timezone: row.time_window_timezone ?? undefined,
  };
}

export class InMemoryAlertRepository implements AlertRepository {
  private readonly rules = new Map<string, AlertRule>();

  private readonly alerts = new Map<string, AlertRecord>();

  private readonly alertOrder: string[] = [];

  private readonly activeByRuleAndDevice = new Map<string, string>();
  private readonly postgres: PostgresAccess | null;

  private constructor(postgres: PostgresAccess | null = getSharedPostgresAccess()) {
    this.postgres = postgres;
  }

  static async create(postgres: PostgresAccess | null = getSharedPostgresAccess()): Promise<InMemoryAlertRepository> {
    const repository = new InMemoryAlertRepository(postgres);
    await repository.ensurePersistenceShape();
    await repository.loadFromPersistence();
    return repository;
  }

  listRules(): AlertRule[] {
    return Array.from(this.rules.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getRule(ruleId: string): AlertRule | null {
    return this.rules.get(ruleId) || null;
  }

  saveRule(rule: AlertRule): void {
    this.rules.set(rule.ruleId, rule);
    void this.persistRule(rule);
  }

  listAlerts(limit = 100, status: AlertStatus | 'all' = 'all'): AlertRecord[] {
    const records = this.alertOrder
      .map((alertId) => this.alerts.get(alertId))
      .filter((record): record is AlertRecord => Boolean(record))
      .filter((record) => status === 'all' || record.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return records.slice(0, limit);
  }

  summarizeAlerts(): AlertSummary {
    const records = this.listAlerts(Number.MAX_SAFE_INTEGER, 'all');
    const byNoiseState: AlertSummary['byNoiseState'] = {
      normal: 0,
      coalesced: 0,
      suppressed: 0,
      flapping: 0,
    };
    const byRule = new Map<string, number>();
    const byDevice = new Map<string, number>();
    let active = 0;
    let acknowledged = 0;
    let resolved = 0;
    let coalescedSignals = 0;
    let suppressedSignals = 0;
    let flappingSignals = 0;

    for (const record of records) {
      if (record.status === 'active') {
        active += 1;
      } else if (record.status === 'acknowledged') {
        acknowledged += 1;
      } else {
        resolved += 1;
      }

      byNoiseState[record.noiseState] += 1;

      const recordCoalesced = Math.max(0, (record.occurrenceCount || 1) - 1);
      const recordSuppressed = Math.max(0, record.suppressedCount || 0);
      const noiseWeight = recordCoalesced + recordSuppressed;

      coalescedSignals += recordCoalesced;
      suppressedSignals += recordSuppressed;
      if (record.noiseState === 'flapping') {
        flappingSignals += Math.max(1, noiseWeight);
      }

      if (noiseWeight > 0) {
        byRule.set(record.ruleId, (byRule.get(record.ruleId) ?? 0) + noiseWeight);
        byDevice.set(record.deviceId, (byDevice.get(record.deviceId) ?? 0) + noiseWeight);
      }
    }

    return {
      total: records.length,
      active,
      acknowledged,
      resolved,
      byNoiseState,
      coalescedSignals,
      suppressedSignals,
      flappingSignals,
      topNoisyRules: this.toTopCounts(byRule),
      topNoisyDevices: this.toTopCounts(byDevice),
    };
  }

  getAlert(alertId: string): AlertRecord | null {
    return this.alerts.get(alertId) || null;
  }

  getActiveAlert(ruleId: string, deviceId: string): AlertRecord | null {
    const alertId = this.activeByRuleAndDevice.get(this.createActiveKey(ruleId, deviceId));
    if (!alertId) {
      return null;
    }

    return this.alerts.get(alertId) || null;
  }

  getLatestAlert(ruleId: string, deviceId: string): AlertRecord | null {
    const active = this.getActiveAlert(ruleId, deviceId);
    if (active) {
      return active;
    }

    for (let index = this.alertOrder.length - 1; index >= 0; index -= 1) {
      const candidate = this.alerts.get(this.alertOrder[index]);
      if (candidate && candidate.ruleId === ruleId && candidate.deviceId === deviceId) {
        return candidate;
      }
    }

    return null;
  }

  saveAlert(record: AlertRecord): void {
    this.alerts.set(record.alertId, record);
    this.alertOrder.push(record.alertId);
    if (record.status !== 'resolved') {
      this.activeByRuleAndDevice.set(this.createActiveKey(record.ruleId, record.deviceId), record.alertId);
    }
    this.persistAlert(record);
  }

  updateAlert(record: AlertRecord): void {
    const existing = this.alerts.get(record.alertId) || null;
    this.alerts.set(record.alertId, record);
    const activeKey = this.createActiveKey(record.ruleId, record.deviceId);
    if (record.status !== 'resolved') {
      this.activeByRuleAndDevice.set(activeKey, record.alertId);
      const shouldPersist =
        !existing ||
        existing.status !== record.status ||
        existing.occurrenceCount !== record.occurrenceCount ||
        existing.suppressedCount !== record.suppressedCount ||
        existing.noiseState !== record.noiseState ||
        existing.lastSuppressedAt !== record.lastSuppressedAt;
      if (shouldPersist) {
        this.persistAlert(record);
      }
      return;
    }

    this.activeByRuleAndDevice.delete(activeKey);
    this.persistAlert(record);
  }

  countActiveAlerts(): number {
    return this.activeByRuleAndDevice.size;
  }

  private createActiveKey(ruleId: string, deviceId: string): string {
    return `${ruleId}:${deviceId}`;
  }

  private persistAlert(record: AlertRecord): void {
    void this.writeAlert(record);
  }

  private async persistRule(rule: AlertRule): Promise<void> {
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(
      `
        INSERT INTO alert_rules (
          rule_id, name, metric, threshold, severity, debounce_count, cooldown_ms, enabled,
          suppression_window_ms, flapping_window_ms, flapping_threshold,
          time_window_start_hour, time_window_end_hour, time_window_timezone, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11,
          $12, $13, $14,
          $15::timestamptz, $16::timestamptz
        )
        ON CONFLICT (rule_id) DO UPDATE SET
          name = EXCLUDED.name,
          metric = EXCLUDED.metric,
          threshold = EXCLUDED.threshold,
          severity = EXCLUDED.severity,
          debounce_count = EXCLUDED.debounce_count,
          cooldown_ms = EXCLUDED.cooldown_ms,
          enabled = EXCLUDED.enabled,
          suppression_window_ms = EXCLUDED.suppression_window_ms,
          flapping_window_ms = EXCLUDED.flapping_window_ms,
          flapping_threshold = EXCLUDED.flapping_threshold,
          time_window_start_hour = EXCLUDED.time_window_start_hour,
          time_window_end_hour = EXCLUDED.time_window_end_hour,
          time_window_timezone = EXCLUDED.time_window_timezone,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        rule.ruleId,
        rule.name,
        rule.metric,
        rule.threshold,
        rule.severity,
        rule.debounceCount,
        rule.cooldownMs,
        rule.enabled,
        rule.suppressionWindowMs,
        rule.flappingWindowMs,
        rule.flappingThreshold,
        rule.timeWindow?.startHour ?? null,
        rule.timeWindow?.endHour ?? null,
        rule.timeWindow?.timezone ?? null,
        rule.createdAt,
        rule.updatedAt,
      ],
    );
  }

  private async writeAlert(record: AlertRecord): Promise<void> {
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(
      `
        INSERT INTO alerts (
          alert_id, rule_id, rule_name, device_id, metric, severity, threshold,
          trigger_value, last_value, occurrence_count, suppressed_count, noise_state, last_suppressed_at, status, triggered_at,
          acknowledged_at, acknowledged_by, acknowledged_note,
          resolved_at, resolved_by, resolution_note,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14, $15::timestamptz,
          $16::timestamptz, $17, $18,
          $19::timestamptz, $20, $21,
          $22::timestamptz
        )
        ON CONFLICT (alert_id) DO UPDATE SET
          rule_id = EXCLUDED.rule_id,
          rule_name = EXCLUDED.rule_name,
          device_id = EXCLUDED.device_id,
          metric = EXCLUDED.metric,
          severity = EXCLUDED.severity,
          threshold = EXCLUDED.threshold,
          trigger_value = EXCLUDED.trigger_value,
          last_value = EXCLUDED.last_value,
          occurrence_count = EXCLUDED.occurrence_count,
          suppressed_count = EXCLUDED.suppressed_count,
          noise_state = EXCLUDED.noise_state,
          last_suppressed_at = EXCLUDED.last_suppressed_at,
          status = EXCLUDED.status,
          triggered_at = EXCLUDED.triggered_at,
          acknowledged_at = EXCLUDED.acknowledged_at,
          acknowledged_by = EXCLUDED.acknowledged_by,
          acknowledged_note = EXCLUDED.acknowledged_note,
          resolved_at = EXCLUDED.resolved_at,
          resolved_by = EXCLUDED.resolved_by,
          resolution_note = EXCLUDED.resolution_note,
          updated_at = EXCLUDED.updated_at
      `,
      [
        record.alertId,
        record.ruleId,
        record.ruleName,
        record.deviceId,
        record.metric,
        record.severity,
        record.threshold,
        record.triggerValue,
        record.lastValue,
        record.occurrenceCount,
        record.suppressedCount,
        record.noiseState,
        record.lastSuppressedAt ?? null,
        record.status,
        record.triggeredAt,
        record.acknowledgedAt ?? null,
        record.acknowledgedBy ?? null,
        record.acknowledgedNote ?? null,
        record.resolvedAt ?? null,
        record.resolvedBy ?? null,
        record.resolutionNote ?? null,
        record.updatedAt,
      ],
    );
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.postgres) {
      return;
    }

    const rules = await this.postgres.query<AlertRuleRow>(
      `
        SELECT
          rule_id, name, metric, threshold, severity, debounce_count, cooldown_ms, enabled,
          suppression_window_ms, flapping_window_ms, flapping_threshold,
          time_window_start_hour, time_window_end_hour, time_window_timezone,
          created_at, updated_at
        FROM alert_rules
        ORDER BY name ASC
      `,
    );
    for (const row of rules) {
      this.rules.set(row.rule_id, {
        ruleId: row.rule_id,
        name: row.name,
        metric: row.metric,
        threshold: Number(row.threshold),
        severity: row.severity,
        debounceCount: Number(row.debounce_count),
        cooldownMs: Number(row.cooldown_ms),
        suppressionWindowMs: Number(row.suppression_window_ms ?? row.cooldown_ms ?? 45_000),
        flappingWindowMs: Number(row.flapping_window_ms ?? 180_000),
        flappingThreshold: Number(row.flapping_threshold ?? 3),
        enabled: row.enabled,
        timeWindow: normalizeTimeWindowRow(row),
        createdAt: toIsoTimestamp(row.created_at),
        updatedAt: toIsoTimestamp(row.updated_at),
      });
    }

    const alerts = await this.postgres.query<AlertRecordRow>(
      `
        SELECT
          alert_id, rule_id, rule_name, device_id, metric, severity, threshold,
          trigger_value, last_value, occurrence_count, suppressed_count, noise_state, last_suppressed_at, status, triggered_at,
          acknowledged_at, acknowledged_by, acknowledged_note,
          resolved_at, resolved_by, resolution_note,
          updated_at
        FROM alerts
        ORDER BY triggered_at ASC
      `,
    );
    for (const row of alerts) {
      const record: AlertRecord = {
        alertId: row.alert_id,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        deviceId: row.device_id,
        metric: row.metric,
        severity: row.severity,
        threshold: Number(row.threshold),
        triggerValue: Number(row.trigger_value),
        lastValue: Number(row.last_value),
        occurrenceCount: Number(row.occurrence_count ?? 1),
        suppressedCount: Number(row.suppressed_count ?? 0),
        noiseState: row.noise_state ?? 'normal',
        lastSuppressedAt: toNullableIsoTimestamp(row.last_suppressed_at),
        status: row.status,
        triggeredAt: toIsoTimestamp(row.triggered_at),
        acknowledgedAt: toNullableIsoTimestamp(row.acknowledged_at),
        acknowledgedBy: row.acknowledged_by ?? undefined,
        acknowledgedNote: row.acknowledged_note ?? undefined,
        resolvedAt: row.resolved_at ? toIsoTimestamp(row.resolved_at) : undefined,
        resolvedBy: row.resolved_by ?? undefined,
        resolutionNote: row.resolution_note ?? undefined,
        updatedAt: toIsoTimestamp(row.updated_at),
      };
      this.alerts.set(record.alertId, record);
      this.alertOrder.push(record.alertId);
      if (record.status !== 'resolved') {
        this.activeByRuleAndDevice.set(this.createActiveKey(record.ruleId, record.deviceId), record.alertId);
      }
    }
  }

  private async ensurePersistenceShape(): Promise<void> {
    if (!this.postgres) {
      return;
    }

    await this.postgres.execute(
      `
        ALTER TABLE alert_rules
          ADD COLUMN IF NOT EXISTS time_window_start_hour INTEGER,
          ADD COLUMN IF NOT EXISTS time_window_end_hour INTEGER,
          ADD COLUMN IF NOT EXISTS time_window_timezone TEXT,
          ADD COLUMN IF NOT EXISTS suppression_window_ms INTEGER,
          ADD COLUMN IF NOT EXISTS flapping_window_ms INTEGER,
          ADD COLUMN IF NOT EXISTS flapping_threshold INTEGER;

        UPDATE alert_rules
        SET
          suppression_window_ms = COALESCE(suppression_window_ms, GREATEST(cooldown_ms, 45000)),
          flapping_window_ms = COALESCE(flapping_window_ms, 180000),
          flapping_threshold = COALESCE(flapping_threshold, 3)
        WHERE suppression_window_ms IS NULL
          OR flapping_window_ms IS NULL
          OR flapping_threshold IS NULL;

        ALTER TABLE alerts
          ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS acknowledged_by TEXT,
          ADD COLUMN IF NOT EXISTS acknowledged_note TEXT,
          ADD COLUMN IF NOT EXISTS resolved_by TEXT,
          ADD COLUMN IF NOT EXISTS resolution_note TEXT,
          ADD COLUMN IF NOT EXISTS occurrence_count INTEGER,
          ADD COLUMN IF NOT EXISTS suppressed_count INTEGER,
          ADD COLUMN IF NOT EXISTS noise_state TEXT,
          ADD COLUMN IF NOT EXISTS last_suppressed_at TIMESTAMPTZ;

        UPDATE alerts
        SET
          occurrence_count = COALESCE(occurrence_count, 1),
          suppressed_count = COALESCE(suppressed_count, 0),
          noise_state = COALESCE(noise_state, 'normal')
        WHERE occurrence_count IS NULL
          OR suppressed_count IS NULL
          OR noise_state IS NULL;

        CREATE INDEX IF NOT EXISTS idx_alerts_status_updated_at ON alerts (status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_alerts_rule_device_status ON alerts (rule_id, device_id, status);
      `,
    );
  }

  private toTopCounts(source: Map<string, number>): Array<{ key: string; count: number }> {
    return Array.from(source.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([key, count]) => ({ key, count }));
  }
}
