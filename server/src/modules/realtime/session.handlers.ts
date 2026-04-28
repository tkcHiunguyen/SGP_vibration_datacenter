import type { Socket } from 'socket.io';

import type { RegisterSocketHandlersDeps, SocketConnectionContext } from './socket-handler.types.js';

function resolveClientIp(socket: Socket): string | undefined {
  const xff = socket.handshake.headers['x-forwarded-for'];
  const forwarded = Array.isArray(xff) ? xff[0] : xff;
  const firstForwarded = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
  const direct = typeof socket.handshake.address === 'string' ? socket.handshake.address.trim() : undefined;
  return firstForwarded || direct || undefined;
}

export function initializeSocketSession(
  socket: Socket,
  {
    app,
    deviceAuthToken,
    deviceService,
    realtimeGateway,
    telemetryService,
  }: RegisterSocketHandlersDeps,
): SocketConnectionContext | null {
  const clientType = String(
    socket.handshake.auth?.clientType || socket.handshake.query?.clientType || 'dashboard',
  );
  const deviceId = String(socket.handshake.auth?.deviceId || socket.handshake.query?.deviceId || '').trim();
  const token = String(socket.handshake.auth?.token || socket.handshake.query?.token || '');

  if (clientType === 'device') {
    if (!deviceId) {
      socket.emit('device:error', { error: 'missing_device_id' });
      socket.disconnect(true);
      return null;
    }
    if (deviceAuthToken && token !== deviceAuthToken) {
      socket.emit('device:error', { error: 'unauthorized' });
      socket.disconnect(true);
      return null;
    }
    const clientIp = resolveClientIp(socket);
    deviceService.connect(deviceId, socket.id, clientIp);
    socket.join(`device:${deviceId}`);
    app.log.info({ socketId: socket.id, deviceId, clientIp }, 'Device connected');
    socket.emit('device:ack', { ok: true, deviceId });
  } else {
    realtimeGateway.joinDashboardRoom(socket);
    app.log.info({ socketId: socket.id }, 'Dashboard client connected');
  }

  const lastTelemetry = telemetryService.getLast();
  if (clientType !== 'device' && lastTelemetry) {
    socket.emit('telemetry', lastTelemetry);
  }

  return { clientType, deviceId };
}

export function registerSessionLifecycleHandler(
  socket: Socket,
  context: SocketConnectionContext,
  { app, deviceService }: RegisterSocketHandlersDeps,
): void {
  socket.on('disconnect', () => {
    if (context.clientType === 'device' && context.deviceId) {
      const removed = deviceService.disconnect(context.deviceId, socket.id);
      if (removed) {
        app.log.info({ socketId: socket.id, deviceId: context.deviceId }, 'Device disconnected');
        return;
      }
    }
    app.log.info({ socketId: socket.id }, 'Dashboard client disconnected');
  });
}
