import { randomUUID } from 'node:crypto';
import type { DeviceMetadata, TelemetryPayload } from '../../shared/types.js';
import type { DeviceService } from '../device/device.service.js';
import type { TelemetryImportPoint } from '../telemetry/telemetry.repository.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';

export type ThresholdMetric = 'temperature' | 'arms' | 'vrms' | 'drms';
export type ThresholdAnalysisRowStatus = 'ok' | 'no_data' | 'error';

export type ThresholdAnalysisRow = {
  deviceId: string;
  deviceName: string;
  system: string;
  zone: string;
  deviceLabel: string;
  metricGroup: string;
  metric: ThresholdMetric;
  unit: string;
  status: ThresholdAnalysisRowStatus;
  error?: string;
  binWidth?: number;
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

export type ThresholdAnalysisDeviceProgress = {
  deviceId: string;
  label: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  availableMetrics?: number;
  processedRows?: number;
  totalRows?: number;
  error?: string;
};

export type ThresholdAnalysisEvent = {
  at: string;
  level: 'info' | 'success' | 'error';
  message: string;
  deviceId?: string;
  label?: string;
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
  devices: Record<string, ThresholdAnalysisDeviceProgress>;
  events: ThresholdAnalysisEvent[];
  results: ThresholdAnalysisRow[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  resultGeneratedAt?: string;
};

export type StartThresholdAnalysisInput = {
  days: 7 | 30 | 90;
  includeSim: boolean;
  deviceIds?: string[];
};

type AnalysisDeviceSource = {
  deviceId: string;
  metadata?: Partial<DeviceMetadata>;
};

type SelectedAnalysisDevice = AnalysisDeviceSource & { analysisLabel: string };
type AnalysisTelemetrySource = Pick<TelemetryService, 'countArchive' | 'exportHistoryBatches'>;
type MetricSamples = Record<ThresholdMetric, number[]>;

type MetricConfig = {
  group: string;
  unit: string;
  binWidth: number;
  currentField: keyof Pick<DeviceMetadata,
    'temperatureSetpoint' | 'accelerationSetpoint' | 'vibrationSetpoint' | 'displacementSetpoint'>;
  nonnegative: boolean;
};

const METRIC_ORDER: ThresholdMetric[] = ['temperature', 'arms', 'vrms', 'drms'];
const METRIC_CONFIG: Record<ThresholdMetric, MetricConfig> = {
  temperature: { group: 'TEMP', unit: 'degC', binWidth: 0.5, currentField: 'temperatureSetpoint', nonnegative: false },
  arms: { group: 'ARMS', unit: 'm/s2 RMS', binWidth: 0.1, currentField: 'accelerationSetpoint', nonnegative: true },
  vrms: { group: 'VRMS', unit: 'mm/s RMS', binWidth: 0.25, currentField: 'vibrationSetpoint', nonnegative: true },
  drms: { group: 'DRMS', unit: 'mm RMS', binWidth: 0.01, currentField: 'displacementSetpoint', nonnegative: true },
};
const RAW_BATCH_SIZE = 5_000;
const TERMINAL_JOB_LIMIT = 12;
const MARGIN_PERCENT = 10;
const DENSITY_BIN_COUNT = 24;
const FILTER_WINDOW_SIZE = 3;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function cleanNumber(value: number): number {
  return Number(value.toFixed(10));
}

function maxAbs(...values: unknown[]): number | undefined {
  const numbers = values
    .map(finiteNumber)
    .filter((value): value is number => value !== undefined)
    .map(Math.abs);
  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

export function extractThresholdMetrics(payload: TelemetryPayload): Partial<Record<ThresholdMetric, number>> {
  const result: Partial<Record<ThresholdMetric, number>> = {};
  const temperature = finiteNumber(payload.temperature);
  const arms = maxAbs(payload.ax, payload.ay, payload.az);
  const directVibration = finiteNumber(payload.vibration);
  const vrms = directVibration === undefined
    ? maxAbs(
      payload.vrms_x_mms ?? payload.vx_rms_mms,
      payload.vrms_y_mms ?? payload.vy_rms_mms,
      payload.vrms_z_mms ?? payload.vz_rms_mms,
    )
    : Math.abs(directVibration);
  const drmsUm = maxAbs(payload.drms_x_um, payload.drms_y_um, payload.drms_z_um);

  if (temperature !== undefined) result.temperature = temperature;
  if (arms !== undefined) result.arms = arms;
  if (vrms !== undefined) result.vrms = vrms;
  if (drmsUm !== undefined) result.drms = drmsUm * 0.001;
  return result;
}

export function analyzeThresholdSamples(
  samples: number[],
  binWidth: number,
  nonnegative = true,
): Omit<ThresholdAnalysisRow, 'deviceId' | 'deviceName' | 'system' | 'zone' | 'deviceLabel' | 'metricGroup' | 'metric' | 'unit' | 'status'> | null {
  if (samples.length === 0) return null;
  const filteredSamples = samples.map((_, index) => {
    const window = samples
      .slice(Math.max(0, index - FILTER_WINDOW_SIZE + 1), index + 1)
      .sort((left, right) => left - right);
    return window[Math.floor(window.length / 2)]!;
  });
  const sorted = [...filteredSamples].sort((left, right) => left - right);
  const percentile = (value: number) => sorted[Math.max(0, Math.ceil(sorted.length * value / 100) - 1)]!;
  const bins = new Map<number, number>();
  for (const sample of filteredSamples) {
    const index = Math.floor(sample / binWidth);
    bins.set(index, (bins.get(index) ?? 0) + 1);
  }
  let popularBin = 0;
  let popularCount = -1;
  for (const [index, count] of bins) {
    if (count > popularCount || (count === popularCount && index < popularBin)) {
      popularBin = index;
      popularCount = count;
    }
  }
  const p95 = percentile(95);
  const p99 = percentile(99);
  const densityFrom = Math.floor(percentile(1) / binWidth) * binWidth;
  const densityTo = Math.max(densityFrom + binWidth, Math.ceil(p99 / binWidth) * binWidth);
  const densityWidth = (densityTo - densityFrom) / DENSITY_BIN_COUNT;
  const densityCounts = Array.from({ length: DENSITY_BIN_COUNT }, () => 0);
  for (const sample of filteredSamples) {
    const index = Math.max(0, Math.min(DENSITY_BIN_COUNT - 1, Math.floor((sample - densityFrom) / densityWidth)));
    densityCounts[index] += 1;
  }
  const popularFrom = popularBin * binWidth;
  const popularCenter = popularFrom + binWidth / 2;
  let candidate = popularCenter + Math.abs(popularCenter) * MARGIN_PERCENT / 100;
  if (nonnegative) candidate = Math.max(binWidth, candidate);

  return {
    binWidth,
    dataPoints: samples.length,
    representedSamples: filteredSamples.length,
    popularFrom: cleanNumber(popularFrom),
    popularTo: cleanNumber(popularFrom + binWidth),
    popularCenter: cleanNumber(popularCenter),
    popularSharePercent: cleanNumber(popularCount * 100 / filteredSamples.length),
    densityFrom: cleanNumber(densityFrom),
    densityTo: cleanNumber(densityTo),
    densityBins: densityCounts.map((count) => cleanNumber(count * 100 / filteredSamples.length)),
    filterWindowSize: FILTER_WINDOW_SIZE,
    p95: cleanNumber(p95),
    p99: cleanNumber(p99),
    suggestedThreshold: cleanNumber(Math.ceil((candidate - 1e-12) / binWidth) * binWidth),
  };
}

export function buildAnalysisDeviceLabel(device: AnalysisDeviceSource): string {
  const name = text(device.metadata?.name);
  const context = [...new Set([text(device.metadata?.site), text(device.metadata?.zone)].filter(Boolean))].join(' - ');
  if (name) return `${name} - ${context || 'Chưa gán'}`;
  return context || device.deviceId;
}

export function selectAnalysisDevices(
  devices: AnalysisDeviceSource[],
  input: StartThresholdAnalysisInput,
): SelectedAnalysisDevice[] {
  const requested = new Set((input.deviceIds ?? []).map((item) => item.trim()).filter(Boolean));
  const selected = devices.filter((device) => {
    if (!input.includeSim && device.deviceId.toUpperCase().startsWith('SIM-')) return false;
    return requested.size === 0 || requested.has(device.deviceId);
  });
  const labels = selected.map(buildAnalysisDeviceLabel);
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1);
  return selected.map((device, index) => {
    const label = labels[index] ?? device.deviceId;
    const occurrence = (seen.get(label) ?? 0) + 1;
    seen.set(label, occurrence);
    return {
      ...device,
      analysisLabel: (totals.get(label) ?? 0) > 1 ? `${label} #${occurrence}` : label,
    };
  });
}

function emptySamples(): MetricSamples {
  return { temperature: [], arms: [], vrms: [], drms: [] };
}

function rowBase(device: SelectedAnalysisDevice, metric: ThresholdMetric): ThresholdAnalysisRow {
  const config = METRIC_CONFIG[metric];
  return {
    deviceId: device.deviceId,
    deviceName: text(device.metadata?.name),
    system: text(device.metadata?.site),
    zone: text(device.metadata?.zone),
    deviceLabel: device.analysisLabel,
    metricGroup: config.group,
    metric,
    unit: config.unit,
    status: 'no_data',
    binWidth: config.binWidth,
    currentThreshold: finiteNumber(device.metadata?.[config.currentField]),
  };
}

function rowsFromSamples(device: SelectedAnalysisDevice, samples: MetricSamples): ThresholdAnalysisRow[] {
  return METRIC_ORDER.map((metric) => {
    const base = rowBase(device, metric);
    const stats = analyzeThresholdSamples(
      samples[metric],
      METRIC_CONFIG[metric].binWidth,
      METRIC_CONFIG[metric].nonnegative,
    );
    return stats ? { ...base, ...stats, status: 'ok' } : base;
  });
}

export class DeviceThresholdAnalysisService {
  private readonly jobs = new Map<string, ThresholdAnalysisJob>();

  constructor(
    private readonly deviceService: DeviceService,
    private readonly telemetryService: AnalysisTelemetrySource,
  ) {}

  start(input: StartThresholdAnalysisInput): ThresholdAnalysisJob {
    const selected = selectAnalysisDevices(this.deviceService.list(), input);
    if (selected.length === 0) throw new Error('no_analysis_devices');

    this.pruneJobs();
    const now = new Date().toISOString();
    const job: ThresholdAnalysisJob = {
      jobId: randomUUID(),
      status: 'queued',
      stage: 'Đang chờ phân tích',
      progress: 0,
      days: input.days,
      marginPercent: MARGIN_PERCENT,
      includeSim: input.includeSim,
      totalDevices: selected.length,
      completedDevices: 0,
      devices: Object.fromEntries(selected.map((device) => [device.deviceId, {
        deviceId: device.deviceId,
        label: device.analysisLabel,
        status: 'queued' as const,
        processedRows: 0,
      }])),
      events: [],
      results: [],
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.jobId, job);
    void this.run(job, selected).catch((error) => this.failJob(job, error));
    return this.snapshot(job);
  }

  get(jobId: string): ThresholdAnalysisJob | null {
    const job = this.jobs.get(jobId);
    return job ? this.snapshot(job) : null;
  }

  private async run(job: ThresholdAnalysisJob, devices: SelectedAnalysisDevice[]): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - job.days * 86_400_000);
    this.patch(job, {
      status: 'running',
      stage: 'Đang chuẩn bị dữ liệu gốc',
      progress: 1,
      startedAt: new Date().toISOString(),
    });

    // ponytail: one device at a time bounds RAM; add a small worker pool only if measured runtime requires it.
    for (const device of devices) {
      const rows = await this.analyzeDevice(job, device, from.toISOString(), to.toISOString());
      job.results.push(...rows);
      job.updatedAt = new Date().toISOString();
    }

    const completedAt = new Date().toISOString();
    this.patch(job, {
      status: 'completed',
      stage: Object.values(job.devices).some((device) => device.status === 'failed')
        ? 'Hoàn tất, một số thiết bị có lỗi'
        : 'Phân tích hoàn tất',
      progress: 100,
      currentDeviceLabel: undefined,
      completedAt,
      resultGeneratedAt: completedAt,
    });
  }

  private async analyzeDevice(
    job: ThresholdAnalysisJob,
    device: SelectedAnalysisDevice,
    from: string,
    to: string,
  ): Promise<ThresholdAnalysisRow[]> {
    const progress = job.devices[device.deviceId]!;
    progress.status = 'running';
    job.currentDeviceLabel = device.analysisLabel;
    job.stage = `Đang đọc dữ liệu gốc của ${device.analysisLabel}`;
    this.addEvent(job, 'info', `Bắt đầu ${device.analysisLabel}`, device.deviceId, device.analysisLabel);

    try {
      progress.totalRows = await this.telemetryService.countArchive({ deviceId: device.deviceId, from, to });
      const samples = emptySamples();
      let processedRows = 0;
      for await (const batch of this.telemetryService.exportHistoryBatches(
        { deviceId: device.deviceId, from, to },
        RAW_BATCH_SIZE,
      )) {
        this.collectBatch(samples, batch, device.deviceId);
        processedRows += batch.length;
        progress.processedRows = processedRows;
        const currentFraction = progress.totalRows
          ? Math.min(1, processedRows / progress.totalRows)
          : 0;
        job.progress = Math.min(99, Math.max(job.progress, Math.round(
          ((job.completedDevices + currentFraction) / job.totalDevices) * 100,
        )));
        job.stage = `Đang đọc ${processedRows.toLocaleString('vi-VN')}/${(progress.totalRows ?? 0).toLocaleString('vi-VN')} bản ghi gốc · ${device.analysisLabel}`;
        job.updatedAt = new Date().toISOString();
      }

      const rows = rowsFromSamples(device, samples);
      progress.processedRows = processedRows;
      progress.availableMetrics = rows.filter((row) => row.status === 'ok').length;
      progress.status = 'completed';
      this.finishDevice(job);
      this.addEvent(
        job,
        'success',
        `${device.analysisLabel}: ${progress.availableMetrics}/4 chỉ số · ${processedRows.toLocaleString('vi-VN')} bản ghi gốc`,
        device.deviceId,
        device.analysisLabel,
      );
      return rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress.status = 'failed';
      progress.error = message;
      this.finishDevice(job);
      this.addEvent(job, 'error', `${device.analysisLabel}: ${message}`, device.deviceId, device.analysisLabel);
      return METRIC_ORDER.map((metric) => ({ ...rowBase(device, metric), status: 'error', error: message }));
    }
  }

  private collectBatch(samples: MetricSamples, batch: TelemetryImportPoint[], deviceId: string): void {
    for (const point of batch) {
      if (point.deviceId !== deviceId) continue;
      const metrics = extractThresholdMetrics(point.payload);
      for (const metric of METRIC_ORDER) {
        const value = metrics[metric];
        if (value !== undefined) samples[metric].push(value);
      }
    }
  }

  private finishDevice(job: ThresholdAnalysisJob): void {
    job.completedDevices = Object.values(job.devices)
      .filter((device) => device.status === 'completed' || device.status === 'failed')
      .length;
    job.progress = Math.min(99, Math.max(job.progress, Math.round(job.completedDevices / job.totalDevices * 100)));
    job.updatedAt = new Date().toISOString();
  }

  private addEvent(
    job: ThresholdAnalysisJob,
    level: ThresholdAnalysisEvent['level'],
    message: string,
    deviceId?: string,
    label?: string,
  ): void {
    job.events.push({ at: new Date().toISOString(), level, message, deviceId, label });
    if (job.events.length > 160) job.events.splice(0, job.events.length - 160);
    job.updatedAt = new Date().toISOString();
  }

  private patch(job: ThresholdAnalysisJob, patch: Partial<ThresholdAnalysisJob>): void {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.jobs.set(job.jobId, job);
  }

  private failJob(job: ThresholdAnalysisJob, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.addEvent(job, 'error', message);
    this.patch(job, {
      status: 'failed',
      stage: 'Phân tích thất bại',
      progress: 100,
      currentDeviceLabel: undefined,
      error: message,
      completedAt: new Date().toISOString(),
    });
  }

  private pruneJobs(): void {
    const terminal = [...this.jobs.values()]
      .filter((job) => job.status === 'completed' || job.status === 'failed')
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    while (terminal.length >= TERMINAL_JOB_LIMIT) {
      const oldest = terminal.shift();
      if (oldest) this.jobs.delete(oldest.jobId);
    }
  }

  private snapshot(job: ThresholdAnalysisJob): ThresholdAnalysisJob {
    return {
      ...job,
      devices: Object.fromEntries(Object.entries(job.devices).map(([key, value]) => [key, { ...value }])),
      events: job.events.map((event) => ({ ...event })),
      results: job.results.map((row) => ({ ...row })),
    };
  }
}
