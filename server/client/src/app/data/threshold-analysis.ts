import type { Sensor } from './sensors';

export type ThresholdMetric = 'temperature' | 'arms' | 'vrms' | 'drms';

export type ThresholdAnalysisRow = {
  deviceId: string;
  deviceName: string;
  system: string;
  zone: string;
  deviceLabel: string;
  metricGroup: string;
  metric: ThresholdMetric;
  unit: string;
  status: 'ok' | 'no_data' | 'error';
  error?: string;
  dataPoints?: number;
  representedSamples?: number;
  popularFrom?: number;
  popularTo?: number;
  popularCenter?: number;
  popularSharePercent?: number;
  densityFrom?: number;
  densityTo?: number;
  densityBins?: number[];
  filterWindowSize?: number;
  p95?: number;
  p99?: number;
  suggestedThreshold?: number;
  currentThreshold?: number;
};

export type ThresholdAnalysisJob = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string;
  progress: number;
  days: 7 | 30 | 90;
  marginPercent: number;
  includeSim: boolean;
  totalDevices: number;
  completedDevices: number;
  currentDeviceLabel?: string;
  devices: Record<string, {
    deviceId: string;
    label: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    availableMetrics?: number;
    processedRows?: number;
    totalRows?: number;
    error?: string;
  }>;
  events: Array<{
    at: string;
    level: 'info' | 'success' | 'error';
    message: string;
    deviceId?: string;
    label?: string;
  }>;
  results: ThresholdAnalysisRow[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  resultGeneratedAt?: string;
};

export type DeviceThresholdUpdate = {
  accelerationSetpoint?: number;
  vibrationSetpoint?: number;
  displacementSetpoint?: number;
  temperatureSetpoint?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numbers(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(number).filter((item): item is number => item !== undefined);
}

function parseRow(value: unknown): ThresholdAnalysisRow | null {
  const source = record(value);
  const metric = text(source.metric) as ThresholdMetric;
  const status = text(source.status) as ThresholdAnalysisRow['status'];
  const deviceId = text(source.deviceId);
  if (!deviceId || !['temperature', 'arms', 'vrms', 'drms'].includes(metric) || !['ok', 'no_data', 'error'].includes(status)) {
    return null;
  }
  return {
    deviceId,
    deviceName: text(source.deviceName),
    system: text(source.system),
    zone: text(source.zone),
    deviceLabel: text(source.deviceLabel) || deviceId,
    metricGroup: text(source.metricGroup),
    metric,
    unit: text(source.unit),
    status,
    error: text(source.error) || undefined,
    dataPoints: number(source.dataPoints),
    representedSamples: number(source.representedSamples),
    popularFrom: number(source.popularFrom),
    popularTo: number(source.popularTo),
    popularCenter: number(source.popularCenter),
    popularSharePercent: number(source.popularSharePercent),
    densityFrom: number(source.densityFrom),
    densityTo: number(source.densityTo),
    densityBins: numbers(source.densityBins),
    filterWindowSize: number(source.filterWindowSize),
    p95: number(source.p95),
    p99: number(source.p99),
    suggestedThreshold: number(source.suggestedThreshold),
    currentThreshold: number(source.currentThreshold),
  };
}

export function parseThresholdAnalysisJob(value: unknown): ThresholdAnalysisJob | null {
  const source = record(value);
  const jobId = text(source.jobId);
  const status = text(source.status) as ThresholdAnalysisJob['status'];
  const days = number(source.days);
  if (!jobId || !['queued', 'running', 'completed', 'failed'].includes(status) || ![7, 30, 90].includes(days ?? 0)) {
    return null;
  }
  const deviceSource = record(source.devices);
  const devices: ThresholdAnalysisJob['devices'] = {};
  for (const [key, value] of Object.entries(deviceSource)) {
    const item = record(value);
    const itemStatus = text(item.status) as ThresholdAnalysisJob['devices'][string]['status'];
    if (!['queued', 'running', 'completed', 'failed'].includes(itemStatus)) continue;
    devices[key] = {
      deviceId: text(item.deviceId) || key,
      label: text(item.label) || key,
      status: itemStatus,
      availableMetrics: number(item.availableMetrics),
      processedRows: number(item.processedRows),
      totalRows: number(item.totalRows),
      error: text(item.error) || undefined,
    };
  }
  const events = Array.isArray(source.events) ? source.events.map((value) => {
    const event = record(value);
    const level = text(event.level) as 'info' | 'success' | 'error';
    if (!['info', 'success', 'error'].includes(level) || !text(event.message)) return null;
    return {
      at: text(event.at),
      level,
      message: text(event.message),
      deviceId: text(event.deviceId) || undefined,
      label: text(event.label) || undefined,
    };
  }).filter((event): event is NonNullable<typeof event> => Boolean(event)) : [];

  return {
    jobId,
    status,
    stage: text(source.stage),
    progress: Math.max(0, Math.min(100, number(source.progress) ?? 0)),
    days: days as 7 | 30 | 90,
    marginPercent: number(source.marginPercent) ?? 5,
    includeSim: source.includeSim === true,
    totalDevices: number(source.totalDevices) ?? Object.keys(devices).length,
    completedDevices: number(source.completedDevices) ?? 0,
    currentDeviceLabel: text(source.currentDeviceLabel) || undefined,
    devices,
    events,
    results: Array.isArray(source.results) ? source.results.map(parseRow).filter((row): row is ThresholdAnalysisRow => Boolean(row)) : [],
    error: text(source.error) || undefined,
    createdAt: text(source.createdAt),
    updatedAt: text(source.updatedAt),
    completedAt: text(source.completedAt) || undefined,
    resultGeneratedAt: text(source.resultGeneratedAt) || undefined,
  };
}

export function buildDeviceThresholdUpdate(rows: ThresholdAnalysisRow[]): DeviceThresholdUpdate {
  const update: DeviceThresholdUpdate = {};
  for (const row of rows) {
    const value = row.suggestedThreshold;
    if (row.status !== 'ok' || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    if (row.metric === 'temperature') update.temperatureSetpoint = value;
    else if (row.metric === 'arms') update.accelerationSetpoint = value;
    else if (row.metric === 'vrms') update.vibrationSetpoint = value;
    else if (row.metric === 'drms') update.displacementSetpoint = value;
  }
  return update;
}

export function updateSensorThresholds(sensor: Sensor, update: DeviceThresholdUpdate): Sensor {
  return {
    ...sensor,
    accelerationSetpoint: update.accelerationSetpoint ?? sensor.accelerationSetpoint,
    velocitySetpoint: update.vibrationSetpoint ?? sensor.velocitySetpoint,
    displacementSetpoint: update.displacementSetpoint ?? sensor.displacementSetpoint,
    temperatureSetpoint: update.temperatureSetpoint ?? sensor.temperatureSetpoint,
  };
}
