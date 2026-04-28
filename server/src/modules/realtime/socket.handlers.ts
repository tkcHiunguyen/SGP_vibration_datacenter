import type { Socket } from 'socket.io';

import { registerCommandHandlers } from './command.handlers.js';
import { registerDeviceStateHandlers } from './device-state.handlers.js';
import { initializeSocketSession, registerSessionLifecycleHandler } from './session.handlers.js';
import type { RegisterSocketHandlersDeps } from './socket-handler.types.js';
import { registerSpectrumIngestHandlers } from './spectrum-ingest.handlers.js';
import { registerTelemetryIngestHandlers } from './telemetry-ingest.handlers.js';

export function registerSocketHandlers(deps: RegisterSocketHandlersDeps): void {
  deps.realtimeGateway.onConnection((socket: Socket) => {
    const context = initializeSocketSession(socket, deps);
    if (!context) {
      return;
    }

    registerDeviceStateHandlers(socket, context, deps);
    registerTelemetryIngestHandlers(socket, context, deps);
    registerSpectrumIngestHandlers(socket, context, deps);
    registerCommandHandlers(socket, context, deps);
    registerSessionLifecycleHandler(socket, context, deps);
  });
}
