import { unlink } from 'node:fs/promises';

import type { DeviceAxisLabels } from '../../shared/types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { DeviceService } from '../device/device.service.js';
import type { SpectrumArchiveFrame, SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import type { TelemetryImportPoint, TelemetrySummaryRebuildRange } from '../telemetry/telemetry.repository.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import type { SgpDataJobRepository } from './sgpdata-job.repository.js';
import { iterateSgpDataEntries, sha256File } from './sgpdata-parser.js';
import type {
  SgpDataDevice,
  SgpDataImportJob,
  SgpDataImportStage,
  SgpDataSpectrumFrame,
  SgpDataTelemetryPoint,
} from './sgpdata.types.js';

const TELEMETRY_BATCH_SIZE = 2_000;
const SPECTRUM_IMPORT_CONCURRENCY = 4;
const PROGRESS_PERSIST_INTERVAL_MS = 500;

type WorkerOptions = {
  workerRunId?: string;
};

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeAxisLabels(value: unknown): DeviceAxisLabels | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const labels: DeviceAxisLabels = {};
  for (const axis of ['ax', 'ay', 'az'] as const) {
    const label = optionalText(source[axis]);
    if (label) labels[axis] = label;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

function normalizeDevice(deviceId: string, device?: SgpDataDevice) {
  return {
    deviceId,
    uuid: optionalText(device?.uuid),
    name: optionalText(device?.name) ?? deviceId,
    site: optionalText(device?.site),
    zone: optionalText(device?.zone),
    firmwareVersion: optionalText(device?.firmwareVersion),
    axisLabels: normalizeAxisLabels(device?.axisLabels),
    notes: optionalText(device?.notes),
    createdAt: optionalText(device?.createdAt),
    updatedAt: optionalText(device?.updatedAt),
  };
}

function normalizeTelemetryPoint(point: SgpDataTelemetryPoint): TelemetryImportPoint | null {
  const deviceId = point.deviceId.trim();
  const receivedAtMs = Date.parse(point.receivedAt);
  if (!deviceId || !Number.isFinite(receivedAtMs)) return null;
  const receivedAt = new Date(receivedAtMs).toISOString();
  const telemetryUuid = (
    optionalText(point.telemetryUuid)
    ?? optionalText(point.payload.telemetry_uuid)
    ?? optionalText(point.payload.telemetryUuid)
    ?? `sgp-time:${deviceId}:${receivedAt}`
  ).slice(0, 255);
  return {
    deviceId,
    receivedAt,
    payload: { ...point.payload, telemetry_uuid: telemetryUuid, telemetryUuid },
    telemetryUuid,
    sampleCount: typeof point.sampleCount === 'number' && Number.isFinite(point.sampleCount)
      ? Math.max(0, Math.floor(point.sampleCount))
      : undefined,
  };
}

function normalizeSpectrumFrame(frame: SgpDataSpectrumFrame): SpectrumArchiveFrame | null {
  const deviceId = frame.deviceId.trim();
  const capturedAtMs = Date.parse(frame.capturedAt);
  if (!deviceId || !Number.isFinite(capturedAtMs) || !frame.storagePath.trim() || !frame.contentBase64.trim()) return null;
  const capturedAt = new Date(capturedAtMs).toISOString();
  return {
    ...frame,
    deviceId,
    capturedAt,
    telemetryUuid: (optionalText(frame.telemetryUuid) ?? `sgp-frame:${deviceId}:${capturedAt}`).slice(0, 255),
  };
}

function totalRecords(job: SgpDataImportJob): number {
  return job.totals.devices + job.totals.measurements + job.totals.spectrum + job.totals.placementConfigs;
}

function processedRecords(job: SgpDataImportJob): number {
  return job.processed.devices + job.processed.measurements + job.processed.spectrum + job.processed.placementConfigs;
}

function addEvent(job: SgpDataImportJob, stage: SgpDataImportStage, message: string): void {
  job.events.push({ at: new Date().toISOString(), stage, message });
  job.events = job.events.slice(-20);
}

export class SgpDataImportWorker {
  private readonly queue: string[] = [];
  private running = false;

  constructor(
    private readonly jobs: SgpDataJobRepository,
    private readonly deviceService: DeviceService,
    private readonly telemetryService: TelemetryService,
    private readonly spectrumStorageService: SpectrumStorageService,
    private readonly auditService: AuditService,
    private readonly options: WorkerOptions = {},
  ) {}

  enqueue(jobId: string): void {
    if (!this.queue.includes(jobId)) this.queue.push(jobId);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!jobId) continue;
        const job = await this.jobs.get(jobId);
        if (!job || job.status !== 'queued') continue;
        await this.run(job);
      }
    } finally {
      this.running = false;
      if (this.queue.length > 0) void this.drain();
    }
  }

  private async run(job: SgpDataImportJob): Promise<void> {
    const startedAt = new Date().toISOString();
    try {
      job.status = 'running';
      job.startedAt = startedAt;
      job.workerRunId = this.options.workerRunId;
      await this.setStage(job, 'validating', 'Đang xác minh file trước khi import');
      if (await sha256File(job.filePath) !== job.fileSha256) throw new Error('sgpdata_upload_changed');

      const importableDeviceIds = await this.importDevicesAndPlacementConfigs(job);
      const summaryRanges = await this.importTelemetryAndSpectrum(job, importableDeviceIds);

      await this.setStage(job, 'rebuilding_summaries', 'Đang xây lại dữ liệu tổng hợp cho biểu đồ');
      await this.telemetryService.rebuildHourlySummaries([...summaryRanges.values()]);

      const completedAt = new Date().toISOString();
      job.status = 'completed';
      job.stage = 'completed';
      job.progress = 100;
      job.stageProgress = 100;
      job.currentDeviceId = undefined;
      job.estimatedSecondsRemaining = 0;
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      for (const device of Object.values(job.devices)) {
        if (device.status === 'running' || device.status === 'queued') device.status = 'completed';
      }
      addEvent(job, 'completed', 'Import hoàn tất');
      await this.jobs.update(job);
      await unlink(job.filePath).catch(() => undefined);
      this.auditService.record({
        action: 'sgpdata_import',
        deviceId: 'n/a',
        commandId: job.jobId,
        actor: job.createdBy ?? 'anonymous',
        result: 'imported',
        metadata: {
          fileName: job.fileName,
          sizeBytes: job.sizeBytes,
          mode: job.mode,
          totals: job.totals,
          mutations: job.mutations,
        },
      });
    } catch (error) {
      const completedAt = new Date().toISOString();
      job.status = 'failed';
      job.stage = 'failed';
      job.stageProgress = 100;
      job.error = error instanceof Error ? error.message : 'sgpdata_import_failed';
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      addEvent(job, 'failed', `Import thất bại: ${job.error}`);
      await this.jobs.update(job);
    }
  }

  private async importDevicesAndPlacementConfigs(job: SgpDataImportJob): Promise<Set<string>> {
    await this.setStage(job, 'importing_devices', 'Đang nhập thông tin thiết bị');
    const previewMetadata = job.preview?.deviceMetadata;
    const previewPlacementConfigs = job.preview?.placementConfigs;
    const archived = new Map<string, SgpDataDevice>(
      (previewMetadata ?? []).map((device) => [device.deviceId.trim(), device]),
    );
    const placementConfigs = [...(previewPlacementConfigs ?? [])];
    if (!previewMetadata || !previewPlacementConfigs) {
      for await (const entry of iterateSgpDataEntries(job.filePath)) {
        if (!previewMetadata && entry.type === 'device') archived.set(entry.data.deviceId.trim(), entry.data);
        if (!previewPlacementConfigs && entry.type === 'placementConfig') placementConfigs.push(entry.data);
      }
    }

    const importable = new Set<string>();
    for (const previewDevice of job.preview?.devices ?? []) {
      const deviceId = previewDevice.deviceId.trim();
      if (!deviceId) continue;
      job.currentDeviceId = deviceId;
      job.devices[deviceId].status = 'running';
      const existing = this.deviceService.getMetadata(deviceId);
      if (job.mode === 'idempotent' && existing) {
        job.mutations.skipped += 1;
        importable.add(deviceId);
      } else {
        try {
          await this.deviceService.importMetadataStrict(normalizeDevice(deviceId, archived.get(deviceId)));
          existing ? job.mutations.updated += 1 : job.mutations.inserted += 1;
          importable.add(deviceId);
        } catch {
          try {
            await this.deviceService.importMetadataStrict({
              ...normalizeDevice(deviceId, archived.get(deviceId)),
              uuid: undefined,
              zone: undefined,
            });
            existing ? job.mutations.updated += 1 : job.mutations.inserted += 1;
            importable.add(deviceId);
          } catch {
            job.mutations.failed += 1;
            job.devices[deviceId].status = 'failed';
          }
        }
      }
      job.processed.devices += 1;
      await this.persistProgress(job, job.processed.devices, job.totals.devices, `Đã xử lý thiết bị ${deviceId}`);
    }
    await this.importPlacementConfigs(job, importable, placementConfigs);
    return importable;
  }

  private async importTelemetryAndSpectrum(
    job: SgpDataImportJob,
    importableDeviceIds: Set<string>,
  ): Promise<Map<string, TelemetrySummaryRebuildRange>> {
    await this.setStage(job, 'importing_telemetry', 'Đang nhập dữ liệu đo theo batch');
    const ranges = new Map<string, TelemetrySummaryRebuildRange>();
    let telemetryBatch: TelemetryImportPoint[] = [];
    let spectrumBatch: Array<{ deviceId: string; frame: SpectrumArchiveFrame | null }> = [];
    let activeStage: 'telemetry' | 'spectrum' = 'telemetry';
    let lastSpectrumProgressAt = 0;

    const flushTelemetry = async () => {
      if (telemetryBatch.length === 0) return;
      const current = telemetryBatch;
      telemetryBatch = [];
      const result = await this.telemetryService.importHistoryBatch(current, job.mode);
      job.mutations.inserted += result.inserted;
      job.mutations.updated += result.updated;
      job.mutations.skipped += result.skipped;
      for (const point of current) {
        const device = job.devices[point.deviceId];
        if (device) {
          device.status = 'running';
          device.measurementsProcessed += 1;
        }
        const prior = ranges.get(point.deviceId);
        ranges.set(point.deviceId, {
          deviceId: point.deviceId,
          from: prior && Date.parse(prior.from) < Date.parse(point.receivedAt) ? prior.from : point.receivedAt,
          to: prior && Date.parse(prior.to) > Date.parse(point.receivedAt) ? prior.to : point.receivedAt,
        });
      }
      job.processed.measurements += current.length;
      job.currentDeviceId = current.at(-1)?.deviceId;
      job.checkpoint = { lastEntry: processedRecords(job), lastStage: job.stage };
      await this.persistProgress(
        job,
        job.processed.measurements,
        job.totals.measurements,
        `Đã xử lý ${job.processed.measurements}/${job.totals.measurements} telemetry`,
      );
    };

    const flushSpectrum = async (forceProgress = false) => {
      if (spectrumBatch.length === 0) return;
      const current = spectrumBatch;
      spectrumBatch = [];
      const outcomes = await Promise.all(current.map(async ({ frame }) => (
        frame ? await this.spectrumStorageService.importArchiveFrame(frame, job.mode) : 'skipped' as const
      )));
      for (let index = 0; index < current.length; index += 1) {
        const candidate = current[index]!;
        const outcome = outcomes[index]!;
        job.mutations[outcome] += 1;
        if (candidate.frame) {
          const device = job.devices[candidate.frame.deviceId];
          if (device) {
            device.status = 'running';
            device.spectrumProcessed += 1;
          }
        }
        job.processed.spectrum += 1;
        job.currentDeviceId = candidate.deviceId;
      }
      job.checkpoint = { lastEntry: processedRecords(job), lastStage: job.stage };
      const now = Date.now();
      if (
        forceProgress
        || job.processed.spectrum >= job.totals.spectrum
        || now - lastSpectrumProgressAt >= PROGRESS_PERSIST_INTERVAL_MS
      ) {
        lastSpectrumProgressAt = now;
        await this.persistProgress(
          job,
          job.processed.spectrum,
          job.totals.spectrum,
          `Đã xử lý ${job.processed.spectrum}/${job.totals.spectrum} frame FFT`,
        );
      }
    };

    for await (const entry of iterateSgpDataEntries(job.filePath)) {
      if (entry.type === 'measurement') {
        if (activeStage === 'spectrum') {
          await flushSpectrum(true);
          await this.setStage(job, 'importing_telemetry', 'Đang tiếp tục nhập dữ liệu đo');
          activeStage = 'telemetry';
        }
        const point = normalizeTelemetryPoint(entry.data);
        if (!point || !importableDeviceIds.has(point.deviceId)) {
          job.processed.measurements += 1;
          job.mutations.skipped += 1;
          continue;
        }
        telemetryBatch.push(point);
        if (telemetryBatch.length >= TELEMETRY_BATCH_SIZE) await flushTelemetry();
        continue;
      }
      if (entry.type !== 'spectrumFrame') continue;
      if (activeStage === 'telemetry') {
        await flushTelemetry();
        if (job.processed.measurements > 0) {
          await this.persistProgress(job, job.processed.measurements, job.totals.measurements, 'Đã hoàn tất telemetry');
        }
        await this.setStage(job, 'importing_spectrum', 'Đang nhập phổ FFT theo nhóm song song');
        activeStage = 'spectrum';
      }
      const frame = normalizeSpectrumFrame(entry.data);
      spectrumBatch.push({
        deviceId: frame?.deviceId ?? entry.data.deviceId.trim(),
        frame: frame && importableDeviceIds.has(frame.deviceId) ? frame : null,
      });
      if (spectrumBatch.length >= SPECTRUM_IMPORT_CONCURRENCY) await flushSpectrum();
    }
    await flushTelemetry();
    await flushSpectrum(true);
    if (activeStage === 'telemetry' && job.processed.measurements > 0) {
      await this.persistProgress(job, job.processed.measurements, job.totals.measurements, 'Đã hoàn tất telemetry');
    }
    return ranges;
  }

  private async importPlacementConfigs(
    job: SgpDataImportJob,
    importableDeviceIds: Set<string>,
    placementConfigs: Array<{ deviceId: string; config: Record<string, unknown> }>,
  ): Promise<void> {
    if (placementConfigs.length === 0) return;
    await this.setStage(job, 'importing_placement_configs', 'Đang nhập cấu hình vị trí');
    for (const { deviceId, config } of placementConfigs) {
      job.currentDeviceId = deviceId;
      if (!importableDeviceIds.has(deviceId)) {
        job.mutations.skipped += 1;
      } else {
        const existing = await this.spectrumStorageService.readPlacementConfig(deviceId);
        if (job.mode === 'idempotent' && existing) {
          job.mutations.skipped += 1;
        } else {
          await this.spectrumStorageService.writePlacementConfig(deviceId, config);
          existing ? job.mutations.updated += 1 : job.mutations.inserted += 1;
        }
      }
      job.processed.placementConfigs += 1;
      await this.persistProgress(
        job,
        job.processed.placementConfigs,
        job.totals.placementConfigs,
        `Đã xử lý cấu hình ${deviceId}`,
      );
    }
  }

  private async setStage(job: SgpDataImportJob, stage: SgpDataImportStage, message: string): Promise<void> {
    job.stage = stage;
    job.stageProgress = 0;
    job.updatedAt = new Date().toISOString();
    addEvent(job, stage, message);
    await this.jobs.update(job);
  }

  private async persistProgress(job: SgpDataImportJob, stageDone: number, stageTotal: number, message: string): Promise<void> {
    const now = Date.now();
    const startedAt = Date.parse(job.startedAt ?? job.createdAt);
    const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1_000);
    const processed = processedRecords(job);
    const total = totalRecords(job);
    job.stageProgress = stageTotal > 0 ? Math.min(100, Math.round((stageDone / stageTotal) * 100)) : 100;
    job.progress = total > 0 ? Math.min(94, 5 + Math.round((processed / total) * 89)) : 94;
    job.recordsPerSecond = processed / elapsedSeconds;
    job.estimatedSecondsRemaining = job.recordsPerSecond > 0
      ? Math.max(0, Math.ceil((total - processed) / job.recordsPerSecond))
      : undefined;
    job.updatedAt = new Date(now).toISOString();
    addEvent(job, job.stage, message);
    await this.jobs.update(job);
  }
}
