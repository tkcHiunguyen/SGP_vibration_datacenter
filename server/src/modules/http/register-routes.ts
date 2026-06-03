import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { env } from '../../shared/config.js';
import type { CommandType, DeviceAxisLabels } from '../../shared/types.js';
import { AlertService } from '../alert/alert.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/index.js';
import { CommandService } from '../command/command.service.js';
import type { DataExportJob, DataExportJobRepository } from '../data-export/data-export-job.repository.js';
import { DeviceService } from '../device/device.service.js';
import type { MySqlPersistenceStatus } from '../persistence/mysql-access.js';
import type { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { SpectrumStorageService, type SpectrumArchiveFrame } from '../spectrum/spectrum-storage.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import type { TelemetryImportPoint } from '../telemetry/telemetry.repository.js';
import { ZoneService } from '../zone/zone.service.js';
import { registerCoreRoutes } from './core.routes.js';

type RegisterRoutesDeps = {
  app: FastifyInstance;
  authService: AuthService;
  deviceService: DeviceService;
  telemetryService: TelemetryService;
  alertService: AlertService;
  auditService: AuditService;
  commandService: CommandService;
  realtimeGateway: RealtimeGateway;
  zoneService: ZoneService;
  spectrumStorageService: SpectrumStorageService;
  dataExportJobRepository: DataExportJobRepository;
  dataExportJobWorkerRunId?: string;
  persistenceStatus: MySqlPersistenceStatus;
};

export function registerRoutes({
  app,
  authService,
  deviceService,
  telemetryService,
  alertService,
  auditService,
  commandService,
  realtimeGateway,
  zoneService,
  spectrumStorageService,
  dataExportJobRepository,
  dataExportJobWorkerRunId,
  persistenceStatus,
}: RegisterRoutesDeps): void {
  type AppRole = 'admin' | 'approver' | 'release_manager' | 'operator' | 'viewer';
  const deviceAxisLabelsSchema = z
    .object({
      ax: z.string().optional(),
      ay: z.string().optional(),
      az: z.string().optional(),
    })
    .optional();
  const deviceCreateSchema = z.object({
    deviceId: z.string().min(1),
    uuid: z.string().optional(),
    name: z.string().optional(),
    site: z.string().optional(),
    zone: z.string().optional(),
    firmwareVersion: z.string().optional(),
    axisLabels: deviceAxisLabelsSchema,
    notes: z.string().optional(),
  });

  const deviceUpdateSchema = z.object({
    uuid: z.string().optional(),
    name: z.string().optional(),
    site: z.string().optional(),
    zone: z.string().optional(),
    firmwareVersion: z.string().optional(),
    axisLabels: deviceAxisLabelsSchema,
    notes: z.string().optional(),
  });

  const placementConfigSchema = z.object({}).passthrough();
  const gzipAsync = promisify(gzip);
  const gunzipAsync = promisify(gunzip);
  const sgpDataExportQuerySchema = z.object({
    date_from: z.string().min(1),
    date_to: z.string().min(1),
    deviceId: z.string().min(1).optional(),
  });
  const sgpDataExportJobRequestSchema = z.object({
    date_from: z.string().min(1),
    date_to: z.string().min(1),
    deviceId: z.string().min(1).optional(),
  });
  const sgpDataExportJobParamsSchema = z.object({
    jobId: z.string().min(1),
  });
  const sgpDataExportJobListQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(100).optional(),
  });
  const sgpDataImportQuerySchema = z.object({
    mode: z.enum(['merge', 'idempotent']).optional().default('merge'),
  });
  const sgpDataDeviceSchema = z
    .object({
      deviceId: z.string().min(1),
      uuid: z.string().optional(),
      name: z.string().optional(),
      site: z.string().optional(),
      zone: z.string().optional(),
      firmwareVersion: z.string().optional(),
      axisLabels: deviceAxisLabelsSchema,
      notes: z.string().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .passthrough();
  const sgpDataTelemetryPointSchema = z
    .object({
      deviceId: z.string().min(1),
      receivedAt: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).default({}),
      telemetryUuid: z.string().optional(),
      sampleCount: z.number().optional(),
    })
    .passthrough();
  const sgpDataSpectrumFrameSchema = z
    .object({
      deviceId: z.string().min(1),
      capturedAt: z.string().min(1),
      telemetryUuid: z.string().optional(),
      storagePath: z.string().min(1),
      fileSizeBytes: z.number().optional(),
      checksumSha256: z.string().optional(),
      contentBase64: z.string().min(1),
    })
    .passthrough();
  const sgpDataDateRangeSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  });
  const sgpDataManifestSchema = z
    .object({
      format: z.literal('sgpdata'),
      version: z.literal(1),
      exportedAt: z.string().optional(),
      dateRange: sgpDataDateRangeSchema.optional(),
      deviceCount: z.number().optional(),
      measurementCount: z.number().optional(),
      spectrumFrameCount: z.number().optional(),
      placementConfigCount: z.number().optional(),
      checksumSha256: z.string().optional(),
    })
    .passthrough();
  const sgpDataArchiveSchema = z
    .object({
      manifest: sgpDataManifestSchema,
      devices: z.array(sgpDataDeviceSchema).default([]),
      measurements: z.array(sgpDataTelemetryPointSchema).default([]),
      spectrumFrames: z.array(sgpDataSpectrumFrameSchema).default([]),
      placementConfigs: z.record(z.string(), z.object({}).passthrough()).optional(),
    })
    .passthrough();
  type SgpDataArchive = z.infer<typeof sgpDataArchiveSchema>;
  type SgpDataDevice = z.infer<typeof sgpDataDeviceSchema>;
  type SgpDataTelemetryPoint = z.infer<typeof sgpDataTelemetryPointSchema>;
  type SgpDataExportResult = {
    compressed: Buffer;
    fileName: string;
    manifest: SgpDataArchive['manifest'];
  };

  const sgpDataExportDir = join(process.cwd(), 'storage', 'exports');
  const sgpDataExportJobTtlMs = 24 * 60 * 60 * 1000;
  const sgpDataExportConcurrency = 1;
  const sgpDataExportQueue: string[] = [];
  let sgpDataExportRunning = 0;
  let sgpDataExportDraining = false;

  function isAllowedDeviceProxyIp(ip: string): boolean {
    const normalized = ip.replace(/^::ffff:/, '').trim();
    if (isIP(normalized) === 0) {
      return false;
    }
    if (normalized === '127.0.0.1' || normalized === '::1' || normalized === '0.0.0.0') {
      return false;
    }
    if (/^(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.|169\.254\.)/.test(normalized)) {
      return true;
    }
    if (/^(fc|fd|fe80:)/i.test(normalized)) {
      return true;
    }
    return false;
  }

  function rewriteDeviceProxyHtml(html: string, proxyBasePath: string): string {
    const injectedBase = `<base href="${proxyBasePath}/">`;
    const withBase = /<head[^>]*>/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1>${injectedBase}`)
      : `${injectedBase}${html}`;
    return withBase.split('"/api/').join(`"${proxyBasePath}/api/`).split("'/api/").join(`'${proxyBasePath}/api/`);
  }

  function placementAxisLabelsFromConfig(config: Record<string, unknown>): { ax?: string; ay?: string; az?: string } | undefined {
    const rawLabels = config.chartAxisLabels;
    if (!rawLabels || typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
      return undefined;
    }

    const labels = rawLabels as Record<string, unknown>;
    const normalized: { ax?: string; ay?: string; az?: string } = {};
    for (const axis of ['ax', 'ay', 'az'] as const) {
      const label = typeof labels[axis] === 'string' ? labels[axis].trim() : '';
      if (label) {
        normalized[axis] = label;
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  const deviceListQuerySchema = z.object({
    site: z.string().optional(),
    zone: z.string().optional(),
    status: z.enum(['online', 'offline']).optional(),
    search: z.string().optional(),
  });

  const deviceHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(200).optional(),
  });

  const telemetryHistoryQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().positive().max(12_000).optional(),
    bucketMs: z.coerce.number().int().positive().max(86_400_000).optional(),
  });

  const deviceStatusHistoryQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().positive().max(5_000).optional(),
  });

  const telemetryAvailabilityQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    timezoneOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
    limitDays: z.coerce.number().int().positive().max(731).optional(),
  });

  const spectrumFrameQuerySchema = z.object({
    at: z.string().optional(),
    telemetryUuid: z.string().optional(),
  });

  const zoneListQuerySchema = z.object({
    search: z.string().optional(),
    descriptionFilter: z.enum(['all', 'with-description', 'without-description']).optional(),
    sortBy: z.enum(['updated-desc', 'name-asc', 'code-asc']).optional(),
    page: z.coerce.number().int().positive().max(10_000).optional(),
    pageSize: z.coerce.number().int().positive().max(200).optional(),
  });

  const zoneCreateSchema = z.object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(128),
    description: z.string().max(2_000).optional(),
  });

  const zoneUpdateSchema = z.object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(128).optional(),
    description: z.string().max(2_000).nullable().optional(),
  });

  const zoneDeleteQuerySchema = z.object({
    force: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => {
        if (value === undefined) {
          return false;
        }
        if (typeof value === 'boolean') {
          return value;
        }
        const normalized = value.trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
      }),
  });

  const alertRuleCreateSchema = z.object({
    name: z.string().min(1),
    metric: z.enum(['temperature', 'vibration']),
    threshold: z.number(),
    severity: z.enum(['warning', 'critical']),
    debounceCount: z.number().int().positive().optional(),
    cooldownMs: z.number().int().nonnegative().optional(),
    suppressionWindowMs: z.number().int().nonnegative().optional(),
    flappingWindowMs: z.number().int().positive().optional(),
    flappingThreshold: z.number().int().min(2).optional(),
    enabled: z.boolean().optional(),
    timeWindow: z
      .object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(0).max(23),
        timezone: z.string().min(1).optional(),
      })
      .nullable()
      .optional(),
  });

  const alertRuleUpdateSchema = alertRuleCreateSchema.partial();

  const alertListQuerySchema = z.object({
    status: z.enum(['active', 'acknowledged', 'resolved', 'all']).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

  const alertWorkflowNoteSchema = z.object({
    note: z.string().max(2_000).optional(),
  });

  const alertResolveSchema = z.object({
    note: z.string().min(1).max(2_000),
  });

  const auditListQuerySchema = z.object({
    deviceId: z.string().optional(),
    commandId: z.string().optional(),
    actor: z.string().optional(),
    action: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

  const deviceCommandTypeSchema = z.enum([
    'capture',
    'calibrate',
    'restart',
    'set_config',
    'ota',
    'ota_from_url',
  ]);

  const commandLookupSchema = z.object({
    commandIds: z.array(z.string().min(1)).min(1).max(500),
  });

  const otaDispatchSchema = z.object({
    deviceIds: z.array(z.string().min(1)).min(1).max(500),
    commandType: z.enum(['ota', 'ota_from_url']).default('ota'),
    otaUrl: z.string().trim().min(1),
    targetVersion: z.string().trim().optional(),
    note: z.string().trim().max(2_000).optional(),
  });

  const otaUploadDir = join(process.cwd(), 'uploads', 'ota');
  const otaUploadMaxBytes = 64 * 1024 * 1024;

  const authBypassEnabled = env.AUTH_BYPASS_GATING;

  function createBypassPrincipal() {
    return {
      role: 'admin' as const,
      scheme: 'api-key' as const,
      source: 'auth-bypass',
      tokenFingerprint: 'bypass',
      authenticatedAt: new Date().toISOString(),
    };
  }

  const authMeResponse = () => ({
    ok: true,
    data: {
      authenticated: authBypassEnabled,
      principal: authBypassEnabled ? createBypassPrincipal() : null,
      configured: authService.isConfigured(),
      defaultRole: authService.getDefaultRole(),
      configuredAccess: authService.listConfiguredAccess(),
      schemes: ['bearer', 'api-key'],
      bypassEnabled: authBypassEnabled,
    },
  });

  function authenticate(request: FastifyRequest) {
    return authService.authenticate(request.headers);
  }

  function principalActor(principal: ReturnType<typeof authenticate>): string {
    if (!principal) {
      return 'anonymous';
    }

    return `${principal.role}:${principal.tokenFingerprint}`;
  }

  function requireRole(
    request: FastifyRequest,
    reply: FastifyReply,
    requiredRole: AppRole,
  ) {
    if (authBypassEnabled) {
      return createBypassPrincipal();
    }

    const principal = authenticate(request);
    if (!principal) {
      void reply.code(401).send({ ok: false, error: 'unauthorized' });
      return null;
    }

    if (!authService.authorize(principal, requiredRole)) {
      void reply.code(403).send({ ok: false, error: 'forbidden', requiredRole });
      return null;
    }

    return principal;
  }

  function summarize(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function parseSgpDataDateRange(from: string, to: string): { from: string; to: string } | null {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
      return null;
    }
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    };
  }

  function optionalText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  function normalizeArchiveTelemetryUuid(deviceId: string, receivedAt: string, point: SgpDataTelemetryPoint): string {
    const fromPoint = optionalText(point.telemetryUuid);
    if (fromPoint) {
      return fromPoint.slice(0, 255);
    }
    const fromPayload = optionalText(point.payload.telemetry_uuid) ?? optionalText(point.payload.telemetryUuid);
    if (fromPayload) {
      return fromPayload.slice(0, 255);
    }
    return `sgp-time:${deviceId}:${receivedAt}`.slice(0, 255);
  }

  function normalizeArchiveTelemetryPoint(point: SgpDataTelemetryPoint): TelemetryImportPoint | null {
    const deviceId = point.deviceId.trim();
    const receivedAtMs = Date.parse(point.receivedAt);
    if (!deviceId || Number.isNaN(receivedAtMs)) {
      return null;
    }
    const receivedAt = new Date(receivedAtMs).toISOString();
    const telemetryUuid = normalizeArchiveTelemetryUuid(deviceId, receivedAt, point);
    return {
      deviceId,
      receivedAt,
      payload: {
        ...point.payload,
        telemetry_uuid: telemetryUuid,
        telemetryUuid,
      },
      telemetryUuid,
      sampleCount: typeof point.sampleCount === 'number' && Number.isFinite(point.sampleCount)
        ? Math.max(0, Math.floor(point.sampleCount))
        : undefined,
    };
  }

  function normalizeArchiveSpectrumFrame(frame: SpectrumArchiveFrame): SpectrumArchiveFrame | null {
    const deviceId = frame.deviceId.trim();
    const capturedAtMs = Date.parse(frame.capturedAt);
    if (!deviceId || Number.isNaN(capturedAtMs) || !frame.storagePath.trim() || !frame.contentBase64.trim()) {
      return null;
    }
    const capturedAt = new Date(capturedAtMs).toISOString();
    const telemetryUuid = optionalText(frame.telemetryUuid) ?? `sgp-frame:${deviceId}:${capturedAt}`;
    return {
      ...frame,
      deviceId,
      capturedAt,
      telemetryUuid: telemetryUuid.slice(0, 255),
    };
  }

  function sgpDataChecksumPayload(archive: Pick<SgpDataArchive, 'devices' | 'measurements' | 'spectrumFrames' | 'placementConfigs'>): string {
    return JSON.stringify({
      devices: archive.devices,
      measurements: archive.measurements,
      spectrumFrames: archive.spectrumFrames,
      placementConfigs: archive.placementConfigs ?? {},
    });
  }

  function createSgpDataChecksum(archive: Pick<SgpDataArchive, 'devices' | 'measurements' | 'spectrumFrames' | 'placementConfigs'>): string {
    return createHash('sha256').update(sgpDataChecksumPayload(archive)).digest('hex');
  }

  function clampExportProgress(progress: number): number {
    if (!Number.isFinite(progress)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  function sanitizeExportFilePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80);
  }

  function toSgpDataExportJobResponse(job: DataExportJob) {
    return {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      range: job.range,
      deviceId: job.deviceId,
      fileName: job.fileName,
      sizeBytes: job.sizeBytes,
      error: job.error,
      manifest: job.manifest,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
    };
  }

  async function updateSgpDataExportJob(job: DataExportJob, patch: Partial<DataExportJob>): Promise<void> {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    job.progress = clampExportProgress(job.progress);
    await dataExportJobRepository.update(job);
  }

  async function cleanupSgpDataExportJobs(): Promise<void> {
    const expiredJobs = await dataExportJobRepository.deleteExpired(new Date().toISOString());
    for (const job of expiredJobs) {
      if (job.filePath) {
        await unlink(job.filePath).catch(() => undefined);
      }
    }
  }

  async function buildSgpDataExportArchive({
    range,
    deviceId,
    actor,
    onProgress,
  }: {
    range: DataExportJob['range'];
    deviceId?: string;
    actor: string;
    onProgress?: (progress: number, stage: string) => void | Promise<void>;
  }): Promise<SgpDataExportResult> {
    await onProgress?.(8, 'Đang tải danh sách thiết bị');
    const deviceMetadata = deviceId
      ? [deviceService.getMetadata(deviceId)].filter((device): device is NonNullable<typeof device> => Boolean(device))
      : deviceService.list().map((device) => device.metadata).filter((device): device is NonNullable<typeof device> => Boolean(device));
    if (deviceId && deviceMetadata.length === 0) {
      throw new Error('device_not_found');
    }

    await onProgress?.(22, 'Đang xuất telemetry');
    const measurements = await telemetryService.exportHistory({
      from: range.from,
      to: range.to,
      deviceId,
    });

    await onProgress?.(48, 'Đang xuất phổ FFT');
    const spectrumFrames = (
      await Promise.all(deviceMetadata.map((device) => spectrumStorageService.exportFrames(device.deviceId, range.from, range.to)))
    ).flat();

    await onProgress?.(66, 'Đang gom cấu hình thiết bị');
    const selectedDeviceIds = new Set<string>([
      ...measurements.map((point) => point.deviceId),
      ...spectrumFrames.map((frame) => frame.deviceId),
    ]);
    if (deviceId) {
      selectedDeviceIds.add(deviceId);
    }
    const devices = deviceMetadata.filter((device) => selectedDeviceIds.has(device.deviceId));
    const placementConfigs: Record<string, Record<string, unknown>> = {};
    for (const device of devices) {
      const config = await spectrumStorageService.readPlacementConfig(device.deviceId);
      if (config) {
        placementConfigs[device.deviceId] = config;
      }
    }

    const archive: SgpDataArchive = {
      manifest: {
        format: 'sgpdata',
        version: 1,
        exportedAt: new Date().toISOString(),
        dateRange: range,
        deviceCount: devices.length,
        measurementCount: measurements.length,
        spectrumFrameCount: spectrumFrames.length,
        placementConfigCount: Object.keys(placementConfigs).length,
      },
      devices,
      measurements,
      spectrumFrames,
      placementConfigs,
    };
    archive.manifest.checksumSha256 = createSgpDataChecksum(archive);

    await onProgress?.(82, 'Đang nén gói dữ liệu');
    const body = Buffer.from(JSON.stringify(archive));
    const compressed = await gzipAsync(body);
    const suffix = `${range.from.slice(0, 10)}_${range.to.slice(0, 10)}`;
    const deviceSuffix = deviceId ? `_${sanitizeExportFilePart(deviceId)}` : '';
    const fileName = `sgp-data${deviceSuffix}_${suffix}.sgpdata`;

    auditService.record({
      action: 'sgpdata_export',
      deviceId: deviceId ?? 'n/a',
      commandId: 'n/a',
      actor,
      result: 'exported',
      metadata: {
        dateRange: range,
        deviceCount: devices.length,
        measurementCount: measurements.length,
        spectrumFrameCount: spectrumFrames.length,
        sizeBytes: compressed.byteLength,
      },
    });

    return { compressed, fileName, manifest: archive.manifest };
  }

  async function runSgpDataExportJob(job: DataExportJob, actor: string): Promise<void> {
    try {
      const startedAt = new Date().toISOString();
      await updateSgpDataExportJob(job, {
        status: 'running',
        progress: 3,
        stage: 'Đang khởi tạo export',
        startedAt,
        workerRunId: dataExportJobWorkerRunId,
      });
      const result = await buildSgpDataExportArchive({
        range: job.range,
        deviceId: job.deviceId,
        actor,
        onProgress: (progress, stage) => updateSgpDataExportJob(job, { progress, stage }),
      });
      await updateSgpDataExportJob(job, { progress: 92, stage: 'Đang ghi file export' });
      await mkdir(sgpDataExportDir, { recursive: true });
      const filePath = join(sgpDataExportDir, `${job.jobId}-${result.fileName}`);
      await writeFile(filePath, result.compressed);
      const completedAt = new Date().toISOString();
      await updateSgpDataExportJob(job, {
        status: 'completed',
        progress: 100,
        stage: 'Hoàn tất',
        fileName: result.fileName,
        filePath,
        sizeBytes: result.compressed.byteLength,
        manifest: { ...result.manifest },
        completedAt,
      });
    } catch (error) {
      await updateSgpDataExportJob(job, {
        status: 'failed',
        progress: 100,
        stage: 'Export thất bại',
        error: error instanceof Error ? error.message : 'sgpdata_export_failed',
        completedAt: new Date().toISOString(),
      });
    }
  }

  function enqueueSgpDataExportJob(jobId: string): void {
    if (!sgpDataExportQueue.includes(jobId)) {
      sgpDataExportQueue.push(jobId);
    }
    void drainSgpDataExportQueue();
  }

  async function drainSgpDataExportQueue(): Promise<void> {
    if (sgpDataExportDraining) {
      return;
    }

    sgpDataExportDraining = true;
    try {
      while (sgpDataExportRunning < sgpDataExportConcurrency && sgpDataExportQueue.length > 0) {
        const jobId = sgpDataExportQueue.shift();
        if (!jobId) {
          continue;
        }
        const job = await dataExportJobRepository.get(jobId);
        if (!job || job.status !== 'queued') {
          continue;
        }

        sgpDataExportRunning += 1;
        void runSgpDataExportJob(job, job.createdBy ?? 'anonymous').finally(() => {
          sgpDataExportRunning = Math.max(0, sgpDataExportRunning - 1);
          void drainSgpDataExportQueue();
        });
      }
    } finally {
      sgpDataExportDraining = false;
      if (sgpDataExportRunning < sgpDataExportConcurrency && sgpDataExportQueue.length > 0) {
        void drainSgpDataExportQueue();
      }
    }
  }

  async function parseSgpDataArchiveBuffer(buffer: Buffer): Promise<SgpDataArchive> {
    let raw: Buffer;
    try {
      raw = await gunzipAsync(buffer);
    } catch {
      raw = buffer;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new Error('sgpdata_json_invalid');
    }
    const archive = sgpDataArchiveSchema.parse(parsed);
    if (archive.manifest.checksumSha256) {
      const checksum = createSgpDataChecksum(archive);
      if (checksum !== archive.manifest.checksumSha256) {
        throw new Error('sgpdata_checksum_mismatch');
      }
    }
    return archive;
  }

  async function readSgpDataArchiveUpload(request: FastifyRequest): Promise<{ archive: SgpDataArchive; filename: string; sizeBytes: number }> {
    const multipartRequest = request as FastifyRequest & {
      file: () => Promise<
        | {
            filename: string;
            mimetype: string;
            toBuffer: () => Promise<Buffer>;
          }
        | undefined
      >;
    };
    const filePart = await multipartRequest.file();
    if (!filePart) {
      throw new Error('sgpdata_file_required');
    }
    const filename = filePart.filename || 'import.sgpdata';
    if (!filename.toLowerCase().endsWith('.sgpdata')) {
      throw new Error('sgpdata_file_extension_invalid');
    }
    const buffer = await filePart.toBuffer();
    if (buffer.length === 0) {
      throw new Error('sgpdata_file_empty');
    }
    return {
      archive: await parseSgpDataArchiveBuffer(buffer),
      filename,
      sizeBytes: buffer.length,
    };
  }

  function sgpDataImportError(error: unknown): string {
    if (error instanceof z.ZodError) {
      return 'sgpdata_schema_invalid';
    }
    return error instanceof Error ? error.message : 'sgpdata_invalid';
  }

  function createSgpDataPreview(archive: SgpDataArchive) {
    const dateRange = archive.manifest.dateRange;
    return {
      manifest: archive.manifest,
      metadata: {
        deviceCount: archive.devices.length,
        measurementCount: archive.measurements.length,
        spectrumCount: archive.spectrumFrames.length,
        placementConfigCount: Object.keys(archive.placementConfigs ?? {}).length,
        dateFrom: dateRange?.from,
        dateTo: dateRange?.to,
        checksumSha256: archive.manifest.checksumSha256,
      },
      dateRange,
      devices: archive.devices.map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        site: device.site,
        zone: device.zone,
        firmwareVersion: device.firmwareVersion,
      })),
      measurements: archive.measurements.length,
      spectra: archive.spectrumFrames.length,
    };
  }

  function normalizeDeviceAxisLabels(labels: unknown): DeviceAxisLabels | undefined {
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
      return undefined;
    }
    const raw = labels as Record<string, unknown>;
    const normalized: DeviceAxisLabels = {};
    for (const axis of ['ax', 'ay', 'az'] as const) {
      const label = optionalText(raw[axis]);
      if (label) {
        normalized[axis] = label;
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  function normalizeSgpDataDevice(deviceId: string, device?: SgpDataDevice) {
    return {
      deviceId,
      uuid: optionalText(device?.uuid),
      name: optionalText(device?.name) ?? deviceId,
      site: optionalText(device?.site),
      zone: optionalText(device?.zone),
      firmwareVersion: optionalText(device?.firmwareVersion),
      axisLabels: normalizeDeviceAxisLabels(device?.axisLabels),
      notes: optionalText(device?.notes),
      createdAt: optionalText(device?.createdAt),
      updatedAt: optionalText(device?.updatedAt),
    };
  }

  function isOtaCommandType(type: CommandType): type is 'ota' | 'ota_from_url' {
    return type === 'ota' || type === 'ota_from_url';
  }

  function resolveCommandTypeFromPayload(payload: Record<string, unknown>): CommandType {
    const rawType = typeof payload.type === 'string' ? payload.type : payload.command;
    if (rawType === 'ota' || rawType === 'ota_from_url') {
      return rawType;
    }
    return 'set_config';
  }

  function extractCommandOtaUrl(payload: Record<string, unknown>): string | undefined {
    const otaUrl = typeof payload.otaUrl === 'string' ? payload.otaUrl.trim() : '';
    if (otaUrl) {
      return otaUrl;
    }
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    if (url) {
      return url;
    }
    return undefined;
  }

  function normalizeCommandPayloadForDevice(
    commandType: CommandType,
    deviceId: string,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const metadata = deviceService.getMetadata(deviceId);
    const normalized: Record<string, unknown> = { ...payload };
    if (isOtaCommandType(commandType)) {
      normalized.deviceId = deviceId;
      if (typeof normalized.uuid !== 'string' || normalized.uuid.trim() === '') {
        if (metadata?.uuid) {
          normalized.uuid = metadata.uuid;
        }
      }
      const otaUrl = extractCommandOtaUrl(normalized);
      if (otaUrl) {
        normalized.otaUrl = otaUrl;
      }
      if (typeof normalized.command !== 'string' || normalized.command.trim() === '') {
        normalized.command = commandType;
      }
      if (typeof normalized.type !== 'string' || normalized.type.trim() === '') {
        normalized.type = commandType;
      }
    }
    return normalized;
  }

  function validateCommandPayload(
    commandType: CommandType,
    payload: Record<string, unknown>,
  ): { ok: true } | { ok: false; error: string; field?: string } {
    if (!isOtaCommandType(commandType)) {
      return { ok: true };
    }

    const otaUrl = extractCommandOtaUrl(payload);
    if (!otaUrl) {
      return {
        ok: false,
        error: 'ota_url_required',
        field: 'otaUrl|url',
      };
    }
    return { ok: true };
  }

  function normalizeDeviceIdList(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  function normalizeBaseUrl(raw: string, protocol: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
      return '';
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/\/+$/, '');
    }
    return `${protocol}://${trimmed}`.replace(/\/+$/, '');
  }

  function listLocalLanIps(): string[] {
    const ips: string[] = [];
    const nets = networkInterfaces();
    for (const interfaces of Object.values(nets)) {
      if (!interfaces || interfaces.length === 0) {
        continue;
      }
      for (const entry of interfaces) {
        if (entry.family === 'IPv4' && !entry.internal) {
          ips.push(entry.address);
        }
      }
    }
    return ips;
  }

  function resolveLocalLanIp(): string | undefined {
    return listLocalLanIps()[0];
  }

  function sameIpv4Slash24(a: string, b: string): boolean {
    const left = a.replace(/^::ffff:/, '').split('.');
    const right = b.replace(/^::ffff:/, '').split('.');
    return left.length === 4 && right.length === 4 && left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
  }

  function resolveDeviceReachableBaseUrl(deviceIp: string, sourceUrl: string): string | undefined {
    const normalizedDeviceIp = deviceIp.replace(/^::ffff:/, '').trim();
    if (!normalizedDeviceIp || isIP(normalizedDeviceIp) !== 4) {
      return undefined;
    }
    const localIp = listLocalLanIps().find((ip) => sameIpv4Slash24(ip, normalizedDeviceIp));
    if (!localIp) {
      return undefined;
    }
    try {
      const parsed = new URL(sourceUrl);
      const port = parsed.port || String(env.PORT);
      return `${parsed.protocol}//${localIp}${port ? `:${port}` : ''}`.replace(/\/+$/, '');
    } catch {
      return `http://${localIp}:${env.PORT}`;
    }
  }

  function resolveDeviceOtaUrl(deviceId: string, otaUrl: string): string {
    const session = deviceService.get(deviceId);
    const deviceIp = session?.clientIp?.replace(/^::ffff:/, '').trim();
    if (!deviceIp) {
      return otaUrl;
    }
    let parsed: URL;
    try {
      parsed = new URL(otaUrl);
    } catch {
      return otaUrl;
    }
    if (!parsed.pathname.startsWith('/ota-bins/')) {
      return otaUrl;
    }
    const deviceBaseUrl = resolveDeviceReachableBaseUrl(deviceIp, otaUrl);
    if (!deviceBaseUrl) {
      return otaUrl;
    }
    return `${deviceBaseUrl}${parsed.pathname}${parsed.search}`;
  }

  function isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
  }

  function resolvePublicBaseUrl(request: FastifyRequest): string {
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol =
      typeof forwardedProto === 'string' && forwardedProto.trim()
        ? forwardedProto.split(',')[0]!.trim()
        : request.protocol || 'http';
    const configuredBaseUrl = normalizeBaseUrl(env.OTA_PUBLIC_BASE_URL ?? '', protocol);
    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }

    const forwardedHost = request.headers['x-forwarded-host'];
    let host =
      typeof forwardedHost === 'string' && forwardedHost.trim()
        ? forwardedHost.split(',')[0]!.trim()
        : request.headers.host || `127.0.0.1:${env.PORT}`;

    try {
      const parsed = new URL(`${protocol}://${host}`);
      if (isLoopbackHostname(parsed.hostname)) {
        const lanIp = resolveLocalLanIp();
        if (lanIp) {
          host = parsed.port ? `${lanIp}:${parsed.port}` : lanIp;
        }
      }
    } catch {
      // Keep fallback host if header cannot be parsed.
    }

    return `${protocol}://${host}`;
  }

  function createOtaUploadFileName(originalName: string): string {
    const normalizedName = originalName
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const base = normalizedName.endsWith('.bin')
      ? normalizedName.slice(0, -4)
      : normalizedName || 'firmware';
    return `ota_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${base}.bin`;
  }

  function workflowNotReady(reply: FastifyReply, feature: string) {
    return reply.code(501).send({
      ok: false,
      error: 'workflow_not_ready',
      feature,
    });
  }

  function workflowValidationError(
    reply: FastifyReply,
    action: string,
    reason: string,
    details?: Record<string, unknown>,
  ) {
    return reply.code(422).send({
      ok: false,
      error: 'workflow_validation_failed',
      action,
      reason,
      details,
    });
  }

  function workflowResourceNotFound(
    reply: FastifyReply,
    action: string,
    reason: string,
    details?: Record<string, unknown>,
  ) {
    return reply.code(404).send({
      ok: false,
      error: 'workflow_resource_not_found',
      action,
      reason,
      details,
    });
  }

  function workflowTransitionBlocked(
    reply: FastifyReply,
    action: string,
    reason: string,
    details?: Record<string, unknown>,
  ) {
    return reply.code(409).send({
      ok: false,
      error: 'workflow_transition_blocked',
      action,
      reason,
      details,
    });
  }

  registerCoreRoutes({
    app,
    authService,
    deviceService,
    alertService,
    realtimeGateway,
    persistenceStatus,
  });

  app.post('/api/sgpdata/export/jobs', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const queryResult = sgpDataExportJobRequestSchema.safeParse(request.body ?? {});
    if (!queryResult.success) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_date_range_required' });
    }
    const query = queryResult.data;
    const range = parseSgpDataDateRange(query.date_from, query.date_to);
    if (!range) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_date_range_invalid' });
    }

    if (query.deviceId && !deviceService.getMetadata(query.deviceId)) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    await cleanupSgpDataExportJobs();
    const now = new Date().toISOString();
    const job: DataExportJob = {
      jobId: randomUUID(),
      status: 'queued',
      progress: 0,
      stage: 'Đang chờ export',
      createdAt: now,
      updatedAt: now,
      range,
      deviceId: query.deviceId,
      createdBy: principalActor(principal),
      expiresAt: new Date(Date.now() + sgpDataExportJobTtlMs).toISOString(),
    };
    await dataExportJobRepository.save(job);
    enqueueSgpDataExportJob(job.jobId);

    return reply.code(202).send({ ok: true, data: toSgpDataExportJobResponse(job) });
  });

  app.get('/api/sgpdata/export/jobs', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const queryResult = sgpDataExportJobListQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_export_job_query_invalid' });
    }
    await cleanupSgpDataExportJobs();
    const jobs = await dataExportJobRepository.list(queryResult.data.limit ?? 20);
    return reply.send({ ok: true, data: { items: jobs.map(toSgpDataExportJobResponse) } });
  });

  app.get('/api/sgpdata/export/jobs/:jobId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const params = sgpDataExportJobParamsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_job_id_required' });
    }
    await cleanupSgpDataExportJobs();
    const job = await dataExportJobRepository.get(params.data.jobId);
    if (!job) {
      return reply.code(404).send({ ok: false, error: 'sgpdata_export_job_not_found' });
    }
    return reply.send({ ok: true, data: toSgpDataExportJobResponse(job) });
  });

  app.get('/api/sgpdata/export/jobs/:jobId/download', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const params = sgpDataExportJobParamsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_job_id_required' });
    }
    await cleanupSgpDataExportJobs();
    const job = await dataExportJobRepository.get(params.data.jobId);
    if (!job) {
      return reply.code(404).send({ ok: false, error: 'sgpdata_export_job_not_found' });
    }
    if (job.status !== 'completed' || !job.filePath || !job.fileName) {
      return reply.code(409).send({ ok: false, error: 'sgpdata_export_job_not_ready', data: toSgpDataExportJobResponse(job) });
    }
    const fileStat = await stat(job.filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return reply.code(404).send({ ok: false, error: 'sgpdata_export_file_not_found', data: toSgpDataExportJobResponse(job) });
    }
    reply.header('content-type', 'application/vnd.sgpdata');
    reply.header('content-disposition', `attachment; filename="${job.fileName}"`);
    reply.header('cache-control', 'no-store');
    reply.header('content-length', String(job.sizeBytes ?? fileStat.size));
    return reply.send(createReadStream(job.filePath));
  });

  app.get('/api/sgpdata/export', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const queryResult = sgpDataExportQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_date_range_required' });
    }
    const query = queryResult.data;
    const range = parseSgpDataDateRange(query.date_from, query.date_to);
    if (!range) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_date_range_invalid' });
    }

    const result = await buildSgpDataExportArchive({
      range,
      deviceId: query.deviceId,
      actor: principalActor(principal),
    });
    reply.header('content-type', 'application/vnd.sgpdata');
    reply.header('content-disposition', `attachment; filename="${result.fileName}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(result.compressed);
  });

  app.post('/api/sgpdata/import/preview', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) {
      return;
    }
    try {
      const { archive, filename, sizeBytes } = await readSgpDataArchiveUpload(request);
      return {
        ok: true,
        data: {
          ...createSgpDataPreview(archive),
          file: {
            name: filename,
            sizeBytes,
          },
        },
      };
    } catch (error) {
      return reply.code(422).send({ ok: false, error: sgpDataImportError(error) });
    }
  });

  app.post('/api/sgpdata/import', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const queryResult = sgpDataImportQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.code(422).send({ ok: false, error: 'sgpdata_import_mode_invalid' });
    }
    const query = queryResult.data;
    let archive: SgpDataArchive;
    let filename = 'import.sgpdata';
    let sizeBytes = 0;
    try {
      const upload = await readSgpDataArchiveUpload(request);
      archive = upload.archive;
      filename = upload.filename;
      sizeBytes = upload.sizeBytes;
    } catch (error) {
      return reply.code(422).send({ ok: false, error: sgpDataImportError(error) });
    }

    const archiveDeviceById = new Map(archive.devices.map((device) => [device.deviceId.trim(), device]));
    const referencedDeviceIds = new Set<string>();
    for (const device of archive.devices) {
      if (device.deviceId.trim()) {
        referencedDeviceIds.add(device.deviceId.trim());
      }
    }
    for (const point of archive.measurements) {
      if (point.deviceId.trim()) {
        referencedDeviceIds.add(point.deviceId.trim());
      }
    }
    for (const frame of archive.spectrumFrames) {
      if (frame.deviceId.trim()) {
        referencedDeviceIds.add(frame.deviceId.trim());
      }
    }

    const deviceImport = { inserted: 0, updated: 0, skipped: 0 };
    const importableDeviceIds = new Set<string>();
    for (const deviceId of referencedDeviceIds) {
      const before = deviceService.getMetadata(deviceId);
      const imported = archiveDeviceById.get(deviceId);
      try {
        await deviceService.importMetadataStrict(normalizeSgpDataDevice(deviceId, imported));
        before ? (deviceImport.updated += 1) : (deviceImport.inserted += 1);
        importableDeviceIds.add(deviceId);
      } catch {
        try {
          await deviceService.importMetadataStrict({
            ...normalizeSgpDataDevice(deviceId, imported),
            uuid: '',
            zone: '',
          });
          before ? (deviceImport.updated += 1) : (deviceImport.inserted += 1);
          importableDeviceIds.add(deviceId);
        } catch {
          deviceImport.skipped += 1;
        }
      }
    }

    const measurements = archive.measurements
      .map((point) => normalizeArchiveTelemetryPoint(point))
      .filter((point): point is TelemetryImportPoint => point !== null)
      .filter((point) => importableDeviceIds.has(point.deviceId));
    const telemetryImport = await telemetryService.importHistory(measurements);

    const placementImport = { written: 0, skipped: 0 };
    for (const [deviceId, config] of Object.entries(archive.placementConfigs ?? {})) {
      if (!importableDeviceIds.has(deviceId)) {
        placementImport.skipped += 1;
        continue;
      }
      try {
        await spectrumStorageService.writePlacementConfig(deviceId, config);
        placementImport.written += 1;
      } catch {
        placementImport.skipped += 1;
      }
    }

    const spectrumFrames = archive.spectrumFrames
      .map((frame) => normalizeArchiveSpectrumFrame(frame))
      .filter((frame): frame is SpectrumArchiveFrame => frame !== null)
      .filter((frame) => importableDeviceIds.has(frame.deviceId));
    const spectrumImport = await spectrumStorageService.importFrames(spectrumFrames);

    auditService.record({
      action: 'sgpdata_import',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'imported',
      metadata: {
        fileName: filename,
        sizeBytes,
        mode: query.mode,
        deviceImport,
        telemetryImport,
        spectrumImport,
        placementImport,
      },
    });
    return {
      ok: true,
      data: {
        imported: true,
        fileName: filename,
        sizeBytes,
        mode: query.mode,
        devices: deviceImport,
        measurements: telemetryImport,
        spectrum: spectrumImport,
        placementConfigs: placementImport,
        preview: createSgpDataPreview(archive),
      },
    };
  });

  app.get('/api/devices/last-telemetry', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    return {
      ok: true,
      data: telemetryService.getLast(),
    };
  });

  app.get('/api/zones', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const query = zoneListQuerySchema.parse(request.query);
    const [listing, summary] = await Promise.all([
      zoneService.listPage({
        search: query.search,
        descriptionFilter: query.descriptionFilter ?? 'all',
        sortBy: query.sortBy ?? 'updated-desc',
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      }),
      zoneService.summary(),
    ]);
    return {
      ok: true,
      data: listing.items,
      meta: {
        total: listing.total,
        page: listing.page,
        pageSize: listing.pageSize,
        totalPages: listing.totalPages,
      },
      summary,
    };
  });

  app.get('/api/zones/:zoneId', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const { zoneId } = z.object({ zoneId: z.coerce.number().int().positive() }).parse(request.params);
    const zone = await zoneService.get(zoneId);
    if (!zone) {
      return reply.code(404).send({ ok: false, error: 'zone_not_found' });
    }
    return {
      ok: true,
      data: zone,
    };
  });

  app.post('/api/zones', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const body = zoneCreateSchema.parse(request.body ?? {});
    const created = await zoneService.create(body);
    auditService.record({
      action: 'zone_create',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'created',
      metadata: {
        targetResource: {
          resourceType: 'zone',
          resourceId: String(created.id),
          resourceName: created.name,
        },
        afterSummary: summarize(created),
      },
    });
    return reply.code(201).send({
      ok: true,
      data: created,
    });
  });

  app.put('/api/zones/:zoneId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const { zoneId } = z.object({ zoneId: z.coerce.number().int().positive() }).parse(request.params);
    const before = await zoneService.get(zoneId);
    if (!before) {
      return reply.code(404).send({ ok: false, error: 'zone_not_found' });
    }
    const body = zoneUpdateSchema.parse(request.body ?? {});
    const updated = await zoneService.update(zoneId, body);
    if (!updated) {
      return reply.code(404).send({ ok: false, error: 'zone_not_found' });
    }
    auditService.record({
      action: 'zone_update',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'updated',
      metadata: {
        targetResource: {
          resourceType: 'zone',
          resourceId: String(updated.id),
          resourceName: updated.name,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
      },
    });
    return {
      ok: true,
      data: updated,
    };
  });

  app.get('/api/zones/:zoneId/impact', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const { zoneId } = z.object({ zoneId: z.coerce.number().int().positive() }).parse(request.params);
    const zone = await zoneService.get(zoneId);
    if (!zone) {
      return reply.code(404).send({ ok: false, error: 'zone_not_found' });
    }

    const deviceIds = deviceService.listDeviceIdsByZone(zone.code);
    return {
      ok: true,
      data: {
        zoneId: zone.id,
        zoneCode: zone.code,
        deviceCount: deviceIds.length,
        deviceIds: deviceIds.slice(0, 100),
      },
    };
  });

  app.delete('/api/zones/:zoneId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const { zoneId } = z.object({ zoneId: z.coerce.number().int().positive() }).parse(request.params);
    const query = zoneDeleteQuerySchema.parse(request.query ?? {});
    const zone = await zoneService.get(zoneId);
    if (!zone) {
      return reply.code(404).send({ ok: false, error: 'zone_not_found' });
    }

    const impactedDeviceIds = deviceService.listDeviceIdsByZone(zone.code);
    if (impactedDeviceIds.length > 0 && !query.force) {
      return reply.code(409).send({
        ok: false,
        error: 'zone_has_devices',
        data: {
          zoneId: zone.id,
          zoneCode: zone.code,
          deviceCount: impactedDeviceIds.length,
          deviceIds: impactedDeviceIds.slice(0, 100),
        },
      });
    }

    let clearedAssignments = 0;
    if (impactedDeviceIds.length > 0) {
      const cleared = await deviceService.clearZoneAssignments(zone.code);
      clearedAssignments = cleared.updated;
    }

    const removed = await zoneService.remove(zoneId);
    if (!removed) {
      return reply.code(404).send({ ok: false, error: 'zone_not_found' });
    }
    auditService.record({
      action: 'zone_delete',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'deleted',
      metadata: {
        targetResource: {
          resourceType: 'zone',
          resourceId: String(zone.id),
          resourceName: zone.name,
        },
        beforeSummary: summarize(zone),
        impactedDeviceCount: impactedDeviceIds.length,
        clearedAssignments,
        force: query.force,
      },
    });
    return {
      ok: true,
      data: {
        deleted: true,
        zoneId,
        force: query.force,
        impactedDeviceCount: impactedDeviceIds.length,
        clearedAssignments,
      },
    };
  });

  app.get('/api/devices', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const filters = deviceListQuerySchema.parse(request.query);
    return {
      ok: true,
      data: deviceService.list(filters),
    };
  });

  app.all('/api/devices/:deviceId/ui-proxy/*', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const params = request.params as { deviceId: string; '*': string };
    const session = deviceService.get(params.deviceId);
    const clientIp = session?.clientIp?.replace(/^::ffff:/, '').trim();
    if (!clientIp) {
      return reply.code(404).send({ ok: false, error: 'device_offline_or_no_ip' });
    }
    if (!isAllowedDeviceProxyIp(clientIp)) {
      return reply.code(403).send({ ok: false, error: 'device_ip_not_allowed' });
    }

    const rawPath = params['*'] || '';
    const safePath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
    const queryIndex = request.url.indexOf('?');
    const query = queryIndex >= 0 ? request.url.slice(queryIndex) : '';
    const targetUrl = `http://${clientIp}/${safePath}${query}`;
    const headers = new Headers();
    const contentType = request.headers['content-type'];
    if (typeof contentType === 'string') {
      headers.set('content-type', contentType);
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.body ?? {}),
        signal: AbortSignal.timeout(8_000),
        redirect: 'manual',
      });
      const responseContentType = upstream.headers.get('content-type') || 'application/octet-stream';
      reply.code(upstream.status);
      reply.header('content-type', responseContentType);
      reply.header('cache-control', 'no-store');
      const location = upstream.headers.get('location');
      if (location) {
        reply.header('location', `/api/devices/${encodeURIComponent(params.deviceId)}/ui-proxy/${location.replace(/^https?:\/\/[^/]+\//, '')}`);
      }
      if (responseContentType.includes('text/html')) {
        const html = await upstream.text();
        return reply.send(rewriteDeviceProxyHtml(html, `/api/devices/${encodeURIComponent(params.deviceId)}/ui-proxy`));
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return reply.send(buffer);
    } catch (error) {
      app.log.warn({ deviceId: params.deviceId, clientIp, error }, 'Device UI proxy failed');
      return reply.code(502).send({ ok: false, error: 'device_proxy_failed' });
    }
  });

  app.get('/api/devices/:deviceId', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const metadata = deviceService.getMetadata(deviceId);
    const session = deviceService.get(deviceId);
    if (!metadata && !session) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }
    return {
      ok: true,
      data: {
        deviceId,
        online: Boolean(session),
        socketId: session?.socketId,
        connectedAt: session?.connectedAt,
        lastHeartbeatAt: session?.lastHeartbeatAt,
        heartbeat: session?.heartbeat,
        metadata,
      },
    };
  });

  app.get('/api/devices/:deviceId/placement-config', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const metadata = deviceService.getMetadata(deviceId);
    const session = deviceService.get(deviceId);
    if (!metadata && !session) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }
    const config = await spectrumStorageService.readPlacementConfig(deviceId);
    return { ok: true, data: config };
  });

  app.put('/api/devices/:deviceId/placement-config', async (request, reply) => {
    if (!requireRole(request, reply, 'operator')) {
      return;
    }
    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const metadata = deviceService.getMetadata(deviceId);
    const session = deviceService.get(deviceId);
    if (!metadata && !session) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }
    const config = placementConfigSchema.parse(request.body);
    const axisLabels = placementAxisLabelsFromConfig(config);
    if (axisLabels) {
      await deviceService.updateStrict(deviceId, { axisLabels });
    }
    const saved = await spectrumStorageService.writePlacementConfig(deviceId, config);
    return { ok: true, data: saved };
  });

  app.get('/api/devices/:deviceId/history', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const query = deviceHistoryQuerySchema.parse(request.query);

    const metadata = deviceService.getMetadata(deviceId);
    if (!metadata) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    const entries = auditService.query({
      deviceId,
      limit: query.limit ?? 30,
    });

    return {
      ok: true,
      data: {
        deviceId,
        entries,
        returnedEntries: entries.length,
      },
    };
  });

  app.get('/api/devices/:deviceId/telemetry', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const query = telemetryHistoryQuerySchema.parse(request.query);

    return {
      ok: true,
      data: await telemetryService.listHistory({
        deviceId,
        from: query.from,
        to: query.to,
        limit: query.limit,
        bucketMs: query.bucketMs,
      }),
    };
  });

  app.get('/api/devices/:deviceId/status-history', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const query = deviceStatusHistoryQuerySchema.parse(request.query);

    const metadata = deviceService.getMetadata(deviceId);
    const session = deviceService.get(deviceId);
    if (!metadata && !session) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    const items = await deviceService.listStatusHistory({
      deviceId,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });

    return {
      ok: true,
      data: {
        deviceId,
        items,
        returnedItems: items.length,
      },
    };
  });

  app.get('/api/devices/:deviceId/telemetry-availability', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const query = telemetryAvailabilityQuerySchema.parse(request.query);

    return {
      ok: true,
      data: {
        deviceId,
        days: await telemetryService.listAvailableDays({
          deviceId,
          from: query.from,
          to: query.to,
          timezoneOffsetMinutes: query.timezoneOffsetMinutes,
          limitDays: query.limitDays ?? 366,
        }),
      },
    };
  });

  app.get('/api/devices/:deviceId/spectrum-frame', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const query = spectrumFrameQuerySchema.parse(request.query);

    const requestedAt = query.at?.trim();
    const telemetryUuid = query.telemetryUuid?.trim();
    if (requestedAt) {
      const parsed = Date.parse(requestedAt);
      if (Number.isNaN(parsed)) {
        return reply.code(400).send({ ok: false, error: 'invalid_timestamp' });
      }
    }

    const frame = await spectrumStorageService.findNearestFrame(
      deviceId,
      requestedAt || undefined,
      telemetryUuid || undefined,
    );
    return {
      ok: true,
      data: frame,
    };
  });

  app.get('/api/devices/:deviceId/data-summary', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const metadata = deviceService.getMetadata(deviceId);
    if (!metadata) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    const telemetrySummary = await telemetryService.summarizeDevice(deviceId);
    const spectrumSummary = await spectrumStorageService.summarizeDeviceFrames(deviceId);
    const timestamps = [telemetrySummary.latestAt, spectrumSummary.latestCapturedAt]
      .map((value) => (value ? Date.parse(value) : Number.NaN))
      .filter((value) => Number.isFinite(value));
    const latestUpdatedAt =
      timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : undefined;

    return {
      ok: true,
      data: {
        deviceId,
        updatedAt: latestUpdatedAt,
        totalRecords: telemetrySummary.total + spectrumSummary.totalFrames,
        totalBytes: telemetrySummary.estimatedBytes + spectrumSummary.totalBytes,
        telemetry: {
          records: telemetrySummary.total,
          latestAt: telemetrySummary.latestAt,
          estimatedBytes: telemetrySummary.estimatedBytes,
        },
        spectrum: {
          frames: spectrumSummary.totalFrames,
          latestAt: spectrumSummary.latestCapturedAt,
          totalBytes: spectrumSummary.totalBytes,
        },
      },
    };
  });

  app.delete('/api/devices/:deviceId/data', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const before = deviceService.getMetadata(deviceId);
    if (!before) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    const telemetryDeleted = await deviceService.clearTelemetryDataStrict(deviceId);
    if (telemetryDeleted === null) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }
    const spectrumPurge = await spectrumStorageService.purgeDeviceFrames(deviceId);

    auditService.record({
      action: 'device_data_clear',
      deviceId,
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'cleared',
      metadata: {
        targetResource: {
          resourceType: 'device',
          resourceId: deviceId,
          resourceName: before.name,
        },
        afterSummary: summarize({
          telemetryDeleted,
          spectrumFramesDeleted: spectrumPurge.framesDeleted,
          spectrumFilesDeleted: spectrumPurge.filesDeleted,
          spectrumFileDeleteErrors: spectrumPurge.fileDeleteErrors,
        }),
      },
    });

    return {
      ok: true,
      data: {
        cleared: true,
        deviceId,
        telemetryDeleted,
        spectrumFramesDeleted: spectrumPurge.framesDeleted,
        spectrumFilesDeleted: spectrumPurge.filesDeleted,
        spectrumFileDeleteErrors: spectrumPurge.fileDeleteErrors,
      },
    };
  });

  app.post('/api/devices', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const body = deviceCreateSchema.parse(request.body);
    const created = await deviceService.registerStrict(body);
    auditService.record({
      action: 'device_register',
      deviceId: created.deviceId,
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'created',
      metadata: {
        targetResource: {
          resourceType: 'device',
          resourceId: created.deviceId,
          resourceName: created.name,
        },
        afterSummary: summarize(created),
      },
    });
    return reply.code(201).send({ ok: true, data: created });
  });

  app.put('/api/devices/:deviceId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const body = deviceUpdateSchema.parse(request.body);
    const before = deviceService.getMetadata(deviceId);
    const updated = await deviceService.updateStrict(deviceId, body);
    if (!updated) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }
    auditService.record({
      action: 'device_update',
      deviceId,
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'updated',
      metadata: {
        targetResource: {
          resourceType: 'device',
          resourceId: deviceId,
          resourceName: updated.name,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
      },
    });
    return { ok: true, data: updated };
  });

  app.get('/api/devices/:deviceId/delete-impact', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const impact = await deviceService.inspectDeletionImpact(deviceId);
    if (!impact) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    return {
      ok: true,
      data: impact,
    };
  });

  app.delete('/api/devices/:deviceId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }

    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const { deviceId } = paramsSchema.parse(request.params);
    const before = deviceService.getMetadata(deviceId);
    if (!before) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    const impact = await deviceService.inspectDeletionImpact(deviceId);
    if (!impact) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    realtimeGateway.disconnectDevice(deviceId);
    const [commandRowsDeleted, alertRowsDeleted, auditLogRowsDeleted] = await Promise.all([
      commandService.deleteByDeviceId(deviceId),
      alertService.deleteByDeviceId(deviceId),
      auditService.deleteByDeviceId(deviceId),
    ]);
    const spectrumPurge = await spectrumStorageService.purgeDeviceFrames(deviceId);

    const deleted = await deviceService.deleteStrict(deviceId);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    auditService.record({
      action: 'device_delete',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'deleted',
      metadata: {
        targetResource: {
          resourceType: 'device',
          resourceId: deviceId,
          resourceName: before.name,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize({
          impact,
          deletedImpact: deleted.impact,
          commandRowsDeleted,
          alertRowsDeleted,
          auditLogRowsDeleted,
          spectrumFilesDeleted: spectrumPurge.filesDeleted,
          spectrumFileDeleteErrors: spectrumPurge.fileDeleteErrors,
        }),
      },
    });

    return {
      ok: true,
      data: {
        deleted: true,
        deviceId,
        impact,
        deletedImpact: deleted.impact,
        commandRowsDeleted,
        alertRowsDeleted,
        auditLogRowsDeleted,
        spectrumFramesDeleted: spectrumPurge.framesDeleted,
        spectrumFilesDeleted: spectrumPurge.filesDeleted,
        spectrumFileDeleteErrors: spectrumPurge.fileDeleteErrors,
      },
    };
  });

  app.get('/api/commands/recent', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    return {
      ok: true,
      data: commandService.listRecent(100),
    };
  });

  app.post('/api/commands/lookup', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const body = commandLookupSchema.parse(request.body ?? {});
    return {
      ok: true,
      data: commandService.lookup(body.commandIds),
    };
  });

  app.post('/api/ota/upload-bin', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const multipartRequest = request as FastifyRequest & {
      file: () => Promise<
        | {
            filename: string;
            mimetype: string;
            toBuffer: () => Promise<Buffer>;
          }
        | undefined
      >;
    };
    const filePart = await multipartRequest.file();
    if (!filePart) {
      return reply.code(400).send({ ok: false, error: 'ota_file_required' });
    }

    const originalName = filePart.filename || 'firmware.bin';
    if (!originalName.toLowerCase().endsWith('.bin')) {
      return reply.code(422).send({ ok: false, error: 'ota_file_extension_invalid', expected: '.bin' });
    }

    const buffer = await filePart.toBuffer();
    if (buffer.length === 0) {
      return reply.code(422).send({ ok: false, error: 'ota_file_empty' });
    }
    if (buffer.length > otaUploadMaxBytes) {
      return reply.code(422).send({
        ok: false,
        error: 'ota_file_too_large',
        maxBytes: otaUploadMaxBytes,
        sizeBytes: buffer.length,
      });
    }

    await mkdir(otaUploadDir, { recursive: true });
    const savedName = createOtaUploadFileName(originalName);
    await writeFile(join(otaUploadDir, savedName), buffer);
    const baseUrl = resolvePublicBaseUrl(request);
    const publicUrl = `${baseUrl}/ota-bins/${encodeURIComponent(savedName)}`;
    const actor = principalActor(principal);
    auditService.record({
      action: 'ota_bin_upload',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor,
      result: 'uploaded',
      metadata: {
        targetResource: {
          resourceType: 'ota_file',
          resourceId: savedName,
          resourceName: originalName,
        },
        sizeBytes: buffer.length,
        mimeType: filePart.mimetype,
        publicUrl,
      },
    });

    return {
      ok: true,
      data: {
        fileName: savedName,
        originalName,
        sizeBytes: buffer.length,
        mimeType: filePart.mimetype,
        url: publicUrl,
        uploadedAt: new Date().toISOString(),
      },
    };
  });

  app.post('/api/ota/dispatch', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const body = otaDispatchSchema.parse(request.body ?? {});
    const deviceIds = normalizeDeviceIdList(body.deviceIds);
    if (deviceIds.length === 0) {
      return reply.code(422).send({ ok: false, error: 'ota_devices_required' });
    }
    const targetVersion = body.targetVersion?.trim();
    const actor = principalActor(principal);
    const runId = `ota-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const items: Array<{
      deviceId: string;
      status: 'accepted' | 'failed';
      commandId?: string;
      reason?: string;
    }> = [];

    for (const deviceId of deviceIds) {
      const deviceOtaUrl = resolveDeviceOtaUrl(deviceId, body.otaUrl);
      const basePayload: Record<string, unknown> = {
        otaUrl: deviceOtaUrl,
        command: body.commandType,
        type: body.commandType,
      };
      if (targetVersion) {
        basePayload.targetVersion = targetVersion;
      }
      const normalizedPayload = normalizeCommandPayloadForDevice(body.commandType, deviceId, basePayload);
      const payloadValidation = validateCommandPayload(body.commandType, normalizedPayload);
      if (!payloadValidation.ok) {
        items.push({
          deviceId,
          status: 'failed',
          reason: payloadValidation.error,
        });
        continue;
      }
      const command = await commandService.create(deviceId, body.commandType, normalizedPayload);
      if (!command) {
        items.push({
          deviceId,
          status: 'failed',
          reason: 'device_not_connected',
        });
        continue;
      }
      realtimeGateway.sendCommand(deviceId, command);
      items.push({
        deviceId,
        status: 'accepted',
        commandId: command.commandId,
      });
    }

    const accepted = items.filter((item) => item.status === 'accepted').length;
    const failed = items.length - accepted;
    if (accepted > 0) {
    }
    if (failed > 0) {
    }

    auditService.record({
      action: 'ota_bulk_dispatch',
      deviceId: 'n/a',
      commandId: runId,
      actor,
      result: failed === 0 ? 'completed' : accepted === 0 ? 'failed' : 'partial',
      metadata: {
        targetResource: {
          resourceType: 'ota_run',
          resourceId: runId,
        },
        commandType: body.commandType,
        otaUrl: body.otaUrl,
        targetVersion,
        note: body.note,
        targetCount: deviceIds.length,
        acceptedCount: accepted,
        failedCount: failed,
      },
    });

    return {
      ok: true,
      data: {
        runId,
        commandType: body.commandType,
        otaUrl: body.otaUrl,
        targetVersion,
        note: body.note,
        total: deviceIds.length,
        accepted,
        failed,
        items,
        startedAt: new Date().toISOString(),
      },
    };
  });

  app.get('/api/alerts', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const query = alertListQuerySchema.parse(request.query);
    return {
      ok: true,
      data: alertService.listAlerts(query.limit ?? 100, query.status ?? 'all'),
    };
  });

  app.get('/api/alerts/summary', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    return {
      ok: true,
      data: alertService.summarizeAlerts(),
    };
  });

  app.post('/api/alerts/:alertId/ack', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { alertId } = z.object({ alertId: z.string().min(1) }).parse(request.params);
    const body = alertWorkflowNoteSchema.parse(request.body ?? {});
    const actor = principalActor(principal);
    const before = alertService.getAlert(alertId);
    if (!before) {
      return workflowResourceNotFound(reply, 'alert_acknowledge', 'alert_not_found', {
        resourceType: 'alert',
        resourceId: alertId,
      });
    }
    if (before.status === 'resolved') {
      return workflowTransitionBlocked(reply, 'alert_acknowledge', 'alert_already_resolved', {
        resourceType: 'alert',
        resourceId: alertId,
        status: before.status,
      });
    }

    const updated = alertService.acknowledgeAlert(alertId, actor, body.note);
    if (!updated) {
      return workflowTransitionBlocked(reply, 'alert_acknowledge', 'alert_not_acknowledgeable', {
        resourceType: 'alert',
        resourceId: alertId,
      });
    }

    realtimeGateway.broadcastAlert(updated);
    auditService.record({
      action: 'alert_acknowledge',
      deviceId: updated.deviceId,
      commandId: 'n/a',
      actor,
      result: 'acknowledged',
      metadata: {
        targetResource: {
          resourceType: 'alert',
          resourceId: updated.alertId,
          resourceName: updated.ruleName,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
        workflow: {
          transition: `${before.status} -> ${updated.status}`,
          noteRequired: false,
          noteProvided: Boolean(body.note?.trim()),
        },
        note: body.note,
      },
    });
    return { ok: true, data: updated };
  });

  app.post('/api/alerts/:alertId/resolve', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { alertId } = z.object({ alertId: z.string().min(1) }).parse(request.params);
    const bodyResult = alertResolveSchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      return workflowValidationError(reply, 'alert_resolve', 'note_required', {
        field: 'note',
      });
    }
    const body = bodyResult.data;
    const actor = principalActor(principal);
    const before = alertService.getAlert(alertId);
    if (!before) {
      return workflowResourceNotFound(reply, 'alert_resolve', 'alert_not_found', {
        resourceType: 'alert',
        resourceId: alertId,
      });
    }
    if (before.status === 'resolved') {
      return workflowTransitionBlocked(reply, 'alert_resolve', 'alert_already_resolved', {
        resourceType: 'alert',
        resourceId: alertId,
        status: before.status,
      });
    }

    const updated = alertService.resolveAlert(alertId, actor, body.note);
    if (!updated) {
      return workflowTransitionBlocked(reply, 'alert_resolve', 'alert_not_resolvable', {
        resourceType: 'alert',
        resourceId: alertId,
      });
    }

    realtimeGateway.broadcastAlert(updated);
    auditService.record({
      action: 'alert_resolve',
      deviceId: updated.deviceId,
      commandId: 'n/a',
      actor,
      result: 'resolved',
      metadata: {
        targetResource: {
          resourceType: 'alert',
          resourceId: updated.alertId,
          resourceName: updated.ruleName,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
        workflow: {
          transition: `${before.status} -> ${updated.status}`,
          noteRequired: true,
          noteProvided: Boolean(body.note?.trim()),
        },
        note: body.note,
      },
    });
    return { ok: true, data: updated };
  });

  app.get('/api/alert-rules', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    return {
      ok: true,
      data: alertService.listRules(),
    };
  });

  app.post('/api/alert-rules', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const body = alertRuleCreateSchema.parse(request.body);
    const created = alertService.createRule(body);
    auditService.record({
      action: 'alert_rule_create',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'created',
      metadata: {
        targetResource: {
          resourceType: 'alert_rule',
          resourceId: created.ruleId,
          resourceName: created.name,
        },
        afterSummary: summarize(created),
      },
    });
    return reply.code(201).send({ ok: true, data: created });
  });

  app.put('/api/alert-rules/:ruleId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const paramsSchema = z.object({ ruleId: z.string().min(1) });
    const { ruleId } = paramsSchema.parse(request.params);
    const body = alertRuleUpdateSchema.parse(request.body);
    const before = alertService.listRules().find((rule) => rule.ruleId === ruleId) || null;
    const updated = alertService.updateRule(ruleId, body);
    if (!updated) {
      return reply.code(404).send({ ok: false, error: 'alert_rule_not_found' });
    }
    auditService.record({
      action: 'alert_rule_update',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'updated',
      metadata: {
        targetResource: {
          resourceType: 'alert_rule',
          resourceId: updated.ruleId,
          resourceName: updated.name,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
      },
    });
    return { ok: true, data: updated };
  });

  app.get('/api/audit-logs', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) {
      return;
    }
    const query = auditListQuerySchema.parse(request.query);
    return {
      ok: true,
      data: auditService.query({
        actor: query.actor,
        action: query.action,
        commandId: query.commandId,
        deviceId: query.deviceId,
        from: query.from,
        to: query.to,
        limit: query.limit ?? 100,
      }),
    };
  });

  app.post('/api/devices/:deviceId/commands', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }
    const paramsSchema = z.object({ deviceId: z.string().min(1) });
    const bodySchema = z.object({
      type: deviceCommandTypeSchema,
      payload: z.record(z.string(), z.unknown()).optional(),
    });

    const { deviceId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const actor = principalActor(principal);
    const payload = body.payload || {};
    const payloadForDevice = isOtaCommandType(body.type)
      ? { ...payload, otaUrl: resolveDeviceOtaUrl(deviceId, extractCommandOtaUrl(payload) ?? '') }
      : payload;
    const payloadValidation = validateCommandPayload(body.type, payloadForDevice);
    if (!payloadValidation.ok) {
      return reply.code(422).send({ ok: false, error: payloadValidation.error, field: payloadValidation.field });
    }

    const normalizedPayload = normalizeCommandPayloadForDevice(body.type, deviceId, payloadForDevice);
    const command = await commandService.create(deviceId, body.type, normalizedPayload);
    if (!command) {
      auditService.record({
        action: 'command_send',
        deviceId,
        commandId: 'n/a',
        actor,
        result: 'device_not_connected',
        metadata: {
          targetResource: {
          resourceType: 'device',
          resourceId: deviceId,
        },
        type: body.type,
        payload,
      },
    });
    return reply.code(404).send({ ok: false, error: 'device_not_connected' });
    }

    realtimeGateway.sendCommand(deviceId, command);
    auditService.record({
      action: 'command_send',
      deviceId,
      commandId: command.commandId,
      actor,
      result: 'sent',
      metadata: {
        targetResource: {
          resourceType: 'device',
          resourceId: deviceId,
        },
        type: body.type,
        payload: normalizedPayload,
      },
    });
    return { ok: true, data: command };
  });


}
