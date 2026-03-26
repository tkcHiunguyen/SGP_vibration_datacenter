import type { AlertNoiseState, AlertRecord, AlertRule, AlertStatus } from '../../shared/types.js';

export type AlertSummary = {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  byNoiseState: Record<AlertNoiseState, number>;
  coalescedSignals: number;
  suppressedSignals: number;
  flappingSignals: number;
  topNoisyRules: Array<{ key: string; count: number }>;
  topNoisyDevices: Array<{ key: string; count: number }>;
};

export interface AlertRepository {
  listRules(): AlertRule[];
  getRule(ruleId: string): AlertRule | null;
  saveRule(rule: AlertRule): void;
  listAlerts(limit?: number, status?: AlertStatus | 'all'): AlertRecord[];
  summarizeAlerts(): AlertSummary;
  getAlert(alertId: string): AlertRecord | null;
  getActiveAlert(ruleId: string, deviceId: string): AlertRecord | null;
  getLatestAlert(ruleId: string, deviceId: string): AlertRecord | null;
  saveAlert(record: AlertRecord): void;
  updateAlert(record: AlertRecord): void;
  countActiveAlerts(): number;
}
