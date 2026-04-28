import type { Socket } from 'socket.io';
import { z } from 'zod';

import {
  isDeviceConnection,
  type RegisterSocketHandlersDeps,
  type SocketConnectionContext,
} from './socket-handler.types.js';

const commandAckSchema = z.object({
  commandId: z.string().min(1),
  status: z.string().trim().max(64).optional(),
  detail: z.string().trim().max(256).optional(),
  deviceId: z.string().trim().max(128).optional(),
  uuid: z.string().trim().max(256).optional(),
  version_firmware: z.string().trim().max(128).optional(),
  firmwareVersion: z.string().trim().max(128).optional(),
});

export function registerCommandHandlers(
  socket: Socket,
  context: SocketConnectionContext,
  { app, commandService }: RegisterSocketHandlersDeps,
): void {
  if (!isDeviceConnection(context)) {
    return;
  }

  const { deviceId } = context;

  socket.on('device:command:ack', (payload: unknown) => {
    const parsed = commandAckSchema.safeParse(payload);
    if (!parsed.success) {
      app.log.warn(
        { deviceId, socketId: socket.id, issues: parsed.error.issues },
        'Invalid device command ack payload',
      );
      return;
    }
    if (parsed.data.deviceId && parsed.data.deviceId !== deviceId) {
      app.log.warn(
        {
          socketDeviceId: deviceId,
          payloadDeviceId: parsed.data.deviceId,
          commandId: parsed.data.commandId,
          socketId: socket.id,
        },
        'Ignoring command ack payload with mismatched deviceId',
      );
      return;
    }

    void commandService
      .acknowledge(parsed.data.commandId, deviceId, {
        status: parsed.data.status,
        detail: parsed.data.detail,
        uuid: parsed.data.uuid,
        firmwareVersion: parsed.data.firmwareVersion ?? parsed.data.version_firmware,
        raw: parsed.data as unknown as Record<string, unknown>,
      })
      .then((acked) => {
        app.log.info(
          {
            deviceId,
            socketId: socket.id,
            commandId: parsed.data.commandId,
            status: parsed.data.status,
            detail: parsed.data.detail,
            acked,
          },
          'Device command ack received',
        );
      })
      .catch((error: unknown) => {
        app.log.error(
          { err: error, deviceId, socketId: socket.id, commandId: parsed.data.commandId },
          'Failed to persist device command ack',
        );
      });
  });

  socket.on('device:request-last-command', () => {
    const [last] = commandService.listRecent(1);
    if (last && last.deviceId === deviceId) {
      const payload =
        last.payload && typeof last.payload === 'object' && !Array.isArray(last.payload)
          ? last.payload
          : {};
      const payloadCommand =
        typeof payload.command === 'string' && payload.command.trim()
          ? payload.command.trim()
          : last.type;
      const payloadType =
        typeof payload.type === 'string' && payload.type.trim()
          ? payload.type.trim()
          : last.type;
      const payloadDeviceId =
        typeof payload.deviceId === 'string' && payload.deviceId.trim()
          ? payload.deviceId.trim()
          : deviceId;
      socket.emit('device:command', {
        ...payload,
        commandId: last.commandId,
        command: payloadCommand,
        type: payloadType,
        deviceId: payloadDeviceId,
      });
    }
  });
}
