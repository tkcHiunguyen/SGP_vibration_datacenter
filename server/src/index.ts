import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env, listenHosts } from './shared/config.js';
import { InMemoryAlertRepository } from './modules/alert/in-memory-alert.repository.js';
import { AlertService } from './modules/alert/alert.service.js';
import { InMemoryAuditRepository } from './modules/audit/in-memory-audit.repository.js';
import { AuditService } from './modules/audit/audit.service.js';
import { createAuthServiceFromEnv } from './modules/auth/index.js';
import { InMemoryDeviceRepository } from './modules/device/in-memory-device.repository.js';
import { DeviceService } from './modules/device/device.service.js';
import { DisplayScreenshotService } from './modules/display-screenshot/display-screenshot.service.js';
import { InMemoryDataExportJobRepository } from './modules/data-export/in-memory-data-export-job.repository.js';
import { MySqlDataExportJobRepository } from './modules/data-export/mysql-data-export-job.repository.js';
import { MySqlTelemetryRepository } from './modules/telemetry/mysql-telemetry.repository.js';
import { TelemetryService } from './modules/telemetry/telemetry.service.js';
import { InMemoryCommandRepository } from './modules/command/in-memory-command.repository.js';
import { MySqlCommandRepository } from './modules/command/mysql-command.repository.js';
import { CommandService } from './modules/command/command.service.js';
import { resolveActiveMySqlAccess } from './modules/persistence/mysql-access.js';
import { CompositeRealtimeGateway } from './modules/realtime/composite-realtime.gateway.js';
import { SocketIoGateway } from './modules/realtime/socket-io.gateway.js';
import { registerRoutes } from './modules/http/register-routes.js';
import { registerSocketHandlers } from './modules/realtime/socket.handlers.js';
import { TelemetryIngressGuard } from './modules/reliability/telemetry-ingress-guard.js';
import { ServerRuntimeTracker } from './modules/reliability/server-runtime-tracker.js';
import { SpectrumStorageService } from './modules/spectrum/spectrum-storage.service.js';
import { ZoneService } from './modules/zone/zone.service.js';
import { createSgpDataJobRepository } from './modules/sgpdata/sgpdata-job.repository.js';
import { SgpDataImportWorker } from './modules/sgpdata/sgpdata-import.worker.js';
import { SgpDataImportService } from './modules/sgpdata/sgpdata-import.service.js';
import { SgpDataExportWorker } from './modules/sgpdata/sgpdata-export.worker.js';
import { SgpDataExportService } from './modules/sgpdata/sgpdata-export.service.js';
import { DeviceThresholdAnalysisService } from './modules/analysis/device-threshold-analysis.service.js';

const serviceName = 'sgp-vibration-datacenter-server';
const isRunningViaPnpm = (process.env.npm_execpath || '').includes('pnpm');

type ServerListener = {
  host: string;
  app: FastifyInstance;
};

function createApp(): FastifyInstance {
  return Fastify({
    logger: {
      level: env.LOG_LEVEL,
      formatters: {
        bindings: () => ({}),
        level: (label) => (isRunningViaPnpm ? {} : { level: label }),
      },
      timestamp: false,
    },
    disableRequestLogging: true,
  });
}

async function registerAppPlugins(app: FastifyInstance, otaUploadRoot: string): Promise<void> {
  await app.register(cors, { origin: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
  });
  await app.register(multipart, {
    limits: {
      // .sgpdata maintenance imports can be much larger than normal uploads.
      fileSize: 2 * 1024 * 1024 * 1024,
      files: 1,
    },
  });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public', 'app'),
    prefix: '/app/',
    cacheControl: false,
    setHeaders(response, filePath) {
      const mustRefresh = filePath.endsWith('index.html') || filePath.endsWith('version.json');
      response.setHeader('cache-control', mustRefresh ? 'no-store, no-cache, must-revalidate' : 'public, max-age=0');
    },
  });
  await app.register(fastifyStatic, {
    root: otaUploadRoot,
    prefix: '/ota-bins/',
    decorateReply: false,
    index: false,
  });
}

const listeners: ServerListener[] = listenHosts.map((host) => ({
  host,
  app: createApp(),
}));
const primaryListener = listeners[0];
if (!primaryListener) {
  throw new Error('At least one listen host is required');
}
const app = primaryListener.app;

const otaUploadRoot = join(process.cwd(), 'uploads', 'ota');
await mkdir(otaUploadRoot, { recursive: true });
for (const listener of listeners) {
  await registerAppPlugins(listener.app, otaUploadRoot);
}

const socketGateways = listeners.map((listener) => new SocketIoGateway(listener.app.server));
const realtimeGateway = new CompositeRealtimeGateway(socketGateways);

const mysqlRuntime = await resolveActiveMySqlAccess({
  fallbackOnUnavailable: env.DB_FALLBACK_ON_UNAVAILABLE,
  logger: app.log,
});
const mysqlAccess = mysqlRuntime.access;
const persistenceMode = mysqlRuntime.status.mode;
const serverRuntimeTracker = new ServerRuntimeTracker(mysqlAccess, serviceName, env.SERVER_HEARTBEAT_MS);
const serverRuntime = await serverRuntimeTracker.start();

const deviceRepository = await InMemoryDeviceRepository.create(mysqlAccess, {
  staleSessionClosedAt: serverRuntime?.previousShutdownAt,
});
const telemetryRepository = await MySqlTelemetryRepository.create(mysqlAccess);
const commandRepository = mysqlAccess
  ? await MySqlCommandRepository.create(mysqlAccess)
  : new InMemoryCommandRepository();
