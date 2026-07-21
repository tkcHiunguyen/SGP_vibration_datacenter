import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

import type { AuditService } from '../audit/audit.service.js';
import type { DataExportJob, DataExportJobRepository } from '../data-export/data-export-job.repository.js';
import type { DeviceService } from '../device/device.service.js';
import type { SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import type { SgpDataManifest } from './sgpdata.types.js';

type ExportWorkerOptions = {
  workerRunId?: string;
};

const EXPORT_TELEMETRY_BATCH_SIZE = 5_000;
const EXPORT_SPECTRUM_BATCH_SIZE = 1_000;
const EXPORT_SPECTRUM_WRITE_CHUNK_SIZE = 100;
const EXPORT_PROGRESS_INTERVAL_MS = 500;

function ndjsonLine(type: string, data: unknown): string {
  return JSON.stringify({ type, data });
}

async function writeLine(stream: NodeJS.WritableStream, line: string): Promise<void> {
  if (!stream.write(`${line}\n`)) await once(stream, 'drain');
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export class SgpDataExportWorker {
  private readonly queue: string[] = [];
  private running = false;

  constructor(
    private readonly jobs: DataExportJobRepository,
    private readonly deviceService: DeviceService,
    private readonly telemetryService: TelemetryService,
    private readonly spectrumStorageService: SpectrumStorageService,
    private readonly auditService: AuditService,
    private readonly exportDir: string,
    private readonly options: ExportWorkerOptions = {},
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

  private async run(job: DataExportJob): Promise<void> {
    let filePath: string | undefined;
    try {
      job.status = 'running';
      job.progress = 1;
      job.stage = 'Đang chuẩn bị export';
      job.startedAt = new Date().toISOString();
      job.updatedAt = job.startedAt;
      job.workerRunId = this.options.workerRunId;
      await this.jobs.update(job);

      const devices = job.deviceId
        ? [this.deviceService.getMetadata(job.deviceId)].filter((value): value is NonNullable<typeof value> => Boolean(value))
        : this.deviceService.list().map((item) => item.metadata).filter((value): value is NonNullable<typeof value> => Boolean(value));
      if (job.deviceId && devices.length === 0) throw new Error('device_not_found');
      const placementConfigs = new Map<string, Record<string, unknown>>();
      for (const device of devices) {
        const config = await this.spectrumStorageService.readPlacementConfig(device.deviceId);
        if (config) placementConfigs.set(device.deviceId, config);
      }
      const query = { from: job.range.from, to: job.range.to, deviceId: job.deviceId };
      const [measurementCount, spectrumFrameCount] = await Promise.all([
        this.telemetryService.countArchive(query),
        this.spectrumStorageService.countArchiveFrames(query),
      ]);
      const totalRecords = devices.length + placementConfigs.size + measurementCount + spectrumFrameCount;
      let processed = 0;

      await mkdir(this.exportDir, { recursive: true });
      const suffix = `${job.range.from.slice(0, 10)}_${job.range.to.slice(0, 10)}`;
      const deviceSuffix = job.deviceId ? `_${job.deviceId.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80)}` : '';
      const fileName = `sgp-data${deviceSuffix}_${suffix}.sgpdata`;
      filePath = `${this.exportDir}/${job.jobId}-${fileName}`;
      const manifest: SgpDataManifest = {
        format: 'sgpdata',
        version: 2,
        exportedAt: new Date().toISOString(),
        dateRange: job.range,
        deviceCount: devices.length,
        measurementCount,
        spectrumFrameCount,
        placementConfigCount: placementConfigs.size,
      };
      const checksum = createHash('sha256');
      const gzipStream = createGzip({ level: 3, chunkSize: 256 * 1024 });
      const outputPromise = pipeline(gzipStream, createWriteStream(filePath, { highWaterMark: 1024 * 1024 }));
      const writeEntry = async (type: string, data: unknown) => {
        const line = ndjsonLine(type, data);
        checksum.update(line).update('\n');
        await writeLine(gzipStream, line);
      };
      const writeEntries = async (type: string, items: unknown[]) => {
        if (items.length === 0) return;
        const chunk = `${items.map((item) => ndjsonLine(type, item)).join('\n')}\n`;
        checksum.update(chunk);
        await writeChunk(gzipStream, chunk);
      };
      let lastProgressUpdateAt = 0;
      const updateProgress = async (stage: string, force = false) => {
        const now = Date.now();
        if (!force && processed < totalRecords && now - lastProgressUpdateAt < EXPORT_PROGRESS_INTERVAL_MS) return;
        lastProgressUpdateAt = now;
        job.stage = stage;
        job.progress = totalRecords > 0 ? clampProgress(3 + (processed / totalRecords) * 94) : 97;
        job.updatedAt = new Date(now).toISOString();
        await this.jobs.update(job);
      };

      await writeEntry('manifest', { ...manifest, encoding: 'gzip-ndjson' });
      for (const device of devices) {
        await writeEntry('device', device);
        processed += 1;
      }
      await updateProgress('Đang xuất cấu hình thiết bị', true);
      for (const [deviceId, config] of placementConfigs) {
        await writeEntry('placementConfig', { deviceId, config });
        processed += 1;
      }

      await updateProgress('Đang xuất telemetry theo batch', true);
      for await (const batch of this.telemetryService.exportHistoryBatches(query, EXPORT_TELEMETRY_BATCH_SIZE)) {
        await writeEntries('measurement', batch);
        processed += batch.length;
        await updateProgress(`Đã xuất ${processed}/${totalRecords} record`);
      }

      await updateProgress('Đang xuất frame FFT theo nhóm song song', true);
      let spectrumChunk: unknown[] = [];
      for await (const frame of this.spectrumStorageService.exportArchiveFrames(query, EXPORT_SPECTRUM_BATCH_SIZE)) {
        spectrumChunk.push(frame);
        processed += 1;
        if (spectrumChunk.length < EXPORT_SPECTRUM_WRITE_CHUNK_SIZE) continue;
        await writeEntries('spectrumFrame', spectrumChunk);
        spectrumChunk = [];
        await updateProgress(`Đã xuất ${processed}/${totalRecords} record`);
      }
      if (spectrumChunk.length > 0) {
        await writeEntries('spectrumFrame', spectrumChunk);
        await updateProgress(`Đã xuất ${processed}/${totalRecords} record`, processed === totalRecords);
      }

      manifest.checksumSha256 = checksum.digest('hex');
      await writeLine(gzipStream, ndjsonLine('end', { checksumSha256: manifest.checksumSha256 }));
      gzipStream.end();
      await outputPromise;
      const fileStat = await stat(filePath);
      const completedAt = new Date().toISOString();
      Object.assign(job, {
        status: 'completed' as const,
        progress: 100,
        stage: 'Hoàn tất',
        fileName,
        filePath,
        sizeBytes: fileStat.size,
        manifest,
        completedAt,
        updatedAt: completedAt,
      });
      await this.jobs.update(job);
      this.auditService.record({
        action: 'sgpdata_export',
        deviceId: job.deviceId ?? 'n/a',
        commandId: job.jobId,
        actor: job.createdBy ?? 'anonymous',
        result: 'exported',
        metadata: { dateRange: job.range, ...manifest, sizeBytes: fileStat.size },
      });
    } catch (error) {
      if (filePath) await unlink(filePath).catch(() => undefined);
      const completedAt = new Date().toISOString();
      job.status = 'failed';
      job.progress = 100;
      job.stage = 'Export thất bại';
      job.error = error instanceof Error ? error.message : 'sgpdata_export_failed';
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      await this.jobs.update(job);
    }
  }
}
