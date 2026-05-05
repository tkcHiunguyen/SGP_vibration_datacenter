import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { env } from '../../shared/config.js';
import type { CommandType } from '../../shared/types.js';
import { AlertService } from '../alert/alert.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/index.js';
import { CommandService } from '../command/command.service.js';
import { DeviceService } from '../device/device.service.js';
import type { MySqlPersistenceStatus } from '../persistence/mysql-access.js';
import type { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
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

  function resolveLocalLanIp(): string | undefined {
    const nets = networkInterfaces();
    for (const interfaces of Object.values(nets)) {
      if (!interfaces || interfaces.length === 0) {
        continue;
      }
      for (const entry of interfaces) {
        if (entry.family === 'IPv4' && !entry.internal) {
          return entry.address;
        }
      }
    }
    return undefined;
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
      const basePayload: Record<string, unknown> = {
        otaUrl: body.otaUrl,
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
    const payloadValidation = validateCommandPayload(body.type, payload);
    if (!payloadValidation.ok) {
      return reply.code(422).send({ ok: false, error: payloadValidation.error, field: payloadValidation.field });
    }

    const normalizedPayload = normalizeCommandPayloadForDevice(body.type, deviceId, payload);
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
