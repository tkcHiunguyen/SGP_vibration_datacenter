import type { Socket } from 'socket.io';

import type { SpectrumAxis } from '../../shared/types.js';
import {
  isDeviceConnection,
  type RegisterSocketHandlersDeps,
  type SocketConnectionContext,
} from './socket-handler.types.js';
import { logPayload } from './socket-payload.utils.js';
import { normalizeSpectrumMessage } from './spectrum-message.normalizer.js';

export function registerSpectrumIngestHandlers(
  socket: Socket,
  context: SocketConnectionContext,
  { app, realtimeGateway, spectrumStorageService }: RegisterSocketHandlersDeps,
): void {
  if (!isDeviceConnection(context)) {
    return;
  }

  const { deviceId } = context;

  const handleSpectrumEvent = (
    axis: SpectrumAxis,
    label: string,
    rawPayload: unknown,
    rawBinary?: unknown,
  ): void => {
    const spectrum = normalizeSpectrumMessage(axis, deviceId, rawPayload, rawBinary);
    if (!spectrum) {
      app.log.warn(
        {
          deviceId,
          socketId: socket.id,
          axis,
          hasBinaryAttachment: Boolean(rawBinary),
        },
        'Unable to normalize incoming spectrum payload',
      );
      logPayload(`${label}:invalid`, rawPayload);
      return;
    }

    realtimeGateway.broadcastTelemetrySpectrum(spectrum);
    void spectrumStorageService.ingest(spectrum).catch((error) => {
      app.log.warn(
        {
          deviceId,
          axis: spectrum.axis,
          telemetryUuid: spectrum.telemetryUuid,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to persist spectrum frame',
      );
    });
  };

  socket.on('device:telemetry:xspectrum', (rawPayload: unknown, rawBinary?: unknown) => {
    handleSpectrumEvent('x', '[device:telemetry:xspectrum]', rawPayload, rawBinary);
  });

  socket.on('device:telemetry:yspectrum', (rawPayload: unknown, rawBinary?: unknown) => {
    handleSpectrumEvent('y', '[device:telemetry:yspectrum]', rawPayload, rawBinary);
  });

  socket.on('device:telemetry:zspectrum', (rawPayload: unknown, rawBinary?: unknown) => {
    handleSpectrumEvent('z', '[device:telemetry:zspectrum]', rawPayload, rawBinary);
  });
}
