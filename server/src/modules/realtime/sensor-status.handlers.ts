import type { Socket } from 'socket.io';
import { z } from 'zod';

import {
  isDeviceConnection,
  type RegisterSocketHandlersDeps,
  type SocketConnectionContext,
} from './socket-handler.types.js';

const sensorStatusSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  sensor: z.literal('adxl345'),
  status: z.enum(['ok', 'fault', 'recovering']),
  reason: z.enum(['not_detected', 'i2c_read_error', 'capture_timeout', 'unknown']).optional(),
  captureTimeoutCount: z.number().int().nonnegative().optional(),
  i2cReadErrorCount: z.number().int().nonnegative().optional(),
}).superRefine((payload, context) => {
  if (payload.status === 'fault' && !payload.reason) {
    context.addIssue({ code: 'custom', message: 'reason is required while status is fault', path: ['reason'] });
  }
  if (payload.status !== 'fault' && payload.reason !== undefined) {
    context.addIssue({ code: 'custom', message: 'reason is only valid while status is fault', path: ['reason'] });
  }
});

export function registerSensorStatusHandlers(
  socket: Socket,
  context: SocketConnectionContext,
  { app, deviceService, realtimeGateway }: RegisterSocketHandlersDeps,
): void {
  if (!isDeviceConnection(context)) {
    return;
  }

  const { deviceId } = context;
  socket.on('device:sensor-status', async (rawPayload: unknown) => {
    const parsed = sensorStatusSchema.safeParse(rawPayload);
    if (!parsed.success) {
      app.log.warn(
        { deviceId, socketId: socket.id, issues: parsed.error.issues },
        'Invalid device sensor status payload',
      );
      return;
    }
    if (parsed.data.deviceId !== deviceId) {
      app.log.warn(
        { socketDeviceId: deviceId, payloadDeviceId: parsed.data.deviceId, socketId: socket.id },
        'Ignoring sensor status payload with mismatched deviceId',
      );
      return;
    }

    const result = await deviceService.updateAdxlHealth(deviceId, {
      status: parsed.data.status,
      reason: parsed.data.reason,
      captureTimeoutCount: parsed.data.captureTimeoutCount,
      i2cReadErrorCount: parsed.data.i2cReadErrorCount,
    });
    if (!result) {
      app.log.warn({ deviceId, socketId: socket.id }, 'Ignoring sensor status for unknown device');
      return;
    }
    if (!result.updated) {
      return;
    }

    realtimeGateway.broadcastDeviceSensorStatus({
      deviceId,
      sensor: 'adxl345',
      ...result.health,
    });
  });
}
