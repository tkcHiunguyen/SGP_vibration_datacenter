import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type { SpectrumAxis, TelemetrySpectrumMessage } from '../../shared/types.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const AXES: SpectrumAxis[] = ['x', 'y', 'z'];
const DEFAULT_FRAME_FLUSH_MS = 700;
const DEFAULT_MATCH_WINDOW_MS = 500;
const DEFAULT_LOOKUP_MAX_DELTA_MS = 1200;

type PendingSpectrumFrame = {
  key: string;
  deviceId: string;
  telemetryUuid?: string;
  capturedAtMs: number;
  axes: Partial<Record<SpectrumAxis, TelemetrySpectrumMessage>>;
  timer: ReturnType<typeof setTimeout> | null;
};

type SpectrumFrameRow = {
  id: number;
  device_id: string;
  captured_at: string | Date;
  telemetry_uuid: string | null;
  device_data_id: number | null;
  storage_path: string;
  file_size_bytes: number | null;
  checksum_sha256: string | null;
};

type SpectrumSummaryRow = {
  total_frames: number;
  latest_captured_at: string | Date | null;
  total_bytes: number | null;
};

type PersistedSpectrumPayload = {
  version: 1;
  deviceId: string;
  capturedAt: string;
  telemetryUuid?: string;
  axes: Record<SpectrumAxis, TelemetrySpectrumMessage | null>;
};

type SpectrumStorageOptions = {
  baseDir?: string;
  frameFlushMs?: number;
  matchWindowMs?: number;
  lookupMaxDeltaMs?: number;
};

export type SpectrumFrameLookupResult = {
  deviceId: string;
  capturedAt: string;
  telemetryUuid?: string;
  storagePath: string;
  fileSizeBytes?: number;
  checksumSha256?: string;
  points: TelemetrySpectrumMessage[];
};

export type SpectrumFramePurgeResult = {
  framesDeleted: number;
  filesDeleted: number;
  fileDeleteErrors: number;
};

export type SpectrumFrameSummary = {
  totalFrames: number;
  latestCapturedAt?: string;
  totalBytes: number;
};

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return normalized.endsWith('Z') ? normalized : `${normalized}Z`;
}

