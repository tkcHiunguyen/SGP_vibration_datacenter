import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../shared/config.js';
import type { AlertService } from '../alert/alert.service.js';
import type { AuthService } from '../auth/index.js';
import type { DeviceService } from '../device/device.service.js';
import type { RealtimeGateway } from '../realtime/realtime.gateway.js';

type RegisterCoreRoutesDeps = {
  app: FastifyInstance;
  authService: AuthService;
  deviceService: DeviceService;
  alertService: AlertService;
  realtimeGateway: RealtimeGateway;
};

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

function createBypassPrincipal() {
  return {
    role: 'admin' as const,
    scheme: 'api-key' as const,
    source: 'auth-bypass',
    tokenFingerprint: 'bypass',
    authenticatedAt: new Date().toISOString(),
  };
}

export function registerCoreRoutes({
  app,
  authService,
  deviceService,
  alertService,
  realtimeGateway,
}: RegisterCoreRoutesDeps): void {
  const authBypassEnabled = env.AUTH_BYPASS_GATING;

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

  function requireViewer(request: FastifyRequest, reply: FastifyReply) {
    if (authBypassEnabled) {
      return createBypassPrincipal();
    }
    const principal = authenticate(request);
    if (!principal) {
      void reply.code(401).send({ ok: false, error: 'unauthorized' });
      return null;
    }
    if (!authService.authorize(principal, 'viewer')) {
      void reply.code(403).send({ ok: false, error: 'forbidden', requiredRole: 'viewer' });
      return null;
    }
    return principal;
  }

  for (const path of appShellPaths) {
    app.get(path, async (_, reply) => reply.sendFile('index.html'));
  }

  app.get('/health', async () => ({
    ok: true,
    service: 'sgp-vibration-datacenter-server',
    uptimeSec: Math.round(process.uptime()),
    connectedDevices: deviceService.countConnected(),
    activeAlerts: alertService.countActiveAlerts(),
    connectedClients: realtimeGateway.connectedClientsCount(),
    now: new Date().toISOString(),
  }));


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
    ],
  }));
}
