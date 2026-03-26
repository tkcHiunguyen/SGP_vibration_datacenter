import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { env } from './shared/config.js';
import { InMemoryAlertRepository } from './modules/alert/in-memory-alert.repository.js';
import { AlertService } from './modules/alert/alert.service.js';
import { InMemoryAuditRepository } from './modules/audit/in-memory-audit.repository.js';
import { AuditService } from './modules/audit/audit.service.js';
import { createAuthServiceFromEnv } from './modules/auth/index.js';
import { InMemoryDeviceRepository } from './modules/device/in-memory-device.repository.js';
import { DeviceService } from './modules/device/device.service.js';
import { InMemoryTelemetryRepository } from './modules/telemetry/in-memory-telemetry.repository.js';
import { TelemetryService } from './modules/telemetry/telemetry.service.js';
import { InMemoryCommandRepository } from './modules/command/in-memory-command.repository.js';
import { CommandService } from './modules/command/command.service.js';
import { InMemoryIncidentRepository } from './modules/incident/in-memory-incident.repository.js';
import { IncidentService } from './modules/incident/incident.service.js';
import { FleetService, InMemoryFleetRepository } from './modules/fleet/index.js';
import { GovernanceService, InMemoryGovernanceRepository } from './modules/governance/index.js';
import { InMemoryRolloutRepository, RolloutService } from './modules/rollout/index.js';
import {
  createHealthSnapshot,
  createObservabilityMetrics,
  registerObservabilityRoutes,
} from './modules/observability/index.js';
import { getSharedPostgresAccess, isPostgresAccessEnabled } from './modules/persistence/postgres-access.js';
import { SocketIoGateway } from './modules/realtime/socket-io.gateway.js';
import { registerRoutes } from './modules/http/register-routes.js';
import { registerSocketHandlers } from './modules/realtime/socket.handlers.js';
import { TelemetryIngressGuard } from './modules/reliability/telemetry-ingress-guard.js';

const serviceName = 'sgp-vibration-datacenter-server';
const app = Fastify({
  logger: { level: env.LOG_LEVEL },
});

await app.register(cors, { origin: true });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, {
  max: env.RATE_LIMIT_MAX,
  timeWindow: env.RATE_LIMIT_TIME_WINDOW,
});
await app.register(fastifyStatic, {
  root: join(process.cwd(), 'public', 'app'),
  prefix: '/app/',
});

const postgresAccess = getSharedPostgresAccess();
await postgresAccess?.ensureReady();

const deviceRepository = await InMemoryDeviceRepository.create(postgresAccess);
const telemetryRepository = new InMemoryTelemetryRepository();
const commandRepository = new InMemoryCommandRepository();
const alertRepository = await InMemoryAlertRepository.create(postgresAccess);
const auditRepository = await InMemoryAuditRepository.create(postgresAccess);
const incidentRepository = await InMemoryIncidentRepository.create(postgresAccess);
const fleetRepository = new InMemoryFleetRepository();
const governanceRepository = new InMemoryGovernanceRepository();
const rolloutRepository = new InMemoryRolloutRepository();

const authService = createAuthServiceFromEnv(env);
const deviceService = new DeviceService(deviceRepository);
const telemetryService = new TelemetryService(telemetryRepository, deviceService);
const alertService = new AlertService(alertRepository);
const auditService = new AuditService(auditRepository);
const incidentService = new IncidentService(incidentRepository);
const fleetService = new FleetService(fleetRepository);
const governanceService = new GovernanceService(governanceRepository, env.GOVERNANCE_APPROVAL_TTL_MINUTES);
const rolloutService = new RolloutService(rolloutRepository);
const commandServiceWithTimeout = new CommandService(
  deviceService,
  commandRepository,
  env.COMMAND_TIMEOUT_MS,
);
const metrics = createObservabilityMetrics({ service: serviceName });
const telemetryIngressGuard = new TelemetryIngressGuard({
  dedupeWindowMs: env.TELEMETRY_DEDUPE_WINDOW_MS,
  maxPerDevicePerMinute: env.TELEMETRY_MAX_PER_DEVICE_PER_MINUTE,
  maxGlobalPerMinute: env.TELEMETRY_MAX_GLOBAL_PER_MINUTE,
});

const realtimeGateway = new SocketIoGateway(app.server);

const updateRuntimeGauges = () => {
  const alertSummary = alertService.summarizeAlerts();
  const governanceSummary = governanceService.summarize();
  metrics.setGauge('connected_devices', deviceService.countConnected(), {}, 'Connected device sessions');
  metrics.setGauge('connected_clients', realtimeGateway.connectedClientsCount(), {}, 'Connected Socket.IO clients');
  metrics.setGauge('active_alerts', alertService.countActiveAlerts(), {}, 'Active alerts');
  metrics.setGauge(
    'alert_coalesced_signals_total',
    alertSummary.coalescedSignals,
    {},
    'Coalesced alert signals retained on existing alerts',
  );
  metrics.setGauge(
    'alert_suppressed_signals_total',
    alertSummary.suppressedSignals,
    {},
    'Suppressed alert re-trigger signals',
  );
  metrics.setGauge(
    'alert_flapping_signals_total',
    alertSummary.flappingSignals,
    {},
    'Alert signals classified as flapping',
  );
  metrics.setGauge(
    'postgres_persistence_enabled',
    isPostgresAccessEnabled() ? 1 : 0,
    {},
    'Whether Postgres-backed persistence is configured',
  );
  metrics.setGauge(
    'rollout_running_plans',
    rolloutService.listPlans({ status: 'running', limit: 10_000 }).length,
    {},
    'Running rollout plans',
  );
  metrics.setGauge(
    'governance_pending_approvals',
    governanceSummary.pending,
    {},
    'Governance approvals pending decision',
  );
};
updateRuntimeGauges();