const dataExportJobRepository = mysqlAccess
  ? await MySqlDataExportJobRepository.create(mysqlAccess)
  : new InMemoryDataExportJobRepository();
const alertRepository = await InMemoryAlertRepository.create(mysqlAccess);
const auditRepository = await InMemoryAuditRepository.create(mysqlAccess);

const authService = createAuthServiceFromEnv(env);
const zoneService = new ZoneService(mysqlAccess);
const deviceService = new DeviceService(deviceRepository, {
  resolveSocketZone: (zone) => zoneService.resolveExistingCode(zone),
});
const telemetryService = new TelemetryService(telemetryRepository, deviceService);
const deviceThresholdAnalysisService = new DeviceThresholdAnalysisService(deviceService, telemetryService);
const displayScreenshotService = new DisplayScreenshotService();
const spectrumStorageService = new SpectrumStorageService(mysqlAccess, {
  baseDir: env.SPECTRUM_STORAGE_DIR,
  frameFlushMs: env.SPECTRUM_FRAME_FLUSH_MS,
  matchWindowMs: env.SPECTRUM_MATCH_WINDOW_MS,
});
const alertService = new AlertService(
  alertRepository,
  (deviceId) => {
    const metadata = deviceService.getMetadata(deviceId);
    return {
      acceleration: metadata?.accelerationSetpoint ?? 10,
      velocity: metadata?.vibrationSetpoint ?? 10,
      displacement: metadata?.displacementSetpoint ?? 10,
      temperature: metadata?.temperatureSetpoint ?? 10,
    };
  },
);
const auditService = new AuditService(auditRepository);
const commandServiceWithTimeout = new CommandService(
  deviceService,
  commandRepository,
  env.COMMAND_TIMEOUT_MS,
);
const sgpDataJobRepository = createSgpDataJobRepository(mysqlAccess);
const sgpDataExportDir = join(process.cwd(), 'storage', 'exports');
const sgpDataImportWorker = new SgpDataImportWorker(
  sgpDataJobRepository,
  deviceService,
  telemetryService,
  spectrumStorageService,
  zoneService,
  auditService,
  { workerRunId: serverRuntime?.runId },
);
const sgpDataImportService = new SgpDataImportService(sgpDataJobRepository, sgpDataImportWorker);
const sgpDataExportWorker = new SgpDataExportWorker(
  dataExportJobRepository,
  deviceService,
  telemetryService,
  spectrumStorageService,
  zoneService,
  auditService,
  sgpDataExportDir,
  { workerRunId: serverRuntime?.runId },
);
const sgpDataExportService = new SgpDataExportService(
  dataExportJobRepository,
  deviceService,
  sgpDataExportWorker,
  { exportDir: sgpDataExportDir },
);
await sgpDataImportService.initialize(serverRuntime?.startedAt);
await sgpDataExportService.initialize(serverRuntime?.startedAt);
const telemetryIngressGuard = new TelemetryIngressGuard({
  dedupeWindowMs: env.TELEMETRY_DEDUPE_WINDOW_MS,
  maxPerDevicePerMinute: env.TELEMETRY_MAX_PER_DEVICE_PER_MINUTE,
  maxGlobalPerMinute: env.TELEMETRY_MAX_GLOBAL_PER_MINUTE,
});

for (const listener of listeners) {
  registerRoutes({
    app: listener.app,
    authService,
    deviceService,
    telemetryService,
    alertService,
    auditService,
    commandService: commandServiceWithTimeout,
    realtimeGateway,
    zoneService,
    displayScreenshotService,
    spectrumStorageService,
    sgpDataImportService,
    sgpDataExportService,
    deviceThresholdAnalysisService,
    persistenceStatus: mysqlRuntime.status,
  });
}

registerSocketHandlers({
  app,
  deviceService,
  telemetryService,
  alertService,
  commandService: commandServiceWithTimeout,
  realtimeGateway,
  telemetryIngressGuard,
  spectrumStorageService,
  deviceAuthToken: env.DEVICE_AUTH_TOKEN,
});

let commandTimeoutSweepRunning = false;
const commandTimeoutSweep = setInterval(() => {
  if (commandTimeoutSweepRunning) {
    return;
  }
  commandTimeoutSweepRunning = true;
  void commandServiceWithTimeout
    .processTimeouts()
    .then((changed) => {
      if (changed > 0) {
        app.log.warn({ count: changed }, 'Command(s) marked as timeout');
      }
    })
    .catch((error: unknown) => {
      app.log.error({ err: error }, 'Failed to process command timeouts');
    })
    .finally(() => {
      commandTimeoutSweepRunning = false;
    });
}, env.COMMAND_TIMEOUT_SWEEP_MS);
commandTimeoutSweep.unref();

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  app.log.info({ signal }, 'Shutting down server...');
  clearInterval(commandTimeoutSweep);
  realtimeGateway.close();
  await Promise.all(listeners.map((listener) => listener.app.close()));
  await serverRuntimeTracker.stop(signal);
  await mysqlAccess?.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  for (const listener of listeners) {
    await listener.app.listen({ port: env.PORT, host: listener.host });
  }
} catch (error) {
  clearInterval(commandTimeoutSweep);
  app.log.error({ err: error, port: env.PORT, hosts: listenHosts }, 'Failed to start server');
  realtimeGateway.close();
  await Promise.allSettled(listeners.map((listener) => listener.app.close()));
  await serverRuntimeTracker.stop('startup_failed');
  await mysqlAccess?.close();
  throw error;
}

app.log.info(
  {
    port: env.PORT,
    hosts: listenHosts,
    mysqlPersistence: Boolean(mysqlAccess),
    persistenceMode,
  },
  'Server started',
);