function parseTimestamp(value: string | Date): number {
  const timestamp = Date.parse(toIsoTimestamp(value));
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function sanitizePathSegment(input: string, fallback: string): string {
  const normalized = input
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export class SpectrumStorageService {
  private readonly pendingFrames = new Map<string, PendingSpectrumFrame>();
  private readonly baseDir: string;
  private readonly frameFlushMs: number;
  private readonly matchWindowMs: number;
  private readonly lookupMaxDeltaMs: number;

  constructor(
    private readonly mysql: MySqlAccess | null,
    options: SpectrumStorageOptions = {},
  ) {
    this.baseDir = options.baseDir ? options.baseDir : join(process.cwd(), 'storage', 'spectrum');
    this.frameFlushMs =
      typeof options.frameFlushMs === 'number' && Number.isFinite(options.frameFlushMs) && options.frameFlushMs > 0
        ? Math.floor(options.frameFlushMs)
        : DEFAULT_FRAME_FLUSH_MS;
    this.matchWindowMs =
      typeof options.matchWindowMs === 'number' && Number.isFinite(options.matchWindowMs) && options.matchWindowMs > 0
        ? Math.floor(options.matchWindowMs)
        : DEFAULT_MATCH_WINDOW_MS;
    this.lookupMaxDeltaMs =
      typeof options.lookupMaxDeltaMs === 'number' &&
      Number.isFinite(options.lookupMaxDeltaMs) &&
      options.lookupMaxDeltaMs > 0
        ? Math.floor(options.lookupMaxDeltaMs)
        : DEFAULT_LOOKUP_MAX_DELTA_MS;

    mkdirSync(this.baseDir, { recursive: true });
  }

  async ingest(point: TelemetrySpectrumMessage): Promise<void> {
    const timestampMs = parseTimestamp(point.receivedAt);
    const frame = this.findOrCreateFrame(point, timestampMs);
    frame.axes[point.axis] = point;
    frame.capturedAtMs = Math.min(frame.capturedAtMs, timestampMs);

    if (this.hasCompleteAxes(frame)) {
      await this.finalizeFrame(frame.key);
      return;
    }

    this.scheduleFrameFlush(frame.key);
  }

  async findNearestFrame(deviceId: string, at?: string, telemetryUuid?: string): Promise<SpectrumFrameLookupResult | null> {
    if (!this.mysql) {
      return null;
    }

    const targetDeviceId = deviceId.trim();
    if (!targetDeviceId) {
      return null;
    }

    const normalizedTelemetryUuid =
      typeof telemetryUuid === 'string' && telemetryUuid.trim() ? telemetryUuid.trim().slice(0, 255) : undefined;

    let selected: SpectrumFrameRow | null = null;
    let targetTimestamp: number | null = null;
    if (normalizedTelemetryUuid) {
      const byUuidRows = await this.mysql.query<SpectrumFrameRow>(
        `SELECT id, device_id, captured_at, telemetry_uuid, device_data_id, storage_path, file_size_bytes, checksum_sha256
           FROM device_spectrum_frames
          WHERE device_id = ? AND telemetry_uuid = ?
          ORDER BY captured_at DESC
          LIMIT 1`,
        [targetDeviceId, normalizedTelemetryUuid],
      );
      selected = byUuidRows[0] ?? null;
    } else if (at) {
      const target = new Date(at).toISOString();
      targetTimestamp = Date.parse(target);

      const beforeRows = await this.mysql.query<SpectrumFrameRow>(
        `SELECT id, device_id, captured_at, telemetry_uuid, device_data_id, storage_path, file_size_bytes, checksum_sha256
           FROM device_spectrum_frames
          WHERE device_id = ? AND captured_at <= ?
          ORDER BY captured_at DESC
          LIMIT 1`,
        [targetDeviceId, target],
      );
      const afterRows = await this.mysql.query<SpectrumFrameRow>(
        `SELECT id, device_id, captured_at, telemetry_uuid, device_data_id, storage_path, file_size_bytes, checksum_sha256
           FROM device_spectrum_frames
          WHERE device_id = ? AND captured_at >= ?
          ORDER BY captured_at ASC
          LIMIT 1`,
        [targetDeviceId, target],
      );

      const before = beforeRows[0] ?? null;
      const after = afterRows[0] ?? null;

      if (before && after) {
        const beforeDiff = Math.abs(targetTimestamp - parseTimestamp(before.captured_at));
        const afterDiff = Math.abs(parseTimestamp(after.captured_at) - targetTimestamp);
        selected = beforeDiff <= afterDiff ? before : after;
      } else {
        selected = before ?? after ?? null;
      }
    } else {
      const latestRows = await this.mysql.query<SpectrumFrameRow>(
        `SELECT id, device_id, captured_at, telemetry_uuid, device_data_id, storage_path, file_size_bytes, checksum_sha256
           FROM device_spectrum_frames
          WHERE device_id = ?
          ORDER BY captured_at DESC
          LIMIT 1`,
        [targetDeviceId],
      );
      selected = latestRows[0] ?? null;
    }

    if (!selected) {
      return null;
    }

    if (targetTimestamp !== null) {
      const deltaMs = Math.abs(parseTimestamp(selected.captured_at) - targetTimestamp);
      if (deltaMs > this.lookupMaxDeltaMs) {
        return null;
      }
    }

    const payload = await this.readPersistedPayload(selected.storage_path);
    if (!payload) {
      return null;
    }

    if (!this.hasCompletePayloadAxes(payload)) {
      return null;
    }

    const points = AXES.flatMap((axis) => {
      const point = payload.axes?.[axis];
      if (!point || !Array.isArray(point.amplitudes)) {
        return [];
      }
      return [
        {
          ...point,
          deviceId: point.deviceId || selected.device_id,
          axis,
        } as TelemetrySpectrumMessage,
      ];
    });

    return {
      deviceId: selected.device_id,
      capturedAt: toIsoTimestamp(selected.captured_at),
      telemetryUuid: selected.telemetry_uuid ?? undefined,
      storagePath: selected.storage_path,
      fileSizeBytes:
        typeof selected.file_size_bytes === 'number' && Number.isFinite(selected.file_size_bytes)
          ? selected.file_size_bytes
          : undefined,
      checksumSha256: selected.checksum_sha256 ?? undefined,
      points,
    };
  }

  async purgeDeviceFrames(deviceId: string): Promise<SpectrumFramePurgeResult> {
    const targetDeviceId = deviceId.trim();
    if (!targetDeviceId) {
      return {
        framesDeleted: 0,
        filesDeleted: 0,
        fileDeleteErrors: 0,
      };
    }

    this.clearPendingFramesForDevice(targetDeviceId);
    if (!this.mysql) {
      return {
        framesDeleted: 0,
        filesDeleted: 0,
        fileDeleteErrors: 0,
      };
    }

    const frameRows = await this.mysql.query<{ storage_path: string | null }>(
      `SELECT storage_path
         FROM device_spectrum_frames
        WHERE device_id = ?`,
      [targetDeviceId],
    );
    const storagePaths = [...new Set(
      frameRows
        .map((row) => (typeof row.storage_path === 'string' ? row.storage_path.trim() : ''))
        .filter((value) => value.length > 0),
    )];

    const framesDeleted = await this.mysql.execute('DELETE FROM device_spectrum_frames WHERE device_id = ?', [
      targetDeviceId,
    ]);

    let filesDeleted = 0;
    let fileDeleteErrors = 0;
    for (const storagePath of storagePaths) {
      try {
        await unlink(join(this.baseDir, storagePath));
        filesDeleted += 1;
      } catch (error) {
        const errorCode =
          error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
        if (errorCode === 'ENOENT') {
          continue;
        }
        fileDeleteErrors += 1;
      }
    }

    return {
      framesDeleted,
      filesDeleted,
      fileDeleteErrors,
    };
  }

  async summarizeDeviceFrames(deviceId: string): Promise<SpectrumFrameSummary> {
    const targetDeviceId = deviceId.trim();
    if (!this.mysql || !targetDeviceId) {
      return {
        totalFrames: 0,
        totalBytes: 0,
      };
    }

    const rows = await this.mysql.query<SpectrumSummaryRow>(
      `SELECT
         COUNT(*) AS total_frames,
         MAX(captured_at) AS latest_captured_at,
         COALESCE(SUM(file_size_bytes), 0) AS total_bytes
       FROM device_spectrum_frames
      WHERE device_id = ?`,
      [targetDeviceId],
    );
    const row = rows[0];
    const latestCapturedRaw = row?.latest_captured_at;

    return {
      totalFrames: Math.max(0, Math.floor(Number(row?.total_frames ?? 0))),
      latestCapturedAt:
        typeof latestCapturedRaw === 'string' || latestCapturedRaw instanceof Date
          ? new Date(toIsoTimestamp(latestCapturedRaw)).toISOString()
          : undefined,
      totalBytes: Math.max(0, Math.floor(Number(row?.total_bytes ?? 0))),
    };
  }

  private async resolveDeviceDataId(deviceId: string, telemetryUuid?: string): Promise<number | null> {
    if (!this.mysql || !telemetryUuid) {
      return null;
    }

    const normalizedTelemetryUuid = telemetryUuid.trim();
    if (!normalizedTelemetryUuid) {
      return null;
    }

    const rows = await this.mysql.query<{ id: number }>(
      `SELECT id
         FROM device_datas
        WHERE device_id = ? AND telemetry_uuid = ?
        ORDER BY received_at DESC, id DESC
        LIMIT 1`,
      [deviceId, normalizedTelemetryUuid],
    );
    const row = rows[0];
    return row && typeof row.id === 'number' ? row.id : null;
  }

  private findOrCreateFrame(point: TelemetrySpectrumMessage, timestampMs: number): PendingSpectrumFrame {
    if (point.telemetryUuid) {
      const uuidKey = `${point.deviceId}:uuid:${point.telemetryUuid}`;
      const existing = this.pendingFrames.get(uuidKey);
      if (existing) {
        return existing;
      }

      const frame: PendingSpectrumFrame = {
        key: uuidKey,
        deviceId: point.deviceId,
        telemetryUuid: point.telemetryUuid,
        capturedAtMs: timestampMs,
        axes: {},
        timer: null,
      };
      this.pendingFrames.set(uuidKey, frame);
      return frame;
    }

    for (const frame of this.pendingFrames.values()) {
      if (frame.deviceId !== point.deviceId || frame.telemetryUuid) {
        continue;
      }
      const distance = Math.abs(frame.capturedAtMs - timestampMs);
      if (distance <= this.matchWindowMs) {
        return frame;
      }
    }

    const fallbackKey = `${point.deviceId}:time:${timestampMs}:${randomUUID().slice(0, 8)}`;
    const frame: PendingSpectrumFrame = {
      key: fallbackKey,
      deviceId: point.deviceId,
      capturedAtMs: timestampMs,
      axes: {},
      timer: null,
    };
    this.pendingFrames.set(fallbackKey, frame);
    return frame;
  }

  private hasCompleteAxes(frame: PendingSpectrumFrame): boolean {
    return AXES.every((axis) => Boolean(frame.axes[axis]));
  }

  private clearPendingFramesForDevice(deviceId: string): void {
    for (const [key, frame] of this.pendingFrames.entries()) {
      if (frame.deviceId !== deviceId) {
        continue;
      }
      if (frame.timer) {
        clearTimeout(frame.timer);
      }
      this.pendingFrames.delete(key);
    }
  }

  private hasCompletePayloadAxes(payload: PersistedSpectrumPayload): boolean {
    return AXES.every((axis) => {
      const point = payload.axes?.[axis];
      return Boolean(point && Array.isArray(point.amplitudes) && point.amplitudes.length > 0);
    });
  }

  private scheduleFrameFlush(frameKey: string): void {
    const frame = this.pendingFrames.get(frameKey);
    if (!frame || frame.timer) {
      return;
    }

    frame.timer = setTimeout(() => {
      void this.finalizeFrame(frameKey);
    }, this.frameFlushMs);
  }

  private async finalizeFrame(frameKey: string): Promise<void> {
    const frame = this.pendingFrames.get(frameKey);
    if (!frame) {
      return;
    }

    if (frame.timer) {
      clearTimeout(frame.timer);
      frame.timer = null;
    }
    this.pendingFrames.delete(frameKey);

    if (!this.hasCompleteAxes(frame)) {
      return;
    }

    try {
      await this.persistFrame(frame);
    } catch (error) {
      console.warn('[spectrum-storage] persist failed', error);
    }
  }

  private async persistFrame(frame: PendingSpectrumFrame): Promise<void> {
    const axes: Record<SpectrumAxis, TelemetrySpectrumMessage | null> = {
      x: frame.axes.x ?? null,
      y: frame.axes.y ?? null,
      z: frame.axes.z ?? null,
    };

    const axisPoints = AXES.flatMap((axis) => (axes[axis] ? [axes[axis] as TelemetrySpectrumMessage] : []));
    if (axisPoints.length !== AXES.length) {
      return;
    }

    const capturedAtMs = Math.min(...axisPoints.map((point) => parseTimestamp(point.receivedAt)));
    const capturedAt = new Date(capturedAtMs).toISOString();
    const sampleRateHz = axisPoints.find((point) => typeof point.sampleRateHz === 'number')?.sampleRateHz;
    const binHz = axisPoints.find((point) => typeof point.binHz === 'number')?.binHz;
    const magnitudeUnit = axisPoints.find((point) => typeof point.magnitudeUnit === 'string')?.magnitudeUnit;
    const binCount = Math.max(1, ...axisPoints.map((point) => Math.max(1, Math.floor(point.binCount || 1))));

    const payload: PersistedSpectrumPayload = {
      version: 1,
      deviceId: frame.deviceId,
      capturedAt,
      telemetryUuid: frame.telemetryUuid,
      axes,
    };

    const now = new Date(capturedAtMs);
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const deviceSegment = sanitizePathSegment(frame.deviceId, 'device');
    const uuidSegment = sanitizePathSegment(frame.telemetryUuid ?? randomUUID(), 'frame');
    const fileName = `${capturedAtMs}_${uuidSegment}.json.gz`;
    const relativePath = join(deviceSegment, yyyy, mm, dd, fileName).replaceAll('\\', '/');
    const absolutePath = join(this.baseDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });

    const raw = Buffer.from(JSON.stringify(payload));
    const compressed = await gzipAsync(raw);
    const checksumSha256 = createHash('sha256').update(compressed).digest('hex');
    const temporaryPath = `${absolutePath}.tmp`;
    await writeFile(temporaryPath, compressed);
    await rename(temporaryPath, absolutePath);

    if (!this.mysql) {
      return;
    }

    const deviceDataId = await this.resolveDeviceDataId(frame.deviceId, frame.telemetryUuid);

    await this.mysql.execute(
      `INSERT INTO device_spectrum_frames (
         device_id,
         device_data_id,
         captured_at,
         telemetry_uuid,
         storage_path,
         file_size_bytes,
         checksum_sha256,
         bin_count,
         sample_rate_hz,
         bin_hz,
         magnitude_unit,
         peak_x_freq_hz,
         peak_x_amplitude,
         peak_y_freq_hz,
         peak_y_amplitude,
         peak_z_freq_hz,
         peak_z_amplitude,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         device_data_id = VALUES(device_data_id),
         captured_at = VALUES(captured_at),
         storage_path = VALUES(storage_path),
         file_size_bytes = VALUES(file_size_bytes),
         checksum_sha256 = VALUES(checksum_sha256),
         bin_count = VALUES(bin_count),
         sample_rate_hz = VALUES(sample_rate_hz),
         bin_hz = VALUES(bin_hz),
         magnitude_unit = VALUES(magnitude_unit),
         peak_x_freq_hz = VALUES(peak_x_freq_hz),
         peak_x_amplitude = VALUES(peak_x_amplitude),
         peak_y_freq_hz = VALUES(peak_y_freq_hz),
         peak_y_amplitude = VALUES(peak_y_amplitude),
         peak_z_freq_hz = VALUES(peak_z_freq_hz),
         peak_z_amplitude = VALUES(peak_z_amplitude)`,
      [
        frame.deviceId,
        deviceDataId,
        capturedAt,
        frame.telemetryUuid ?? null,
        relativePath,
        compressed.byteLength,
        checksumSha256,
        binCount,
        sampleRateHz ?? null,
        binHz ?? null,
        magnitudeUnit ?? null,
        axes.x?.peakFrequencyHz ?? null,
        axes.x?.peakAmplitude ?? null,
        axes.y?.peakFrequencyHz ?? null,
        axes.y?.peakAmplitude ?? null,
        axes.z?.peakFrequencyHz ?? null,
        axes.z?.peakAmplitude ?? null,
        new Date().toISOString(),
      ],
    );
  }

  private async readPersistedPayload(storagePath: string): Promise<PersistedSpectrumPayload | null> {
    try {
      const absolutePath = join(this.baseDir, storagePath);
      const compressed = await readFile(absolutePath);
      const raw = await gunzipAsync(compressed);
      const parsed = JSON.parse(raw.toString('utf8')) as PersistedSpectrumPayload;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.deviceId !== 'string' ||
        typeof parsed.capturedAt !== 'string' ||
        !parsed.axes ||
        typeof parsed.axes !== 'object'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
