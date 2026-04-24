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
import { FleetService, type FleetCohort, type FleetPolicy } from '../fleet/index.js';
import {
  GovernanceService,
  type GovernanceActionType,
  type GovernanceApprovalRecord,
  type GovernanceApprovalStatus,
  type GovernanceRiskLevel,
} from '../governance/index.js';
import { IncidentService } from '../incident/incident.service.js';
import type { ObservabilityMetricsRegistry } from '../observability/index.js';
import type { RealtimeGateway } from '../realtime/realtime.gateway.js';
import type { RolloutPlan, RolloutStatus, RolloutStrategy } from '../rollout/index.js';
import { RolloutService } from '../rollout/index.js';
import { SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { ZoneService } from '../zone/zone.service.js';

type RegisterRoutesDeps = {
  app: FastifyInstance;
  authService: AuthService;
  deviceService: DeviceService;
  telemetryService: TelemetryService;
  alertService: AlertService;
  auditService: AuditService;
  incidentService: IncidentService;
  fleetService: FleetService;
  governanceService: GovernanceService;
  rolloutService: RolloutService;
  commandService: CommandService;
  metrics: ObservabilityMetricsRegistry;
  realtimeGateway: RealtimeGateway;
  zoneService: ZoneService;
  spectrumStorageService: SpectrumStorageService;
};

export function registerRoutes({
  app,
  authService,
  deviceService,
  telemetryService,
  alertService,
  auditService,
  incidentService,
  fleetService,
  governanceService,
  rolloutService,
  commandService,
  metrics,
  realtimeGateway,
  zoneService,
  spectrumStorageService,
}: RegisterRoutesDeps): void {
  type AppRole = 'admin' | 'approver' | 'release_manager' | 'operator' | 'viewer';
  const highRiskTargetCount = Math.max(1, env.GOVERNANCE_HIGH_RISK_TARGET_COUNT);

  const deviceCreateSchema = z.object({
    deviceId: z.string().min(1),
    uuid: z.string().optional(),
    name: z.string().optional(),
    site: z.string().optional(),
    zone: z.string().optional(),
    firmwareVersion: z.string().optional(),
    sensorVersion: z.string().optional(),
    notes: z.string().optional(),
  });

  const deviceUpdateSchema = z.object({
    uuid: z.string().optional(),
    name: z.string().optional(),
    site: z.string().optional(),
    zone: z.string().optional(),
    firmwareVersion: z.string().optional(),
    sensorVersion: z.string().optional(),
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
    limit: z.coerce.number().int().positive().max(1000).optional(),
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

  const incidentStatusSchema = z.enum(['open', 'assigned', 'monitoring', 'resolved', 'closed']);

  const incidentListQuerySchema = z.object({
    status: incidentStatusSchema.optional(),
    owner: z.string().optional(),
    severity: z.enum(['warning', 'critical']).optional(),
    site: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  });

  const incidentTimelineQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

  const incidentCreateSchema = z.object({
    alertId: z.string().optional(),
    title: z.string().min(1),
    severity: z.enum(['warning', 'critical']),
    site: z.string().optional(),
    owner: z.string().optional(),
    note: z.string().max(2_000).optional(),
  });

  const incidentAssignSchema = z.object({
    owner: z.string().min(1),
    note: z.string().max(2_000).optional(),
  });

  const incidentNoteSchema = z.object({
    note: z.string().min(1).max(2_000),
  });

  const incidentExportQuerySchema = z.object({
    status: incidentStatusSchema.optional(),
    owner: z.string().optional(),
    severity: z.enum(['warning', 'critical']).optional(),
    site: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
    format: z.enum(['json', 'ndjson']).default('json'),
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

  const fleetCohortFiltersSchema = z.object({
    site: z.string().optional(),
    zone: z.string().optional(),
    status: z.enum(['online', 'offline']).optional(),
    search: z.string().optional(),
  });

  const fleetCohortCreateSchema = z.object({
    name: z.string().min(1),
    filters: fleetCohortFiltersSchema.optional(),
    notes: z.string().max(2_000).optional(),
  });

  const fleetCohortUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    filters: fleetCohortFiltersSchema.optional(),
    notes: z.string().max(2_000).nullable().optional(),
  });

  const fleetCohortPreviewSchema = z.object({
    cohortId: z.string().min(1).optional(),
    filters: fleetCohortFiltersSchema.optional(),
  });

  const deviceCommandTypeSchema = z.enum([
    'capture',
    'calibrate',
    'restart',
    'set_config',
    'ota',
    'ota_from_url',
  ]);
  const fleetBatchCommandTypeSchema = z.enum(['set_config', 'ota', 'ota_from_url']).default('set_config');

  const fleetBatchSchema = z.object({
    cohortId: z.string().min(1).optional(),
    filters: fleetCohortFiltersSchema.optional(),
    commandType: fleetBatchCommandTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    note: z.string().max(2_000).optional(),
    approvalId: z.string().min(1).optional(),
    emergencyOverride: z.boolean().optional(),
  });

  const fleetBatchListQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

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

  const fleetPolicyScopeSchema = z
    .object({
      site: z.string().optional(),
      zone: z.string().optional(),
    })
    .refine((value) => Boolean(value.site?.trim() || value.zone?.trim()), {
      message: 'policy scope requires site or zone',
    });

  const fleetPolicyCreateSchema = z.object({
    name: z.string().min(1),
    scope: fleetPolicyScopeSchema,
    baselineConfig: z.record(z.string(), z.unknown()),
    notes: z.string().max(2_000).optional(),
  });

  const fleetPolicyUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    scope: fleetPolicyScopeSchema.optional(),
    baselineConfig: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().max(2_000).nullable().optional(),
  });

  const fleetAttachPolicySchema = z.object({
    policyId: z.string().min(1),
  });

  const fleetPolicyDiagnosticsQuerySchema = z.object({
    cohortId: z.string().min(1),
    policyId: z.string().min(1),
  });

  const rolloutStrategySchema = z.enum(['all-at-once', 'wave', 'canary']);

  const rolloutGateSchema = z.object({
    maxFailureRatio: z.number().min(0).max(1).optional(),
    maxTimeoutRatio: z.number().min(0).max(1).optional(),
    minSuccessRatio: z.number().min(0).max(1).optional(),
  });

  const rolloutFaultInjectionSchema = z.object({
    failureRate: z.number().min(0).max(1).optional(),
    timeoutRate: z.number().min(0).max(1).optional(),
    failedDeviceIds: z.array(z.string().min(1)).optional(),
    timeoutDeviceIds: z.array(z.string().min(1)).optional(),
  });

  const rolloutCreateSchema = z.object({
    name: z.string().min(1),
    cohortId: z.string().min(1).optional(),
    filters: fleetCohortFiltersSchema.optional(),
    strategy: rolloutStrategySchema,
    payload: z.record(z.string(), z.unknown()),
    rollbackPayload: z.record(z.string(), z.unknown()).optional(),
    waveSize: z.number().int().positive().optional(),
    canarySize: z.number().int().positive().optional(),
    waveIntervalMs: z.number().int().positive().optional(),
    autoRollback: z.boolean().optional(),
    gate: rolloutGateSchema.optional(),
    faultInjection: rolloutFaultInjectionSchema.optional(),
  });

  const rolloutListQuerySchema = z.object({
    status: z
      .enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'rolled_back', 'canceled'])
      .optional(),
    site: z.string().optional(),
    cohortRef: z.string().optional(),
    strategy: rolloutStrategySchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

  const rolloutActionNoteSchema = z.object({
    note: z.string().min(1).max(2_000),
  });

  const rolloutOptionalNoteSchema = z.object({
    note: z.string().max(2_000).optional(),
    approvalId: z.string().min(1).optional(),
    emergencyOverride: z.boolean().optional(),
  });

  const rolloutEventsQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

  const governanceActionSchema = z.enum(['fleet_batch_apply', 'rollout_start']);

  const governanceTargetSchema = z.object({
    resourceType: z.enum(['fleet_batch', 'rollout_plan']),
    resourceId: z.string().min(1).optional(),
    cohortRef: z.string().min(1).optional(),
    site: z.string().optional(),
    zone: z.string().optional(),
    strategy: z.string().optional(),
    targetCount: z.number().int().nonnegative(),
  });

  const governanceCreateSchema = z.object({
    actionType: governanceActionSchema,
    riskLevel: z.enum(['normal', 'high', 'critical']).optional(),
    requestNote: z.string().max(2_000).optional(),
    rationale: z.string().max(2_000).optional(),
    expiresInMinutes: z.number().int().positive().max(24 * 60).optional(),
    target: governanceTargetSchema,
  });

  const governanceListQuerySchema = z.object({
    actionType: governanceActionSchema.optional(),
    status: z.enum(['pending', 'approved', 'rejected', 'expired', 'used', 'canceled']).optional(),
    requestedBy: z.string().optional(),
    approverId: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

  const governanceDecisionSchema = z.object({
    note: z.string().max(2_000).optional(),
  });

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

  function serializeFleetCohort(cohort: FleetCohort) {
    return {
      ...cohort,
      cohortId: cohort.id,
    };
  }

  function serializeFleetPolicy(policy: FleetPolicy) {
    return {
      ...policy,
      policyId: policy.id,
    };
  }

  function serializeRolloutPlan(plan: RolloutPlan) {
    return {
      ...plan,
      id: plan.planId,
    };
  }

  function serializeGovernanceApproval(approval: GovernanceApprovalRecord) {
    return {
      ...approval,
      id: approval.approvalId,
    };
  }

  function buildRolloutSender() {
    return (deviceId: string, payload: Record<string, unknown>) => {
      const command = commandService.create(deviceId, 'set_config', payload);
      if (!command) {
        return {
          status: 'timeout' as const,
          reason: 'device_not_connected',
        };
      }
      realtimeGateway.sendCommand(deviceId, command);
      return { status: 'acked' as const };
    };
  }

  function isOtaCommandType(type: CommandType): type is 'ota' | 'ota_from_url' {
    return type === 'ota' || type === 'ota_from_url';
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

  function resolveFleetTargets(input: {
    cohortId?: string;
    filters?: z.infer<typeof fleetCohortFiltersSchema>;
  }): {
    ok: true;
    devices: ReturnType<DeviceService['list']>;
    cohortRef: string;
    filters: z.infer<typeof fleetCohortFiltersSchema>;
    cohortName?: string;
  } | {
    ok: false;
    reason: 'cohort_not_found';
    cohortId: string;
  } {
    const allDevices = deviceService.list();

    if (input.cohortId) {
      const cohort = fleetService.getCohort(input.cohortId);
      if (!cohort) {
        return {
          ok: false,
          reason: 'cohort_not_found',
          cohortId: input.cohortId,
        };
      }

      return {
        ok: true,
        devices: fleetService.previewByCohort(allDevices, cohort.id),
        cohortRef: cohort.id,
        cohortName: cohort.name,
        filters: cohort.filters,
      };
    }

    const filters = input.filters ?? {};
    return {
      ok: true,
      devices: fleetService.previewByFilters(allDevices, filters),
      cohortRef: 'adhoc',
      filters,
    };
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

  const appShellPaths = [
    '/',
    '/threed',
    '/ota',
    '/dashboard',
    '/zones',
    '/analytics',
    '/sensors',
    '/settings',
    '/app',
    '/app/ota',
    '/app/dashboard',
    '/app/zones',
    '/app/analytics',
    '/app/sensors',
    '/app/settings',
    '/app/threed',
  ];

  for (const path of appShellPaths) {
    app.get(path, async (_, reply) => {
      return reply.sendFile('index.html');
    });
  }

  app.get('/health', async () => ({
    ok: true,
    service: 'sgp-vibration-datacenter-server',
    uptimeSec: Math.round(process.uptime()),
    connectedDevices: metrics.setGauge(
      'connected_devices',
      deviceService.countConnected(),
      {},
      'Connected device sessions',
    ),
    activeAlerts: metrics.setGauge('active_alerts', alertService.countActiveAlerts(), {}, 'Active alerts'),
    connectedClients: metrics.setGauge(
      'connected_clients',
      realtimeGateway.connectedClientsCount(),
      {},
      'Connected Socket.IO clients',
    ),
    now: new Date().toISOString(),
  }));

  app.get('/api/ops/metrics', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    return {
      ok: true,
      data: metrics.snapshot(),
    };
  });

  app.get('/api/auth/me', async (request) => {
    const principal = authenticate(request);
    if (!principal) {
      return authMeResponse();
    }

    return {
      ok: true,
      data: {
        authenticated: true,
        principal,
        configured: authService.isConfigured(),
        defaultRole: authService.getDefaultRole(),
        configuredAccess: authService.listConfiguredAccess(),
        schemes: ['bearer', 'api-key'],
      },
    };
  });

  app.get('/api/governance/summary', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    return {
      ok: true,
      data: governanceService.summarize(),
    };
  });

  app.get('/api/governance/approvals', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const query = governanceListQuerySchema.parse(request.query ?? {});
    const approvals = governanceService.listApprovals({
      actionType: query.actionType as GovernanceActionType | undefined,
      status: query.status as GovernanceApprovalStatus | undefined,
      requestedBy: query.requestedBy,
      approverId: query.approverId,
      limit: query.limit ?? 100,
    });

    return {
      ok: true,
      data: approvals.map(serializeGovernanceApproval),
    };
  });

  app.post('/api/governance/approvals', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const body = governanceCreateSchema.parse(request.body ?? {});
    const actor = principalActor(principal);
    const approval = governanceService.createApprovalRequest({
      actionType: body.actionType as GovernanceActionType,
      riskLevel: (body.riskLevel as GovernanceRiskLevel | undefined) ?? 'high',
      requestedBy: actor,
      requestNote: body.requestNote,
      rationale: body.rationale,
      expiresInMinutes: body.expiresInMinutes,
      target: body.target,
    });

    auditService.record({
      action: 'governance_approval_request_create',
      deviceId: 'n/a',
      commandId: approval.approvalId,
      actor,
      result: 'requested',
      metadata: {
        targetResource: {
          resourceType: 'governance_approval',
          resourceId: approval.approvalId,
        },
        actionType: approval.actionType,
        riskLevel: approval.riskLevel,
        expiresAt: approval.expiresAt,
        target: approval.target,
        note: approval.requestNote,
        rationale: approval.rationale,
      },
    });

    return reply.code(201).send({
      ok: true,
      data: serializeGovernanceApproval(approval),
    });
  });

  app.post('/api/governance/approvals/:approvalId/approve', async (request, reply) => {
    const principal = requireRole(request, reply, 'approver');
    if (!principal) {
      return;
    }

    const { approvalId } = z.object({ approvalId: z.string().min(1) }).parse(request.params);
    const body = governanceDecisionSchema.parse(request.body ?? {});
    const actor = principalActor(principal);
    const decision = governanceService.approve(approvalId, actor, body.note);
    if (!decision.ok) {
      return reply.code(409).send({
        ok: false,
        error: decision.reason,
        details: decision.details,
      });
    }

    auditService.record({
      action: 'governance_approval_approve',
      deviceId: 'n/a',
      commandId: approvalId,
      actor,
      result: 'approved',
      metadata: {
        targetResource: {
          resourceType: 'governance_approval',
          resourceId: approvalId,
        },
        actionType: decision.approval.actionType,
        note: decision.approval.approverNote,
      },
    });

    return {
      ok: true,
      data: serializeGovernanceApproval(decision.approval),
    };
  });

  app.post('/api/governance/approvals/:approvalId/reject', async (request, reply) => {
    const principal = requireRole(request, reply, 'approver');
    if (!principal) {
      return;
    }

    const { approvalId } = z.object({ approvalId: z.string().min(1) }).parse(request.params);
    const body = governanceDecisionSchema.parse(request.body ?? {});
    const actor = principalActor(principal);
    const decision = governanceService.reject(approvalId, actor, body.note);
    if (!decision.ok) {
      return reply.code(409).send({
        ok: false,
        error: decision.reason,
        details: decision.details,
      });
    }

    auditService.record({
      action: 'governance_approval_reject',
      deviceId: 'n/a',
      commandId: approvalId,
      actor,
      result: 'rejected',
      metadata: {
        targetResource: {
          resourceType: 'governance_approval',
          resourceId: approvalId,
        },
        actionType: decision.approval.actionType,
        note: decision.approval.rejectedNote,
      },
    });

    return {
      ok: true,
      data: serializeGovernanceApproval(decision.approval),
    };
  });

  app.get('/api/fleet/cohorts', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    return {
      ok: true,
      data: fleetService.listCohorts().map(serializeFleetCohort),
    };
  });

  app.get('/api/fleet/policies', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    return {
      ok: true,
      data: fleetService.listPolicies().map(serializeFleetPolicy),
    };
  });

  app.post('/api/fleet/policies', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }

    const body = fleetPolicyCreateSchema.parse(request.body ?? {});
    if (Object.keys(body.baselineConfig).length === 0) {
      return reply.code(422).send({
        ok: false,
        error: 'policy_baseline_required',
      });
    }

    const created = fleetService.createPolicy(body);
    auditService.record({
      action: 'fleet_policy_create',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'created',
      metadata: {
        targetResource: {
          resourceType: 'fleet_policy',
          resourceId: created.id,
          resourceName: created.name,
        },
        afterSummary: summarize(created),
      },
    });

    return reply.code(201).send({
      ok: true,
      data: serializeFleetPolicy(created),
    });
  });

  app.put('/api/fleet/policies/:policyId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }

    const { policyId } = z.object({ policyId: z.string().min(1) }).parse(request.params);
    const body = fleetPolicyUpdateSchema.parse(request.body ?? {});
    if (body.baselineConfig && Object.keys(body.baselineConfig).length === 0) {
      return reply.code(422).send({
        ok: false,
        error: 'policy_baseline_required',
      });
    }

    const before = fleetService.getPolicy(policyId);
    if (!before) {
      return reply.code(404).send({ ok: false, error: 'policy_not_found' });
    }

    const updated = fleetService.updatePolicy(policyId, body);
    if (!updated) {
      return reply.code(404).send({ ok: false, error: 'policy_not_found' });
    }

    auditService.record({
      action: 'fleet_policy_update',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'updated',
      metadata: {
        targetResource: {
          resourceType: 'fleet_policy',
          resourceId: updated.id,
          resourceName: updated.name,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
      },
    });

    return {
      ok: true,
      data: serializeFleetPolicy(updated),
    };
  });

  app.delete('/api/fleet/policies/:policyId', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }

    const { policyId } = z.object({ policyId: z.string().min(1) }).parse(request.params);
    const before = fleetService.getPolicy(policyId);
    const deleted = fleetService.deletePolicy(policyId);
    if (!deleted.ok) {
      if (deleted.reason === 'policy_attached') {
        return reply.code(409).send({
          ok: false,
          error: deleted.reason,
          details: deleted.details,
        });
      }
      return reply.code(404).send({ ok: false, error: deleted.reason });
    }

    auditService.record({
      action: 'fleet_policy_delete',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'deleted',
      metadata: {
        targetResource: {
          resourceType: 'fleet_policy',
          resourceId: policyId,
          resourceName: before?.name,
        },
        beforeSummary: summarize(before),
      },
    });

    return {
      ok: true,
      data: {
        policyId,
        deleted: true,
      },
    };
  });

  app.post('/api/fleet/cohorts', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const body = fleetCohortCreateSchema.parse(request.body);
    const created = fleetService.createCohort(body);
    auditService.record({
      action: 'fleet_cohort_create',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'created',
      metadata: {
        targetResource: {
          resourceType: 'fleet_cohort',
          resourceId: created.id,
          resourceName: created.name,
        },
        afterSummary: summarize(created),
      },
    });

    return reply.code(201).send({
      ok: true,
      data: serializeFleetCohort(created),
    });
  });

  app.post('/api/fleet/cohorts/preview', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const body = fleetCohortPreviewSchema.parse(request.body ?? {});
    const targets = resolveFleetTargets({
      cohortId: body.cohortId,
      filters: body.filters,
    });

    if (!targets.ok) {
      return reply.code(404).send({
        ok: false,
        error: targets.reason,
        cohortId: targets.cohortId,
      });
    }

    return {
      ok: true,
      data: targets.devices,
      matched: targets.devices.length,
      cohortRef: targets.cohortRef,
    };
  });

  app.put('/api/fleet/cohorts/:cohortId', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { cohortId } = z.object({ cohortId: z.string().min(1) }).parse(request.params);
    const body = fleetCohortUpdateSchema.parse(request.body ?? {});
    const before = fleetService.getCohort(cohortId);
    if (!before) {
      return reply.code(404).send({ ok: false, error: 'cohort_not_found' });
    }

    const updated = fleetService.updateCohort(cohortId, body);
    if (!updated) {
      return reply.code(404).send({ ok: false, error: 'cohort_not_found' });
    }

    auditService.record({
      action: 'fleet_cohort_update',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'updated',
      metadata: {
        targetResource: {
          resourceType: 'fleet_cohort',
          resourceId: updated.id,
          resourceName: updated.name,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
      },
    });

    return {
      ok: true,
      data: serializeFleetCohort(updated),
    };
  });

  app.delete('/api/fleet/cohorts/:cohortId', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { cohortId } = z.object({ cohortId: z.string().min(1) }).parse(request.params);
    const before = fleetService.getCohort(cohortId);
    if (!before) {
      return reply.code(404).send({ ok: false, error: 'cohort_not_found' });
    }

    const deleted = fleetService.deleteCohort(cohortId);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: 'cohort_not_found' });
    }

    auditService.record({
      action: 'fleet_cohort_delete',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'deleted',
      metadata: {
        targetResource: {
          resourceType: 'fleet_cohort',
          resourceId: before.id,
          resourceName: before.name,
        },
        beforeSummary: summarize(before),
      },
    });

    return {
      ok: true,
      data: {
        cohortId,
        deleted: true,
      },
    };
  });

  app.post('/api/fleet/cohorts/:cohortId/attach-policy', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { cohortId } = z.object({ cohortId: z.string().min(1) }).parse(request.params);
    const body = fleetAttachPolicySchema.parse(request.body ?? {});
    const before = fleetService.getCohort(cohortId);
    const result = fleetService.attachPolicyToCohort(cohortId, body.policyId);
    if (!result.ok) {
      if (result.reason === 'policy_scope_conflict') {
        const reasonCode =
          result.details && typeof result.details === 'object' && 'reasonCode' in result.details
            ? String((result.details as Record<string, unknown>).reasonCode || 'UNKNOWN')
            : 'UNKNOWN';
        metrics.incCounter(
          'policy_scope_conflict_total',
          1,
          {},
          'Policy scope conflicts detected during cohort attach',
        );
        metrics.incCounter(
          `policy_scope_conflict_${reasonCode.toLowerCase()}`,
          1,
          {},
          'Policy scope conflict by reason code',
        );
        return reply.code(409).send({
          ok: false,
          error: result.reason,
          details: result.details,
        });
      }
      return reply.code(404).send({ ok: false, error: result.reason });
    }

    auditService.record({
      action: 'fleet_policy_attach',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'attached',
      metadata: {
        targetResource: {
          resourceType: 'fleet_cohort',
          resourceId: result.cohort.id,
          resourceName: result.cohort.name,
        },
        policy: {
          policyId: result.policy.id,
          policyName: result.policy.name,
          scope: result.policy.scope,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(result.cohort),
      },
    });

    return {
      ok: true,
      data: {
        cohort: serializeFleetCohort(result.cohort),
        policy: serializeFleetPolicy(result.policy),
      },
    };
  });

  app.get('/api/fleet/policies/diagnostics', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const query = fleetPolicyDiagnosticsQuerySchema.parse(request.query ?? {});
    const compatibility = fleetService.evaluatePolicyCompatibility(query.cohortId, query.policyId);
    if (!compatibility.ok) {
      if (compatibility.reason === 'policy_scope_conflict') {
        return reply.code(409).send({
          ok: false,
          error: compatibility.reason,
          details: compatibility.details,
        });
      }
      return reply.code(404).send({
        ok: false,
        error: compatibility.reason,
      });
    }

    return {
      ok: true,
      data: {
        cohort: serializeFleetCohort(compatibility.cohort),
        policy: serializeFleetPolicy(compatibility.policy),
        compatible: true,
      },
    };
  });

  app.post('/api/fleet/cohorts/:cohortId/detach-policy', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { cohortId } = z.object({ cohortId: z.string().min(1) }).parse(request.params);
    const before = fleetService.getCohort(cohortId);
    if (!before) {
      return reply.code(404).send({ ok: false, error: 'cohort_not_found' });
    }
    if (!before.policyId) {
      return reply.code(409).send({ ok: false, error: 'cohort_policy_not_attached' });
    }

    const detached = fleetService.detachPolicyFromCohort(cohortId);
    if (!detached) {
      return reply.code(404).send({ ok: false, error: 'cohort_not_found' });
    }

    auditService.record({
      action: 'fleet_policy_detach',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'detached',
      metadata: {
        targetResource: {
          resourceType: 'fleet_cohort',
          resourceId: detached.id,
          resourceName: detached.name,
        },
        detachedPolicyId: before.policyId,
        beforeSummary: summarize(before),
        afterSummary: summarize(detached),
      },
    });

    return {
      ok: true,
      data: serializeFleetCohort(detached),
    };
  });

  app.post('/api/fleet/batches/dry-run', async (request, reply) => {
    const principal = requireRole(request, reply, 'viewer');
    if (!principal) {
      return;
    }

    const body = fleetBatchSchema.parse(request.body ?? {});
    if (Object.keys(body.payload).length === 0) {
      return reply.code(422).send({
        ok: false,
        error: 'fleet_payload_required',
      });
    }
    const payloadValidation = validateCommandPayload(body.commandType, body.payload);
    if (!payloadValidation.ok) {
      return reply.code(422).send({
        ok: false,
        error: payloadValidation.error,
        field: payloadValidation.field,
      });
    }

    const targets = resolveFleetTargets({
      cohortId: body.cohortId,
      filters: body.filters,
    });
    if (!targets.ok) {
      return reply.code(404).send({
        ok: false,
        error: targets.reason,
        cohortId: targets.cohortId,
      });
    }

    const run = fleetService.runDryRun(targets.devices, body.payload, body.commandType, targets.cohortRef);
    auditService.record({
      action: 'fleet_batch_dry_run',
      deviceId: 'n/a',
      commandId: run.id,
      actor: principalActor(principal),
      result: 'dry_run',
      metadata: {
        targetResource: {
          resourceType: 'fleet_batch',
          resourceId: run.id,
        },
        cohortRef: targets.cohortRef,
        cohortName: targets.cohortName,
        filterSummary: summarize(targets.filters),
        commandType: body.commandType,
        payloadSummary: summarize(body.payload),
        note: body.note,
      },
    });

    return {
      ok: true,
      data: {
        runId: run.id,
        commandType: run.commandType,
        total: run.targetCount,
        dispatched: 0,
        accepted: 0,
        failed: 0,
        dryRun: true,
      },
    };
  });

  app.post('/api/fleet/batches/apply', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const body = fleetBatchSchema.parse(request.body ?? {});
    if (Object.keys(body.payload).length === 0) {
      return reply.code(422).send({
        ok: false,
        error: 'fleet_payload_required',
      });
    }
    const payloadValidation = validateCommandPayload(body.commandType, body.payload);
    if (!payloadValidation.ok) {
      return reply.code(422).send({
        ok: false,
        error: payloadValidation.error,
        field: payloadValidation.field,
      });
    }
    const note = body.note?.trim();
    if (!note) {
      return reply.code(422).send({
        ok: false,
        error: 'fleet_note_required',
      });
    }
    const actor = principalActor(principal);

    const targets = resolveFleetTargets({
      cohortId: body.cohortId,
      filters: body.filters,
    });
    if (!targets.ok) {
      return reply.code(404).send({
        ok: false,
        error: targets.reason,
        cohortId: targets.cohortId,
      });
    }

    const maxBatchTargets = 1_000;
    if (targets.devices.length > maxBatchTargets) {
      return reply.code(422).send({
        ok: false,
        error: 'fleet_target_limit_exceeded',
        maxBatchTargets,
        matched: targets.devices.length,
      });
    }

    const isHighRiskBatch = targets.devices.length >= highRiskTargetCount;
    let governanceMode: 'none' | 'approval' | 'emergency_override' = 'none';
    let consumedApproval: GovernanceApprovalRecord | undefined;

    if (isHighRiskBatch) {
      if (body.emergencyOverride) {
        if (!authService.authorize(principal, 'admin')) {
          return reply.code(403).send({
            ok: false,
            error: 'governance_emergency_override_forbidden',
            requiredRole: 'admin',
          });
        }
        governanceMode = 'emergency_override';
        auditService.record({
          action: 'governance_override_execute',
          deviceId: 'n/a',
          commandId: 'n/a',
          actor,
          result: 'override',
          metadata: {
            targetResource: {
              resourceType: 'fleet_batch',
              resourceId: 'n/a',
            },
            actionType: 'fleet_batch_apply',
            reason: note,
            targetCount: targets.devices.length,
          },
        });
      } else {
        if (!body.approvalId) {
          return reply.code(409).send({
            ok: false,
            error: 'governance_approval_required',
            actionType: 'fleet_batch_apply',
            highRiskTargetCount,
            matched: targets.devices.length,
          });
        }

        const consumed = governanceService.consumeApproval({
          approvalId: body.approvalId,
          actionType: 'fleet_batch_apply',
          actor,
          cohortRef: targets.cohortRef,
          targetCount: targets.devices.length,
        });
        if (!consumed.ok) {
          return reply.code(409).send({
            ok: false,
            error: 'governance_approval_invalid',
            reason: consumed.reason,
            details: consumed.details,
          });
        }

        governanceMode = 'approval';
        consumedApproval = consumed.approval;
      }
    }

    const sender = (deviceId: string, payload: Record<string, unknown>) => {
      const normalizedPayload = normalizeCommandPayloadForDevice(body.commandType, deviceId, payload);
      const command = commandService.create(deviceId, body.commandType, normalizedPayload);
      if (!command) {
        return {
          accepted: false,
          reason: 'device_not_connected',
        };
      }

      realtimeGateway.sendCommand(deviceId, command);
      return {
        accepted: true,
        commandId: command.commandId,
      };
    };

    const { run, items } = await fleetService.runApply(
      targets.devices,
      body.payload,
      sender,
      body.commandType,
      targets.cohortRef,
    );

    if (run.acceptedCount > 0) {
      metrics.incCounter(
        'command_send_total',
        run.acceptedCount,
        {},
        'Commands sent to devices from fleet batch apply',
      );
    }
    if (run.failedCount > 0) {
      metrics.incCounter(
        'command_send_failed_total',
        run.failedCount,
        {},
        'Failed command send attempts from fleet batch apply',
      );
    }

    auditService.record({
      action: 'fleet_batch_apply',
      deviceId: 'n/a',
      commandId: run.id,
      actor,
      result: run.status,
      metadata: {
        targetResource: {
          resourceType: 'fleet_batch',
          resourceId: run.id,
        },
        cohortRef: targets.cohortRef,
        cohortName: targets.cohortName,
        filterSummary: summarize(targets.filters),
        commandType: body.commandType,
        payloadSummary: summarize(body.payload),
        targetCount: run.targetCount,
        acceptedCount: run.acceptedCount,
        failedCount: run.failedCount,
        note,
        governanceMode,
        approvalId: consumedApproval?.approvalId,
      },
    });

    return {
      ok: true,
      data: {
        runId: run.id,
        commandType: run.commandType,
        total: run.targetCount,
        dispatched: run.targetCount,
        accepted: run.acceptedCount,
        failed: run.failedCount,
        status: run.status,
        items,
      },
    };
  });

  app.get('/api/fleet/batches', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const query = fleetBatchListQuerySchema.parse(request.query);
    const allRuns = fleetService.listBatchRuns();
    const limit = query.limit ?? 100;
    return {
      ok: true,
      data: allRuns.slice(0, limit),
    };
  });

  app.get('/api/fleet/batches/:runId', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const { runId } = z.object({ runId: z.string().min(1) }).parse(request.params);
    const run = fleetService.getBatchRun(runId);
    if (!run) {
      return reply.code(404).send({ ok: false, error: 'fleet_batch_not_found' });
    }

    return {
      ok: true,
      data: run,
    };
  });

  app.get('/api/rollouts', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const query = rolloutListQuerySchema.parse(request.query);
    const plans = rolloutService.listPlans({
      status: query.status as RolloutStatus | undefined,
      site: query.site,
      cohortRef: query.cohortRef,
      strategy: query.strategy as RolloutStrategy | undefined,
      from: query.from,
      to: query.to,
      limit: query.limit ?? 100,
    });
    return {
      ok: true,
      data: plans.map(serializeRolloutPlan),
    };
  });

  app.post('/api/rollouts', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const body = rolloutCreateSchema.parse(request.body ?? {});
    if (Object.keys(body.payload).length === 0) {
      return reply.code(422).send({
        ok: false,
        error: 'rollout_payload_required',
      });
    }
    const targets = resolveFleetTargets({
      cohortId: body.cohortId,
      filters: body.filters,
    });
    if (!targets.ok) {
      return reply.code(404).send({
        ok: false,
        error: targets.reason,
        cohortId: targets.cohortId,
      });
    }

    const created = rolloutService.createPlan({
      name: body.name,
      cohortRef: targets.cohortRef,
      cohortName: targets.cohortName,
      site: targets.filters.site,
      zone: targets.filters.zone,
      strategy: body.strategy,
      payload: body.payload,
      rollbackPayload: body.rollbackPayload,
      targetDeviceIds: targets.devices.map((device) => device.deviceId),
      waveSize: body.waveSize,
      canarySize: body.canarySize,
      waveIntervalMs: body.waveIntervalMs,
      autoRollback: body.autoRollback,
      gate: body.gate,
      faultInjection: body.faultInjection,
      createdBy: principalActor(principal),
    });

    auditService.record({
      action: 'rollout_plan_create',
      deviceId: 'n/a',
      commandId: created.plan.planId,
      actor: principalActor(principal),
      result: 'created',
      metadata: {
        targetResource: {
          resourceType: 'rollout_plan',
          resourceId: created.plan.planId,
          resourceName: created.plan.name,
        },
        cohortRef: created.plan.cohortRef,
        strategy: created.plan.strategy,
        targetCount: created.plan.targetCount,
        gate: created.plan.gate,
      },
    });

    return reply.code(201).send({
      ok: true,
      data: {
        plan: serializeRolloutPlan(created.plan),
        execution: created.execution,
        waves: created.waves,
      },
    });
  });

  app.get('/api/rollouts/:planId', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const plan = rolloutService.getPlan(planId);
    if (!plan) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }

    return {
      ok: true,
      data: {
        plan: serializeRolloutPlan(plan),
        execution: rolloutService.getLatestExecution(planId),
        summary: rolloutService.summarizeExecution(planId),
      },
    };
  });

  app.get('/api/rollouts/:planId/waves', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const plan = rolloutService.getPlan(planId);
    if (!plan) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }

    return {
      ok: true,
      data: rolloutService.listWaves(planId),
    };
  });

  app.get('/api/rollouts/:planId/events', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const query = rolloutEventsQuerySchema.parse(request.query);
    const plan = rolloutService.getPlan(planId);
    if (!plan) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }

    return {
      ok: true,
      data: rolloutService.listEvents(planId, query.limit ?? 200),
    };
  });

  app.post('/api/rollouts/:planId/start', async (request, reply) => {
    const principal = requireRole(request, reply, 'release_manager');
    if (!principal) {
      return;
    }
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const body = rolloutOptionalNoteSchema.parse(request.body ?? {});
    const actor = principalActor(principal);
    const plan = rolloutService.getPlan(planId);
    const currentExecution = rolloutService.getLatestExecution(planId);
    if (!plan || !currentExecution) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }

    const isInitialStart = currentExecution.status === 'draft' || currentExecution.status === 'scheduled';
    const isHighRiskRollout = isInitialStart && plan.targetCount >= highRiskTargetCount;
    let governanceMode: 'none' | 'approval' | 'emergency_override' = 'none';
    let consumedApproval: GovernanceApprovalRecord | undefined;

    if (isHighRiskRollout) {
      if (body.emergencyOverride) {
        if (!authService.authorize(principal, 'admin')) {
          return reply.code(403).send({
            ok: false,
            error: 'governance_emergency_override_forbidden',
            requiredRole: 'admin',
          });
        }
        if (!body.note?.trim()) {
          return reply.code(422).send({
            ok: false,
            error: 'governance_override_note_required',
          });
        }
        governanceMode = 'emergency_override';
        auditService.record({
          action: 'governance_override_execute',
          deviceId: 'n/a',
          commandId: planId,
          actor,
          result: 'override',
          metadata: {
            targetResource: {
              resourceType: 'rollout_plan',
              resourceId: planId,
              resourceName: plan.name,
            },
            actionType: 'rollout_start',
            reason: body.note,
            targetCount: plan.targetCount,
          },
        });
      } else {
        if (!body.approvalId) {
          return reply.code(409).send({
            ok: false,
            error: 'governance_approval_required',
            actionType: 'rollout_start',
            highRiskTargetCount,
            targetCount: plan.targetCount,
          });
        }

        const consumed = governanceService.consumeApproval({
          approvalId: body.approvalId,
          actionType: 'rollout_start',
          actor,
          resourceId: plan.planId,
          cohortRef: plan.cohortRef,
          targetCount: plan.targetCount,
        });
        if (!consumed.ok) {
          return reply.code(409).send({
            ok: false,
            error: 'governance_approval_invalid',
            reason: consumed.reason,
            details: consumed.details,
          });
        }
        governanceMode = 'approval';
        consumedApproval = consumed.approval;
      }
    }

    const execution = rolloutService.startPlan(planId, actor, body.note);
    if (!execution) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }

    auditService.record({
      action: 'rollout_start',
      deviceId: 'n/a',
      commandId: execution.executionId,
      actor,
      result: execution.status,
      metadata: {
        targetResource: {
          resourceType: 'rollout_plan',
          resourceId: plan.planId,
          resourceName: plan.name,
        },
        targetCount: plan.targetCount,
        strategy: plan.strategy,
        governanceMode,
        approvalId: consumedApproval?.approvalId,
        note: body.note,
      },
    });

    return {
      ok: true,
      data: execution,
    };
  });

  app.post('/api/rollouts/:planId/pause', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const body = rolloutActionNoteSchema.parse(request.body ?? {});
    const execution = rolloutService.pausePlan(planId, principalActor(principal), body.note);
    if (!execution) {
      return reply.code(409).send({ ok: false, error: 'rollout_not_running' });
    }
    return {
      ok: true,
      data: execution,
    };
  });

  app.post('/api/rollouts/:planId/resume', async (request, reply) => {
    const principal = requireRole(request, reply, 'release_manager');
    if (!principal) {
      return;
    }
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const body = rolloutOptionalNoteSchema.parse(request.body ?? {});
    const current = rolloutService.getLatestExecution(planId);
    if (!current) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }
    if (current.status !== 'paused') {
      return reply.code(409).send({ ok: false, error: 'rollout_not_paused' });
    }

    const execution = rolloutService.startPlan(planId, principalActor(principal), body.note);
    if (!execution) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }
    return {
      ok: true,
      data: execution,
    };
  });

  app.post('/api/rollouts/:planId/cancel', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const body = rolloutActionNoteSchema.parse(request.body ?? {});
    const execution = rolloutService.cancelPlan(planId, principalActor(principal), body.note);
    if (!execution) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }
    return {
      ok: true,
      data: execution,
    };
  });

  app.post('/api/rollouts/:planId/rollback', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params);
    const body = rolloutActionNoteSchema.parse(request.body ?? {});
    const execution = await rolloutService.rollbackPlan(
      planId,
      principalActor(principal),
      body.note,
      buildRolloutSender(),
    );
    if (!execution) {
      return reply.code(404).send({ ok: false, error: 'rollout_plan_not_found' });
    }
    return {
      ok: true,
      data: execution,
    };
  });

  app.post('/api/rollouts/process', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const result = await rolloutService.processRunningPlans(buildRolloutSender());
    if (result.dispatched > 0) {
      metrics.incCounter('command_send_total', result.acked, {}, 'Commands sent from rollout process endpoint');
      if (result.failed + result.timeout > 0) {
        metrics.incCounter(
          'command_send_failed_total',
          result.failed + result.timeout,
          {},
          'Failed rollout command send attempts from process endpoint',
        );
      }
    }
    if (result.waveCompleted > 0) {
      metrics.incCounter(
        'rollout_wave_completed_total',
        result.waveCompleted,
        {},
        'Rollout waves completed by rollout process endpoint',
      );
    }
    if (result.autoStopped > 0) {
      metrics.incCounter(
        'rollout_auto_stop_total',
        result.autoStopped,
        {},
        'Rollout auto-stop events from rollout process endpoint',
      );
    }
    if (result.rollbacks > 0) {
      metrics.incCounter(
        'rollout_rollback_total',
        result.rollbacks,
        {},
        'Rollout rollback events from rollout process endpoint',
      );
    }
    return {
      ok: true,
      data: result,
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
        limit: query.limit ?? 200,
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

    const deleted = await deviceService.deleteStrict(deviceId);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }

    auditService.record({
      action: 'device_delete',
      deviceId,
      commandId: 'n/a',
      actor: principalActor(principal),
      result: 'archived',
      metadata: {
        targetResource: {
          resourceType: 'device',
          resourceId: deviceId,
          resourceName: before.name,
        },
        beforeSummary: summarize(before),
      },
    });

    return {
      ok: true,
      data: {
        deleted: true,
        deviceId,
        telemetryDeleted: deleted.telemetryDeleted,
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
      const command = commandService.create(deviceId, body.commandType, normalizedPayload);
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
      metrics.incCounter(
        'command_send_total',
        accepted,
        {},
        'Commands sent to devices from OTA dispatch',
      );
    }
    if (failed > 0) {
      metrics.incCounter(
        'command_send_failed_total',
        failed,
        {},
        'Failed command send attempts from OTA dispatch',
      );
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

  app.get('/api/incidents', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const query = incidentListQuerySchema.parse(request.query);
    return {
      ok: true,
      data: incidentService.list({
        status: query.status,
        owner: query.owner,
        severity: query.severity,
        site: query.site,
        from: query.from,
        to: query.to,
        limit: query.limit ?? 100,
      }),
    };
  });

  app.get('/api/incidents/summary', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const query = incidentListQuerySchema.parse(request.query);
    return {
      ok: true,
      data: incidentService.summarize({
        status: query.status,
        owner: query.owner,
        severity: query.severity,
        site: query.site,
        from: query.from,
        to: query.to,
      }),
    };
  });

  app.get('/api/incidents/export', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }

    const query = incidentExportQuerySchema.parse(request.query);
    const items = incidentService.list({
      status: query.status,
      owner: query.owner,
      severity: query.severity,
      site: query.site,
      from: query.from,
      to: query.to,
      limit: query.limit ?? 500,
    });
    const actor = principalActor(principal);

    auditService.record({
      action: 'incident_export',
      deviceId: 'n/a',
      commandId: 'n/a',
      actor,
      result: 'exported',
      metadata: {
        targetResource: {
          resourceType: 'incident_export',
          resourceId: `incidents:${query.format}`,
        },
        filterSummary: summarize(query),
        exportedCount: items.length,
      },
    });

    if (query.format === 'ndjson') {
      reply.type('application/x-ndjson; charset=utf-8');
      return items.map((item) => JSON.stringify(item)).join('\n');
    }

    return {
      ok: true,
      data: {
        format: query.format,
        exportedCount: items.length,
        exportedAt: new Date().toISOString(),
        items,
      },
    };
  });

  app.post('/api/incidents', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const body = incidentCreateSchema.parse(request.body);
    const actor = principalActor(principal);
    const sourceAlert = body.alertId ? alertService.getAlert(body.alertId) : null;
    if (body.alertId && !sourceAlert) {
      return reply.code(404).send({ ok: false, error: 'alert_not_found' });
    }

    const created = incidentService.create({
      title: body.title,
      severity: sourceAlert?.severity ?? body.severity,
      actor,
      site: body.site ?? (sourceAlert ? deviceService.getMetadata(sourceAlert.deviceId)?.site : undefined),
      owner: body.owner,
      note: body.note,
      alertId: sourceAlert?.alertId ?? body.alertId,
      deviceId: sourceAlert?.deviceId,
    });

    auditService.record({
      action: 'incident_create',
      deviceId: created.deviceId ?? sourceAlert?.deviceId ?? 'n/a',
      commandId: 'n/a',
      actor,
      result: 'created',
      metadata: {
        targetResource: {
          resourceType: 'incident',
          resourceId: created.incidentId,
          resourceName: created.title,
        },
        afterSummary: summarize(created),
        alertId: created.primaryAlertId,
      },
    });
    return reply.code(201).send({ ok: true, data: created });
  });

  app.get('/api/incidents/:incidentId', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const { incidentId } = z.object({ incidentId: z.string().min(1) }).parse(request.params);
    const incident = incidentService.get(incidentId);
    if (!incident) {
      return reply.code(404).send({ ok: false, error: 'incident_not_found' });
    }
    return { ok: true, data: incident };
  });

  app.get('/api/incidents/:incidentId/timeline', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }

    const { incidentId } = z.object({ incidentId: z.string().min(1) }).parse(request.params);
    const query = incidentTimelineQuerySchema.parse(request.query);
    const incident = incidentService.get(incidentId);
    if (!incident) {
      return reply.code(404).send({ ok: false, error: 'incident_not_found' });
    }
    const entries = incidentService.listTimeline(incidentId, query.limit ?? 200);
    return {
      ok: true,
      data: {
        incident,
        entries,
        returnedEntries: entries.length,
        firstEntryAt: entries[0]?.createdAt,
        lastEntryAt: entries[entries.length - 1]?.createdAt,
      },
    };
  });

  app.put('/api/incidents/:incidentId/assign', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { incidentId } = z.object({ incidentId: z.string().min(1) }).parse(request.params);
    const bodyResult = incidentAssignSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return workflowValidationError(reply, 'incident_assign', 'owner_required', {
        field: 'owner',
      });
    }
    const body = bodyResult.data;
    const actor = principalActor(principal);
    const before = incidentService.get(incidentId);
    if (!before) {
      return workflowResourceNotFound(reply, 'incident_assign', 'incident_not_found', {
        resourceType: 'incident',
        resourceId: incidentId,
      });
    }
    if (before.status === 'closed') {
      return workflowTransitionBlocked(reply, 'incident_assign', 'incident_closed', {
        incidentId,
        status: before.status,
      });
    }
    if (before.status === 'resolved') {
      return workflowTransitionBlocked(reply, 'incident_assign', 'incident_resolved', {
        incidentId,
        status: before.status,
      });
    }

    const updated = incidentService.assign(incidentId, body.owner, actor, body.note);
    if (!updated) {
      return workflowTransitionBlocked(reply, 'incident_assign', 'incident_not_assignable', {
        incidentId,
      });
    }

    auditService.record({
      action: 'incident_assign',
      deviceId: updated.deviceId ?? 'n/a',
      commandId: 'n/a',
      actor,
      result: 'assigned',
      metadata: {
        targetResource: {
          resourceType: 'incident',
          resourceId: updated.incidentId,
          resourceName: updated.title,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
        workflow: {
          transition: `${before.status} -> ${updated.status}`,
          previousOwner: before.owner,
          nextOwner: updated.owner,
        },
        owner: updated.owner,
        note: body.note,
      },
    });
    return { ok: true, data: updated };
  });

  app.post('/api/incidents/:incidentId/notes', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { incidentId } = z.object({ incidentId: z.string().min(1) }).parse(request.params);
    const bodyResult = incidentNoteSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return workflowValidationError(reply, 'incident_note', 'note_required', {
        field: 'note',
      });
    }
    const body = bodyResult.data;
    const actor = principalActor(principal);
    const before = incidentService.get(incidentId);
    if (!before) {
      return workflowResourceNotFound(reply, 'incident_note', 'incident_not_found', {
        resourceType: 'incident',
        resourceId: incidentId,
      });
    }
    if (before.status === 'closed') {
      return workflowTransitionBlocked(reply, 'incident_note', 'incident_closed', {
        incidentId,
        status: before.status,
      });
    }

    const updated = incidentService.addNote(incidentId, actor, body.note);
    if (!updated) {
      return workflowTransitionBlocked(reply, 'incident_note', 'incident_not_noteable', {
        incidentId,
      });
    }

    auditService.record({
      action: 'incident_note',
      deviceId: updated.deviceId ?? 'n/a',
      commandId: 'n/a',
      actor,
      result: 'noted',
      metadata: {
        targetResource: {
          resourceType: 'incident',
          resourceId: updated.incidentId,
          resourceName: updated.title,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
        workflow: {
          transition: `${before.status} -> ${updated.status}`,
        },
        note: body.note,
      },
    });
    return { ok: true, data: updated };
  });

  app.post('/api/incidents/:incidentId/resolve', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { incidentId } = z.object({ incidentId: z.string().min(1) }).parse(request.params);
    const bodyResult = incidentNoteSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return workflowValidationError(reply, 'incident_resolve', 'note_required', {
        field: 'note',
      });
    }
    const body = bodyResult.data;
    const actor = principalActor(principal);
    const before = incidentService.get(incidentId);
    if (!before) {
      return workflowResourceNotFound(reply, 'incident_resolve', 'incident_not_found', {
        resourceType: 'incident',
        resourceId: incidentId,
      });
    }
    if (before.status === 'closed') {
      return workflowTransitionBlocked(reply, 'incident_resolve', 'incident_closed', {
        incidentId,
        status: before.status,
      });
    }
    if (before.status === 'resolved') {
      return workflowTransitionBlocked(reply, 'incident_resolve', 'incident_already_resolved', {
        incidentId,
        status: before.status,
      });
    }

    const updated = incidentService.resolve(incidentId, actor, body.note);
    if (!updated) {
      return workflowTransitionBlocked(reply, 'incident_resolve', 'incident_not_resolvable', {
        incidentId,
      });
    }

    if (updated.primaryAlertId) {
      const linkedAlert = alertService.resolveAlert(updated.primaryAlertId, actor, body.note);
      if (linkedAlert) {
        realtimeGateway.broadcastAlert(linkedAlert);
      }
    }

    auditService.record({
      action: 'incident_resolve',
      deviceId: updated.deviceId ?? 'n/a',
      commandId: 'n/a',
      actor,
      result: 'resolved',
      metadata: {
        targetResource: {
          resourceType: 'incident',
          resourceId: updated.incidentId,
          resourceName: updated.title,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
        workflow: {
          transition: `${before.status} -> ${updated.status}`,
          noteRequired: true,
        },
        note: body.note,
      },
    });
    return { ok: true, data: updated };
  });

  app.post('/api/incidents/:incidentId/close', async (request, reply) => {
    const principal = requireRole(request, reply, 'operator');
    if (!principal) {
      return;
    }

    const { incidentId } = z.object({ incidentId: z.string().min(1) }).parse(request.params);
    const bodyResult = incidentNoteSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return workflowValidationError(reply, 'incident_close', 'note_required', {
        field: 'note',
      });
    }
    const body = bodyResult.data;
    const actor = principalActor(principal);
    const before = incidentService.get(incidentId);
    if (!before) {
      return workflowResourceNotFound(reply, 'incident_close', 'incident_not_found', {
        resourceType: 'incident',
        resourceId: incidentId,
      });
    }
    if (before.status === 'closed') {
      return workflowTransitionBlocked(reply, 'incident_close', 'incident_already_closed', {
        incidentId,
        status: before.status,
      });
    }
    if (before.status !== 'resolved') {
      return workflowTransitionBlocked(reply, 'incident_close', 'incident_must_be_resolved_before_close', {
        incidentId,
        status: before.status,
      });
    }

    const updated = incidentService.close(incidentId, actor, body.note);
    if (!updated) {
      return workflowTransitionBlocked(reply, 'incident_close', 'incident_not_closable', {
        incidentId,
      });
    }

    auditService.record({
      action: 'incident_close',
      deviceId: updated.deviceId ?? 'n/a',
      commandId: 'n/a',
      actor,
      result: 'closed',
      metadata: {
        targetResource: {
          resourceType: 'incident',
          resourceId: updated.incidentId,
          resourceName: updated.title,
        },
        beforeSummary: summarize(before),
        afterSummary: summarize(updated),
        workflow: {
          transition: `${before.status} -> ${updated.status}`,
          noteRequired: true,
        },
        note: body.note,
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
    const command = commandService.create(deviceId, body.type, normalizedPayload);
    if (!command) {
      metrics.incCounter('command_send_failed_total', 1, {}, 'Failed command send attempts');
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
    metrics.incCounter('command_send_total', 1, {}, 'Commands sent to devices');
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

  app.get('/socket-info', async () => ({
    ok: true,
    transport: 'socket.io',
    path: '/socket.io',
    events: [
      'device:telemetry',
      'device:heartbeat',
      'device:metadata',
      'device:command',
      'device:command:ack',
      'telemetry',
      'alert',
      'alert:ack',
      'alert:resolve',
      'incident:create',
      'incident:update',
    ],
  }));

}
