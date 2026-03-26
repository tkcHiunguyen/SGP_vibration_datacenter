import type {
  AlertMetric,
  AlertRecord,
  AlertRule,
  AlertSeverity,
  AlertStatus,
  AlertTimeWindow,
  TelemetryMessage,
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

const DEFAULT_ALERT_RULES: Array<Omit<AlertRule, 'createdAt' | 'updatedAt'>> = [
  {
    ruleId: 'temperature-warning',
    name: 'Temperature Warning',
    metric: 'temperature',
    threshold: 35,
    severity: 'warning',
    debounceCount: 2,
    cooldownMs: 30_000,
    suppressionWindowMs: 45_000,
    flappingWindowMs: 180_000,
    flappingThreshold: 3,
    enabled: true,
  },
  {
    ruleId: 'temperature-critical',
    name: 'Temperature Critical',
    metric: 'temperature',
    threshold: 42,
    severity: 'critical',
    debounceCount: 2,
    cooldownMs: 15_000,
    suppressionWindowMs: 30_000,
    flappingWindowMs: 120_000,
    flappingThreshold: 3,
    enabled: true,
  },
  {
    ruleId: 'vibration-warning',
    name: 'Vibration Warning',
    metric: 'vibration',
    threshold: 0.55,
    severity: 'warning',
    debounceCount: 3,
    cooldownMs: 30_000,
    suppressionWindowMs: 45_000,
    flappingWindowMs: 180_000,
    flappingThreshold: 3,
    enabled: true,
  },
  {
    ruleId: 'vibration-critical',
    name: 'Vibration Critical',
    metric: 'vibration',
    threshold: 0.75,
    severity: 'critical',
    debounceCount: 2,
    cooldownMs: 15_000,
    suppressionWindowMs: 30_000,
    flappingWindowMs: 120_000,
    flappingThreshold: 3,
    enabled: true,
  },
];

export class AlertService {
  private readonly state = new Map<string, RuleEvaluationState>();

  constructor(private readonly repository: AlertRepository) {
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
    const changedAlerts: AlertRecord[] = [];

    for (const rule of this.repository.listRules()) {
      if (!rule.enabled) {
        continue;
      }

      const activeAlert = this.repository.getActiveAlert(rule.ruleId, message.deviceId);
      if (!activeAlert && !this.isWithinTimeWindow(rule, message.receivedAt)) {
        continue;
      }

      const value = message.payload[rule.metric];
      if (typeof value !== 'number' || Number.isNaN(value)) {
        continue;
      }

      const stateKey = this.createStateKey(rule.ruleId, message.deviceId);
      const state = this.state.get(stateKey) ?? {
        consecutiveAbove: 0,
        recentTriggeredAt: [],
      };
      state.recentTriggeredAt = this.pruneRecentTriggers(state.recentTriggeredAt, rule, message.receivedAt);

      if (value >= rule.threshold) {
        state.consecutiveAbove += 1;

        if (activeAlert) {
          const occurrenceCount = Math.max(1, activeAlert.occurrenceCount || 1) + 1;
          const updatedActive: AlertRecord = {
            ...activeAlert,
            status: activeAlert.status,
            lastValue: value,
            occurrenceCount,
            noiseState: activeAlert.noiseState === 'flapping' ? 'flapping' : 'coalesced',
            updatedAt: message.receivedAt,
          };
          this.repository.updateAlert(updatedActive);
          this.state.set(stateKey, state);
          continue;
        }

        const latestAlert = this.repository.getLatestAlert(rule.ruleId, message.deviceId);
        const suppressionActive = this.isSuppressionActive(rule, state, message.receivedAt);

        if (state.consecutiveAbove >= rule.debounceCount && suppressionActive) {
          this.applySuppression(latestAlert, rule, message.deviceId, value, state, message.receivedAt);
          this.state.set(stateKey, state);
          continue;
        }

        if (state.consecutiveAbove >= rule.debounceCount) {
          const recentTriggeredAt = this.recordTrigger(state.recentTriggeredAt, rule, message.receivedAt);
          const isFlapping = this.isFlapping(rule, recentTriggeredAt);
          const createdAlert: AlertRecord = {
            alertId: this.createId('alert'),
            ruleId: rule.ruleId,
            ruleName: rule.name,
            deviceId: message.deviceId,
            metric: rule.metric,
            severity: rule.severity,
            threshold: rule.threshold,
            triggerValue: value,
            lastValue: value,
            occurrenceCount: 1,
            suppressedCount: 0,
            noiseState: isFlapping ? 'flapping' : 'normal',
            status: 'active',
            triggeredAt: message.receivedAt,
            updatedAt: message.receivedAt,
          };
          this.repository.saveAlert(createdAlert);
          state.lastTriggeredAt = message.receivedAt;
          state.recentTriggeredAt = recentTriggeredAt;
          changedAlerts.push(createdAlert);
        }

        this.state.set(stateKey, state);
        continue;
      }

      state.consecutiveAbove = 0;
      this.state.set(stateKey, state);

      if (activeAlert) {
        const resolvedAlert: AlertRecord = {
          ...activeAlert,
          lastValue: value,
          status: 'resolved',
          resolvedAt: message.receivedAt,
          resolvedBy: 'system',
          resolutionNote: 'Resolved automatically after metric dropped below threshold',
          updatedAt: message.receivedAt,
        };
        this.repository.updateAlert(resolvedAlert);
        state.lastResolvedAt = message.receivedAt;
        this.state.set(stateKey, state);
        changedAlerts.push(resolvedAlert);
      }
    }

    return changedAlerts;
  }

  private seedDefaults(): void {
    if (this.repository.listRules().length > 0) {
      return;
    }

    const now = new Date().toISOString();
    for (const rule of DEFAULT_ALERT_RULES) {
      this.repository.saveRule({
        ...rule,
        createdAt: now,
        updatedAt: now,
      });
    }
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
