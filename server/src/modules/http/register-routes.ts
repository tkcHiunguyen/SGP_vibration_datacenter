import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../shared/config.js';
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
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { renderDashboardTestPage } from './dashboard-test.page.js';

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

  const telemetryHistoryQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
    bucketMs: z.coerce.number().int().positive().max(86_400_000).optional(),
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

  const fleetBatchSchema = z.object({
    cohortId: z.string().min(1).optional(),
    filters: fleetCohortFiltersSchema.optional(),
    payload: z.record(z.string(), z.unknown()),
    note: z.string().max(2_000).optional(),
    approvalId: z.string().min(1).optional(),
    emergencyOverride: z.boolean().optional(),
  });

  const fleetBatchListQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
  });

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

  app.get('/', async (_, reply) => {
    return reply.sendFile('index.html');
  });

  app.get('/fleet', async (_, reply) => {
    return reply.sendFile('index.html');
  });

  app.get('/threed', async (_, reply) => {
    return reply.sendFile('index.html');
  });

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

    const run = fleetService.runDryRun(targets.devices, body.payload, targets.cohortRef);
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
        payloadSummary: summarize(body.payload),
        note: body.note,
      },
    });

    return {
      ok: true,
      data: {
        runId: run.id,
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
      const command = commandService.create(deviceId, 'set_config', payload);
      if (!command) {
        return {
          accepted: false,
          reason: 'device_not_connected',
        };
      }

      realtimeGateway.sendCommand(deviceId, command);
      return { accepted: true };
    };

    const { run, items } = await fleetService.runApply(
      targets.devices,
      body.payload,
      sender,
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

  app.post('/api/devices', async (request, reply) => {
    const principal = requireRole(request, reply, 'admin');
    if (!principal) {
      return;
    }
    const body = deviceCreateSchema.parse(request.body);
    const created = deviceService.register(body);
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
    const updated = deviceService.update(deviceId, body);
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

  app.get('/api/commands/recent', async (request, reply) => {
    if (!requireRole(request, reply, 'viewer')) {
      return;
    }
    return {
      ok: true,
      data: commandService.listRecent(100),
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
      type: z.enum(['capture', 'calibrate', 'restart', 'set_config']),
      payload: z.record(z.string(), z.unknown()).optional(),
    });

    const { deviceId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const actor = principalActor(principal);

    const command = commandService.create(deviceId, body.type, body.payload || {});
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
          payload: body.payload || {},
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
        payload: body.payload || {},
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

  app.get('/dashboard-test', async (_, reply) => {
    reply.type('text/html; charset=utf-8');
    return renderDashboardTestPage();
  });
}
