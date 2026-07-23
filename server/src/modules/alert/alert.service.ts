import type {
  AlertMetric,
  AlertRecord,
  AlertRule,
  AlertSeverity,
  AlertStatus,
  AlertTimeWindow,
  TelemetryMessage,
  TelemetryPayload,
} from '../../shared/types.js';
import type { AlertRepository } from './alert.repository.js';

type UpsertAlertRuleInput = {
  name: string;
  metric: AlertMetric;
  threshold: number;
  severity: AlertSeverity;
  debounceCount?: number;
  cooldownMs?: number;
  suppressionWindowMs?: number;
  flappingWindowMs?: number;
  flappingThreshold?: number;
  enabled?: boolean;
  timeWindow?: AlertTimeWindow | null;
};

type RuleEvaluationState = {
  consecutiveAbove: number;
  lastTriggeredAt?: string;
  lastResolvedAt?: string;
  recentTriggeredAt: string[];
};

export const DEVICE_ACCELERATION_RULE_ID = 'device-acceleration-setpoint';
export const DEVICE_VIBRATION_RULE_ID = 'device-vibration-setpoint';
export const DEVICE_DISPLACEMENT_RULE_ID = 'device-displacement-setpoint';
export const DEVICE_TEMPERATURE_RULE_ID = 'device-temperature-setpoint';
export const DEFAULT_VIBRATION_SETPOINT = 10;

export type DeviceMetricSetpoints = {
  acceleration: number;
  velocity: number;
  displacement: number;
  temperature: number;
};

type MetricDefinition = {
  ruleId: string;
  name: string;
  metric: Exclude<AlertMetric, 'vibration'>;
  setpoint: keyof DeviceMetricSetpoints;
  read: (payload: TelemetryPayload) => number | undefined;
};

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function maxAbs(...values: unknown[]): number | undefined {
  const numbers = values.map(finite).filter((value): value is number => value !== undefined);
  return numbers.length > 0 ? Math.max(...numbers.map(Math.abs)) : undefined;
}

const METRICS: MetricDefinition[] = [
  {
    ruleId: DEVICE_ACCELERATION_RULE_ID,
    name: 'Device Acceleration Setpoint',
    metric: 'acceleration',
    setpoint: 'acceleration',
    read: (payload) => maxAbs(payload.ax, payload.ay, payload.az),
  },
  {
    ruleId: DEVICE_VIBRATION_RULE_ID,
    name: 'Device Velocity Setpoint',
    metric: 'velocity',
    setpoint: 'velocity',
    read: (payload) => maxAbs(
      payload.vrms_x_mms ?? payload.vx_rms_mms,
      payload.vrms_y_mms ?? payload.vy_rms_mms,
      payload.vrms_z_mms ?? payload.vz_rms_mms,
    ) ?? finite(payload.vibration),
  },
  {
    ruleId: DEVICE_DISPLACEMENT_RULE_ID,
    name: 'Device Displacement Setpoint',
    metric: 'displacement',
    setpoint: 'displacement',
    read: (payload) => {
      const micrometers = maxAbs(payload.drms_x_um, payload.drms_y_um, payload.drms_z_um);
      return micrometers === undefined ? undefined : micrometers / 1000;
    },
  },
  {
    ruleId: DEVICE_TEMPERATURE_RULE_ID,
    name: 'Device Temperature Setpoint',
    metric: 'temperature',
    setpoint: 'temperature',
    read: (payload) => finite(payload.temperature),
  },
];

const DEFAULT_SETPOINTS: DeviceMetricSetpoints = {
  acceleration: DEFAULT_VIBRATION_SETPOINT,
  velocity: DEFAULT_VIBRATION_SETPOINT,
  displacement: DEFAULT_VIBRATION_SETPOINT,
  temperature: DEFAULT_VIBRATION_SETPOINT,
};

export class AlertService {
  private readonly state = new Map<string, RuleEvaluationState>();

  constructor(
    private readonly repository: AlertRepository,
    private readonly resolveSetpoints: (deviceId: string) => DeviceMetricSetpoints = () => DEFAULT_SETPOINTS,
  ) {
    this.seedDefaults();
  }