registerRoutes({
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
  commandService: commandServiceWithTimeout,
  metrics,
  realtimeGateway,
});

registerSocketHandlers({
  app,
  deviceService,
  telemetryService,
  alertService,
  commandService: commandServiceWithTimeout,
  metrics,
  realtimeGateway,
  telemetryIngressGuard,
  deviceAuthToken: env.DEVICE_AUTH_TOKEN,
});

registerObservabilityRoutes({
  app,
  serviceName,
  metrics,
  getLiveness: () =>
    createHealthSnapshot({
      service: serviceName,
      kind: 'liveness',
      checks: [
        {
          name: 'process',
          status: 'healthy',
          message: 'Fastify process is running',
          details: {
            uptimeSec: Math.round(process.uptime()),
            pid: process.pid,
          },
        },
      ],
    }),
  getReadiness: async () => {
    const checks: Array<{
      name: string;
      status: 'healthy' | 'degraded' | 'unhealthy';
      message: string;
      details?: Record<string, unknown>;
    }> = [
      {
        name: 'http',
        status: 'healthy',
        message: 'HTTP server initialized',
      },
      {
        name: 'telemetry_store',
        status: 'healthy',
        message: 'Telemetry file-backed persistence available',
      },
    ];

    if (!postgresAccess) {
      checks.push({
        name: 'postgres',
        status: 'degraded',
        message: 'Postgres persistence not configured; using local fallback',
      });
    } else {
      try {
        await postgresAccess.ensureReady();
        await postgresAccess.execute('SELECT 1');
        checks.push({
          name: 'postgres',
          status: 'healthy',
          message: 'Postgres persistence ready',
        });
      } catch (error) {
        checks.push({
          name: 'postgres',
          status: 'unhealthy',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return createHealthSnapshot({
      service: serviceName,
      kind: 'readiness',
      checks,
    });
  },
});

const commandTimeoutSweep = setInterval(() => {
  const changed = commandServiceWithTimeout.processTimeouts();
  updateRuntimeGauges();
  if (changed > 0) {
    metrics.incCounter('command_timeouts_total', changed, {}, 'Commands marked as timeout');
    app.log.warn({ count: changed }, 'Command(s) marked as timeout');
  }
}, env.COMMAND_TIMEOUT_SWEEP_MS);
commandTimeoutSweep.unref();

const runtimeGaugeSweep = setInterval(() => {
  updateRuntimeGauges();
}, 5_000);
runtimeGaugeSweep.unref();

const rolloutEngineSweep = setInterval(() => {
  void rolloutService.processRunningPlans((deviceId, payload) => {
    const command = commandServiceWithTimeout.create(deviceId, 'set_config', payload);
    if (!command) {
      return {
        status: 'timeout',
        reason: 'device_not_connected',
      } as const;
    }
    realtimeGateway.sendCommand(deviceId, command);
    return {
      status: 'acked',
    } as const;
  }).then((result) => {
    if (result.dispatched > 0) {
      metrics.incCounter('command_send_total', result.acked, {}, 'Commands sent from rollout engine');
      if (result.failed + result.timeout > 0) {
        metrics.incCounter(
          'command_send_failed_total',
          result.failed + result.timeout,
          {},
          'Failed rollout command send attempts',
        );
      }
    }
    if (result.waveCompleted > 0) {
      metrics.incCounter(
        'rollout_wave_completed_total',
        result.waveCompleted,
        {},
        'Rollout waves completed by rollout engine',
      );
    }
    if (result.autoStopped > 0) {
      metrics.incCounter(
        'rollout_auto_stop_total',
        result.autoStopped,
        {},
        'Rollout executions auto-stopped by gate violations',
      );
    }
    if (result.rollbacks > 0) {
      metrics.incCounter(
        'rollout_rollback_total',
        result.rollbacks,
        {},
        'Rollout rollback executions completed',
      );
    }
  });
}, 1_000);
rolloutEngineSweep.unref();

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  app.log.info({ signal }, 'Shutting down server...');
  clearInterval(commandTimeoutSweep);
  clearInterval(runtimeGaugeSweep);
  clearInterval(rolloutEngineSweep);
  realtimeGateway.close();
  await app.close();
  await postgresAccess?.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(
  { port: env.PORT, host: env.HOST, postgresPersistence: isPostgresAccessEnabled() },
  'Server started',
);
