import type { Socket } from 'socket.io';

import {
  isDeviceConnection,
  type RegisterSocketHandlersDeps,
  type SocketConnectionContext,
} from './socket-handler.types.js';
import { logPayload } from './socket-payload.utils.js';

export function registerTelemetryIngestHandlers(
  socket: Socket,
  context: SocketConnectionContext,
  {
    alertService,
    app,
    realtimeGateway,
    telemetryIngressGuard,
    telemetryService,
  }: RegisterSocketHandlersDeps,
): void {
  if (!isDeviceConnection(context)) {
    return;
  }

  const { deviceId } = context;

  socket.on('device:telemetry', (rawPayload: unknown) => {
    logPayload('[device:telemetry]', rawPayload);
    const decision = telemetryIngressGuard.evaluate(deviceId, rawPayload);
    if (!decision.accepted) {
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

    const message = telemetryService.ingest(deviceId, rawPayload);
    realtimeGateway.broadcastTelemetry(message);
    const changedAlerts = alertService.evaluate(message);
    for (const alert of changedAlerts) {
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
}