  listRules(): AlertRule[] {
    return this.repository.listRules();
  }

  createRule(input: UpsertAlertRuleInput): AlertRule {
    const now = new Date().toISOString();
    const rule: AlertRule = {
      ruleId: this.createId('rule'),
      name: input.name.trim(),
      metric: input.metric,
      threshold: input.threshold,
      severity: input.severity,
      debounceCount: Math.max(1, input.debounceCount ?? 2),
      cooldownMs: Math.max(0, input.cooldownMs ?? 30_000),
      suppressionWindowMs: Math.max(0, input.suppressionWindowMs ?? Math.max(input.cooldownMs ?? 30_000, 45_000)),
      flappingWindowMs: Math.max(1_000, input.flappingWindowMs ?? 180_000),
      flappingThreshold: Math.max(2, input.flappingThreshold ?? 3),
      enabled: input.enabled ?? true,
      timeWindow: this.normalizeTimeWindow(input.timeWindow),
      createdAt: now,
      updatedAt: now,
    };

    this.repository.saveRule(rule);
    return rule;
  }

  updateRule(ruleId: string, input: Partial<UpsertAlertRuleInput>): AlertRule | null {
    const existing = this.repository.getRule(ruleId);
    if (!existing) {
      return null;
    }

    const updated: AlertRule = {
      ...existing,
      ...input,
      name: input.name?.trim() || existing.name,
      debounceCount: Math.max(1, input.debounceCount ?? existing.debounceCount),
      cooldownMs: Math.max(0, input.cooldownMs ?? existing.cooldownMs),
      suppressionWindowMs: Math.max(
        0,
        input.suppressionWindowMs ?? existing.suppressionWindowMs,
      ),
      flappingWindowMs: Math.max(1_000, input.flappingWindowMs ?? existing.flappingWindowMs),
      flappingThreshold: Math.max(2, input.flappingThreshold ?? existing.flappingThreshold),
      timeWindow:
        input.timeWindow === undefined
          ? existing.timeWindow
          : this.normalizeTimeWindow(input.timeWindow),
      updatedAt: new Date().toISOString(),
    };

    this.repository.saveRule(updated);
    return updated;
  }

  listAlerts(limit = 100, status: AlertStatus | 'all' = 'all'): AlertRecord[] {
    return this.repository.listAlerts(limit, status);
  }

  async deleteByDeviceId(deviceId: string): Promise<number> {
    const normalizedDeviceId = deviceId.trim();
    if (!normalizedDeviceId) {
      return 0;
    }
    for (const key of Array.from(this.state.keys())) {
      if (key.endsWith(`:${normalizedDeviceId}`)) {
        this.state.delete(key);
      }
    }
    return await this.repository.deleteByDeviceId(normalizedDeviceId);
  }

  summarizeAlerts() {
    return this.repository.summarizeAlerts();
  }

  getAlert(alertId: string): AlertRecord | null {
    return this.repository.getAlert(alertId);
  }

  countActiveAlerts(): number {
    return this.repository.countActiveAlerts();
  }

  acknowledgeAlert(alertId: string, actor: string, note?: string): AlertRecord | null {
    const existing = this.repository.getAlert(alertId);
    if (!existing || existing.status === 'resolved') {
      return null;
    }

    const now = new Date().toISOString();
    const acknowledged: AlertRecord = {
      ...existing,
      status: 'acknowledged',
      acknowledgedAt: existing.acknowledgedAt ?? now,
      acknowledgedBy: actor,
      acknowledgedNote: note ?? existing.acknowledgedNote,
      updatedAt: now,
    };

    this.repository.updateAlert(acknowledged);
    return acknowledged;
  }

  resolveAlert(alertId: string, actor: string, note?: string): AlertRecord | null {
    const existing = this.repository.getAlert(alertId);
    if (!existing || existing.status === 'resolved') {
      return null;
    }

    const now = new Date().toISOString();
    const resolved: AlertRecord = {
      ...existing,
      status: 'resolved',
      resolvedAt: now,
      resolvedBy: actor,
      resolutionNote: note ?? existing.resolutionNote,
      updatedAt: now,
    };

    this.repository.updateAlert(resolved);
    this.state.set(this.createStateKey(existing.ruleId, existing.deviceId), {
      consecutiveAbove: 0,
      lastTriggeredAt: existing.triggeredAt,
      lastResolvedAt: now,
      recentTriggeredAt: this.recentTriggersFor(existing.ruleId, existing.deviceId),
    });
    return resolved;
  }

