import type { FastifyInstance } from 'fastify';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { AlertService } from '../alert/alert.service.js';
import { CommandService } from '../command/command.service.js';
import { DeviceService } from '../device/device.service.js';
import type { ObservabilityMetricsRegistry } from '../observability/index.js';
import type { RealtimeGateway } from './realtime.gateway.js';
import { TelemetryIngressGuard } from '../reliability/telemetry-ingress-guard.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

type RegisterSocketHandlersDeps = {
  app: FastifyInstance;
  deviceService: DeviceService;
  telemetryService: TelemetryService;
  alertService: AlertService;
  commandService: CommandService;
  metrics: ObservabilityMetricsRegistry;
  realtimeGateway: RealtimeGateway;
  telemetryIngressGuard: TelemetryIngressGuard;
  deviceAuthToken?: string;
};

export function registerSocketHandlers({
  app,
  deviceService,
  telemetryService,
  alertService,
  commandService,
  metrics,
  realtimeGateway,
  telemetryIngressGuard,
  deviceAuthToken,
}: RegisterSocketHandlersDeps): void {
  const commandAckSchema = z.object({
    commandId: z.string().min(1),
  });

  realtimeGateway.onConnection((socket: Socket) => {
    const clientType = String(
      socket.handshake.auth?.clientType || socket.handshake.query?.clientType || 'dashboard',
    );
    const deviceId = String(socket.handshake.auth?.deviceId || socket.handshake.query?.deviceId || '').trim();
    const token = String(socket.handshake.auth?.token || socket.handshake.query?.token || '');

    if (clientType === 'device') {
      if (!deviceId) {
        socket.emit('device:error', { error: 'missing_device_id' });
        socket.disconnect(true);
        return;
      }
      if (deviceAuthToken && token !== deviceAuthToken) {
        socket.emit('device:error', { error: 'unauthorized' });
        socket.disconnect(true);
        return;
      }
      deviceService.connect(deviceId, socket.id);
      metrics.incCounter('device_connections_total', 1, {}, 'Device socket connections');
      socket.join(`device:${deviceId}`);
      app.log.info({ socketId: socket.id, deviceId }, 'Device connected');
      socket.emit('device:ack', { ok: true, deviceId });
    } else {
      realtimeGateway.joinDashboardRoom(socket);
      metrics.incCounter('dashboard_connections_total', 1, {}, 'Dashboard socket connections');
      app.log.info({ socketId: socket.id }, 'Dashboard client connected');
    }

    const lastTelemetry = telemetryService.getLast();
    if (clientType !== 'device' && lastTelemetry) {
      socket.emit('telemetry', lastTelemetry);
    }

    socket.on('device:heartbeat', () => {
      if (clientType === 'device' && deviceId) {
        deviceService.heartbeat(deviceId);
      }
    });

    socket.on('device:telemetry', (rawPayload: unknown) => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }
      const decision = telemetryIngressGuard.evaluate(deviceId, rawPayload);
      if (!decision.accepted) {
        metrics.incCounter('telemetry_dropped_total', 1, {}, 'Telemetry messages dropped by ingress guards');
        app.log.warn(
          {
            deviceId,
            socketId: socket.id,
            reason: decision.reason,
            duplicate: decision.duplicate,
            rateLimited: decision.rateLimited,
            eventKey: decision.eventKey,
          },
          'Telemetry message dropped by ingress guard',
        );
        return;
      }
      const ingestStartedAt = performance.now();
      const message = telemetryService.ingest(deviceId, rawPayload);
      metrics.incCounter('telemetry_ingest_total', 1, {}, 'Accepted telemetry messages');
      metrics.observeHistogram(
        'telemetry_ingest_duration_seconds',
        (performance.now() - ingestStartedAt) / 1000,
        {},
        'Telemetry ingest duration in seconds',
      );
      realtimeGateway.broadcastTelemetry(message);
      const changedAlerts = alertService.evaluate(message);
      for (const alert of changedAlerts) {
        metrics.incCounter('alert_state_changes_total', 1, {}, 'Alert state changes');
        realtimeGateway.broadcastAlert(alert);
        const isTriggered = alert.status === 'active' && alert.triggeredAt === alert.updatedAt;
        const isResolved = alert.status === 'resolved' && Boolean(alert.resolvedAt);

        if ((isTriggered || isResolved) && alert.severity === 'critical') {
          app.log.debug(
            {
              alertId: alert.alertId,
              deviceId: alert.deviceId,
              metric: alert.metric,
              severity: alert.severity,
              status: alert.status,
              value: alert.lastValue,
              threshold: alert.threshold,
            },
            'Alert state changed',
          );
        }
      }
    });

    socket.on('device:command:ack', (payload: unknown) => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }
      const parsed = commandAckSchema.safeParse(payload);
      if (!parsed.success) {
        app.log.warn(
          { deviceId, socketId: socket.id, issues: parsed.error.issues },
          'Invalid device command ack payload',
        );
        return;
      }
      const acked = commandService.acknowledge(parsed.data.commandId, deviceId);
      if (acked) {
        metrics.incCounter('device_command_ack_total', 1, {}, 'Acknowledged device commands');
      }
      app.log.info(
        { deviceId, socketId: socket.id, commandId: parsed.data.commandId, acked },
        'Device command ack received',
      );
    });

    socket.on('disconnect', () => {
      if (clientType === 'device' && deviceId) {
        const removed = deviceService.disconnect(deviceId, socket.id);
        if (removed) {
          metrics.incCounter('device_disconnects_total', 1, {}, 'Device socket disconnects');
          app.log.info({ socketId: socket.id, deviceId }, 'Device disconnected');
          return;
        }
      }
      metrics.incCounter('dashboard_disconnects_total', 1, {}, 'Dashboard socket disconnects');
      app.log.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });

    socket.on('device:request-last-command', () => {
      if (clientType !== 'device') {
        return;
      }
      const [last] = commandService.listRecent(1);
      if (last && last.deviceId === deviceId) {
        socket.emit('device:command', {
          commandId: last.commandId,
          type: last.type,
          payload: last.payload,
          sentAt: last.sentAt,
        });
      }
    });
  });
}
