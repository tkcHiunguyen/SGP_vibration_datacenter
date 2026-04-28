import type { Socket } from 'socket.io';
import { z } from 'zod';

import {
  isDeviceConnection,
  type RegisterSocketHandlersDeps,
  type SocketConnectionContext,
} from './socket-handler.types.js';
import { logPayload } from './socket-payload.utils.js';

const deviceHeartbeatSchema = z.object({
  socketConnected: z.boolean().optional(),
  staConnected: z.boolean().optional(),
  signal: z.number().int().optional(),
  uptimeSec: z.number().int().nonnegative().optional(),
});

const deviceMetadataSchema = z.object({
  deviceId: z.string().trim().min(1).max(128).optional(),
  uuid: z.string().trim().max(256).optional(),
  firmware: z.string().trim().max(128).optional(),
  version_firmware: z.string().trim().max(128).optional(),
  name: z.string().trim().max(256).optional(),
  site: z.string().trim().max(128).optional(),
  zone: z.string().trim().max(128).optional(),
  firmwareVersion: z.string().trim().max(128).optional(),
  notes: z.string().trim().max(1024).optional(),
});

export function registerDeviceStateHandlers(
  socket: Socket,
  context: SocketConnectionContext,
  { app, deviceService, realtimeGateway }: RegisterSocketHandlersDeps,
): void {
  if (!isDeviceConnection(context)) {
    return;
  }

  const { deviceId } = context;

  socket.on('device:heartbeat', (rawPayload: unknown) => {
    console.log(rawPayload ?? {});

    const parsed = deviceHeartbeatSchema.safeParse(rawPayload ?? {});
    if (!parsed.success) {
      app.log.warn(
        { deviceId, socketId: socket.id, issues: parsed.error.issues },
        'Invalid device heartbeat payload',
      );
    }

    const session = deviceService.heartbeat(deviceId, parsed.success ? parsed.data : undefined);
    if (session) {
      realtimeGateway.broadcastDeviceHeartbeat({
        deviceId,
        connectedAt: session.connectedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
        heartbeat: session.heartbeat,
      });
    }
  });

  socket.on('device:metadata', (rawPayload: unknown) => {
    logPayload('[device:metadata]', rawPayload);

    let candidate = rawPayload;
    if (rawPayload && typeof rawPayload === 'object' && 'metadata' in rawPayload) {
      const envelope = rawPayload as { metadata?: unknown };
      candidate = envelope.metadata;
    }

    const parsed = deviceMetadataSchema.safeParse(candidate);
    if (!parsed.success) {
      app.log.warn(
        { deviceId, socketId: socket.id, issues: parsed.error.issues },
        'Invalid device metadata payload',
      );
      return;
    }

    if (parsed.data.deviceId && parsed.data.deviceId !== deviceId) {
      app.log.warn(
        {
          socketDeviceId: deviceId,
          payloadDeviceId: parsed.data.deviceId,
          socketId: socket.id,
        },
        'Ignoring metadata payload with mismatched deviceId',
      );
      return;
    }

    const normalizedMetadata = {
      uuid: parsed.data.uuid,
      name: parsed.data.name,
      site: parsed.data.site,
      zone: parsed.data.zone,
      firmwareVersion: parsed.data.firmwareVersion ?? parsed.data.version_firmware ?? parsed.data.firmware,
      notes: parsed.data.notes,
    };

    const hasAnyField = Object.values(normalizedMetadata).some((value) => value !== undefined);
    if (!hasAnyField) {
      return;
    }

    const result = deviceService.upsertFromSocket(deviceId, normalizedMetadata);
    if (!result.updated) {
      if (!result.metadata) {
        app.log.debug(
          { deviceId, socketId: socket.id },
          'Skip metadata upsert for unregistered device (db-first inventory mode)',
        );
      }
      return;
    }
    const metadata = result.metadata;
    if (!metadata) {
      return;
    }
    realtimeGateway.broadcastDeviceMetadata({
      deviceId,
      metadata,
    });
    app.log.info(
      {
        deviceId,
        socketId: socket.id,
        uuid: metadata.uuid,
        site: metadata.site,
        zone: metadata.zone,
      },
      'Device metadata updated from socket',
    );
  });
}
