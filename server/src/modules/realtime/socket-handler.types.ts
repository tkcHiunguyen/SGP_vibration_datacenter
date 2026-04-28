import type { FastifyInstance } from 'fastify';

import type { AlertService } from '../alert/alert.service.js';
import type { CommandService } from '../command/command.service.js';
import type { DeviceService } from '../device/device.service.js';
import type { TelemetryIngressGuard } from '../reliability/telemetry-ingress-guard.js';
import type { SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import type { RealtimeGateway } from './realtime.gateway.js';

export type RegisterSocketHandlersDeps = {
  app: FastifyInstance;
  deviceService: DeviceService;
  telemetryService: TelemetryService;
  alertService: AlertService;
  commandService: CommandService;
  realtimeGateway: RealtimeGateway;
  telemetryIngressGuard: TelemetryIngressGuard;
  spectrumStorageService: SpectrumStorageService;
  deviceAuthToken?: string;
};

export type SocketConnectionContext = {
  clientType: string;
  deviceId: string;
};

type DeviceSocketConnectionContext = SocketConnectionContext & {
  clientType: 'device';
  deviceId: string;
};

export function isDeviceConnection(
  context: SocketConnectionContext,
): context is DeviceSocketConnectionContext {
  return context.clientType === 'device' && context.deviceId.length > 0;
}