  evaluate(message: TelemetryMessage): AlertRecord[] {
    const configured = this.resolveSetpoints(message.deviceId);
    return METRICS
      .map((definition) => this.evaluateMetric(message, definition, configured))
      .filter((alert): alert is AlertRecord => Boolean(alert));
  }

  private seedDefaults(): void {
    const now = new Date().toISOString();
    for (const definition of METRICS) {
      if (this.repository.getRule(definition.ruleId)) continue;
      this.repository.saveRule({
        ruleId: definition.ruleId,
        name: definition.name,
        metric: definition.metric,
        threshold: DEFAULT_VIBRATION_SETPOINT,
        severity: 'warning',
        debounceCount: 1,
        cooldownMs: 0,
        suppressionWindowMs: 0,
        flappingWindowMs: 180_000,
        flappingThreshold: 3,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private evaluateMetric(
    message: TelemetryMessage,
    definition: MetricDefinition,
    setpoints: DeviceMetricSetpoints,
  ): AlertRecord | null {
    const rule = this.repository.getRule(definition.ruleId);
    const value = definition.read(message.payload);
    if (!rule?.enabled || value === undefined) return null;

    const configured = setpoints[definition.setpoint];
    const threshold = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_VIBRATION_SETPOINT;
    const activeAlert = this.repository.getActiveAlert(rule.ruleId, message.deviceId);
    if (value > threshold) {
      if (activeAlert) {
        this.repository.updateAlert({
          ...activeAlert,
          threshold,
          lastValue: value,
          occurrenceCount: Math.max(1, activeAlert.occurrenceCount || 1) + 1,
          noiseState: 'coalesced',
          updatedAt: message.receivedAt,
        });
        return null;
      }
      const created: AlertRecord = {
        alertId: this.createId('alert'),
        ruleId: rule.ruleId,
        ruleName: rule.name,
        deviceId: message.deviceId,
        metric: definition.metric,
        severity: 'warning',
        threshold,
        triggerValue: value,
        lastValue: value,
        occurrenceCount: 1,
        suppressedCount: 0,
        noiseState: 'normal',
        status: 'active',
        triggeredAt: message.receivedAt,
        updatedAt: message.receivedAt,
      };
      this.repository.saveAlert(created);
      return created;
    }

    if (!activeAlert) return null;
    const resolved: AlertRecord = {
      ...activeAlert,
      threshold,
      lastValue: value,
      status: 'resolved',
      resolvedAt: message.receivedAt,
      resolvedBy: 'system',
      resolutionNote: `Resolved automatically after ${definition.metric} dropped below the device setpoint`,
      updatedAt: message.receivedAt,
    };
    this.repository.updateAlert(resolved);
    return resolved;
  }

  private createStateKey(ruleId: string, deviceId: string): string {
    return `${ruleId}:${deviceId}`;
  }

  private recentTriggersFor(ruleId: string, deviceId: string): string[] {
    const latest = this.repository.getLatestAlert(ruleId, deviceId);
    return latest ? [latest.triggeredAt] : [];
  }

  private isSuppressionActive(rule: AlertRule, state: RuleEvaluationState, receivedAt: string): boolean {
    const suppressedByCooldown =
      Boolean(state.lastTriggeredAt) &&
      this.addMilliseconds(state.lastTriggeredAt as string, rule.cooldownMs) > receivedAt;
    const suppressedByRecentResolve =
      Boolean(state.lastResolvedAt) &&
      this.addMilliseconds(state.lastResolvedAt as string, rule.suppressionWindowMs) > receivedAt;
    return suppressedByCooldown || suppressedByRecentResolve;
  }

  private applySuppression(
    latestAlert: AlertRecord | null,
    rule: AlertRule,
    deviceId: string,
    value: number,
    state: RuleEvaluationState,
    receivedAt: string,
  ): void {
    state.recentTriggeredAt = this.recordTrigger(state.recentTriggeredAt, rule, receivedAt);
    const isFlapping = this.isFlapping(rule, state.recentTriggeredAt);
    const baseAlert =
      latestAlert ||
      ({
        alertId: this.createId('alert'),
        ruleId: rule.ruleId,
        ruleName: rule.name,
        deviceId,
        metric: rule.metric,
        severity: rule.severity,
        threshold: rule.threshold,
        triggerValue: value,
        lastValue: value,
        occurrenceCount: 1,
        suppressedCount: 0,
        noiseState: 'suppressed',
        status: 'resolved',
        triggeredAt: receivedAt,
        resolvedAt: receivedAt,
        resolvedBy: 'system',
        resolutionNote: 'Signal suppressed before a new alert record was created',
        updatedAt: receivedAt,
      } satisfies AlertRecord);

    const suppressedAlert: AlertRecord = {
      ...baseAlert,
      lastValue: value,
      suppressedCount: Math.max(0, baseAlert.suppressedCount || 0) + 1,
      noiseState:
        baseAlert.noiseState === 'flapping' || isFlapping ? 'flapping' : 'suppressed',
      lastSuppressedAt: receivedAt,
      updatedAt: receivedAt,
      resolvedAt: baseAlert.resolvedAt ?? receivedAt,
      resolvedBy: baseAlert.resolvedBy ?? 'system',
      resolutionNote: baseAlert.resolutionNote ?? 'Signal suppressed after a recent alert resolution',
    };

    if (latestAlert) {
      this.repository.updateAlert(suppressedAlert);
      return;
    }

    this.repository.saveAlert(suppressedAlert);
  }

  private pruneRecentTriggers(entries: string[], rule: AlertRule, receivedAt: string): string[] {
    const cutoff = new Date(receivedAt).getTime() - rule.flappingWindowMs;
    return entries.filter((entry) => new Date(entry).getTime() >= cutoff);
  }

  private recordTrigger(entries: string[], rule: AlertRule, receivedAt: string): string[] {
    const next = [...entries, receivedAt];
    return this.pruneRecentTriggers(next, rule, receivedAt);
  }

  private isFlapping(rule: AlertRule, entries: string[]): boolean {
    return entries.length >= rule.flappingThreshold;
  }

  private addMilliseconds(isoTimestamp: string, milliseconds: number): string {
    return new Date(new Date(isoTimestamp).getTime() + milliseconds).toISOString();
  }

  private isWithinTimeWindow(rule: AlertRule, receivedAt: string): boolean {
    const window = rule.timeWindow;
    if (!window) {
      return true;
    }

    const currentHour = this.getHourInTimeZone(receivedAt, window.timezone);
    const startHour = this.normalizeHour(window.startHour);
    const endHour = this.normalizeHour(window.endHour);

    if (startHour === endHour) {
      return true;
    }

    if (startHour < endHour) {
      return currentHour >= startHour && currentHour < endHour;
    }

    return currentHour >= startHour || currentHour < endHour;
  }

  private getHourInTimeZone(isoTimestamp: string, timeZone?: string): number {
    const date = new Date(isoTimestamp);
    if (!timeZone) {
      return date.getUTCHours();
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone,
      });
      const parts = formatter.formatToParts(date);
      const hourPart = parts.find((part) => part.type === 'hour')?.value;
      return hourPart ? Number(hourPart) : date.getUTCHours();
    } catch {
      return date.getUTCHours();
    }
  }

  private normalizeHour(value: number): number {
    const rounded = Math.trunc(value);
    if (Number.isNaN(rounded)) {
      return 0;
    }
    const mod = rounded % 24;
    return mod < 0 ? mod + 24 : mod;
  }

  private normalizeTimeWindow(timeWindow?: AlertTimeWindow | null): AlertTimeWindow | undefined {
    if (!timeWindow) {
      return undefined;
    }

    return {
      startHour: this.normalizeHour(timeWindow.startHour),
      endHour: this.normalizeHour(timeWindow.endHour),
      timezone: timeWindow.timezone?.trim() || undefined,
    };
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
