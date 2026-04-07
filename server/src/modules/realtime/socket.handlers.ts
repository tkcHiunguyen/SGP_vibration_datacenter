import type { FastifyInstance } from 'fastify';
import type { Socket } from 'socket.io';
import { inspect } from 'node:util';
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
  const resolveClientIp = (socket: Socket): string | undefined => {
    const xff = socket.handshake.headers['x-forwarded-for'];
    const forwarded = Array.isArray(xff) ? xff[0] : xff;
    const firstForwarded = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
    const direct = typeof socket.handshake.address === 'string' ? socket.handshake.address.trim() : undefined;
    return firstForwarded || direct || undefined;
  };

  const commandAckSchema = z.object({
    commandId: z.string().min(1),
  });
  const previewValues = (values: number[], count = 8): string =>
    `[${values
      .slice(0, count)
      .map((value) => String(value))
      .join(', ')}${values.length > count ? ', ...' : ''}]`;

  const previewTailValues = (values: number[], count = 8): string => {
    if (values.length <= count) {
      return `[${values.map((value) => String(value)).join(', ')}]`;
    }

    return `[... , ${values
      .slice(-count)
      .map((value) => String(value))
      .join(', ')}]`;
  };

  const logPayload = (label: string, payload: unknown): void => {
    console.log(`${label} incoming payload => ${inspect(payload, { depth: null, maxArrayLength: null, compact: false })}`);
  };
  const logSpectrumOverview = (label: string, payload: unknown): void => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      console.log(`${label} incoming payload =>`, payload);
      return;
    }

    const record = payload as Record<string, unknown>;
    const spectrumKey = ['x_spectrum', 'y_spectrum', 'z_spectrum'].find((key) => Array.isArray(record[key]));
    if (!spectrumKey) {
      logPayload(label, payload);
      return;
    }

    const rawValues = record[spectrumKey] as unknown[];
    const values = rawValues.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) {
      logPayload(label, payload);
      return;
    }

    let peakIndex = 0;
    let peakValue = values[0] ?? 0;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > peakValue) {
        peakValue = values[index];
        peakIndex = index;
      }
    }

    const binHz = typeof record.bin_hz === 'number' && Number.isFinite(record.bin_hz) ? record.bin_hz : undefined;
    const valueScale =
      typeof record.value_scale === 'number' && Number.isFinite(record.value_scale) && record.value_scale > 0
        ? record.value_scale
        : undefined;
    const peakFrequencyHz = binHz !== undefined ? binHz * (peakIndex + 1) : undefined;
    const peakAmplitude = valueScale !== undefined ? peakValue / valueScale : undefined;

    console.log(
      [
        `${label} overview`,
        `  frameSeq: ${record.frameSeq ?? '-'}`,
        `  source_sample_count: ${record.source_sample_count ?? '-'}`,
        `  sample_rate_hz: ${record.sample_rate_hz ?? '-'}`,
        `  bin_count: ${record.bin_count ?? values.length}`,
        `  bin_hz: ${binHz ?? '-'}`,
        `  value_scale: ${valueScale ?? '-'}`,
        `  magnitude_unit: ${record.magnitude_unit ?? '-'}`,
        `  peak_bin_index: ${peakIndex}`,
        `  peak_freq_hz: ${peakFrequencyHz?.toFixed(3) ?? '-'}`,
        `  peak_raw: ${peakValue}`,
        `  peak_amplitude: ${peakAmplitude?.toFixed(4) ?? '-'}`,
        `  ${spectrumKey}[head]: ${previewValues(values)}`,
        `  ${spectrumKey}[tail]: ${previewTailValues(values)}`,
      ].join('\n'),
    );
  };
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
    name: z.string().trim().max(256).optional(),
    site: z.string().trim().max(128).optional(),
    zone: z.string().trim().max(128).optional(),
    firmwareVersion: z.string().trim().max(128).optional(),
    sensorVersion: z.string().trim().max(128).optional(),
    notes: z.string().trim().max(1024).optional(),
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
      const clientIp = resolveClientIp(socket);
      deviceService.connect(deviceId, socket.id, clientIp);
      metrics.incCounter('device_connections_total', 1, {}, 'Device socket connections');
      socket.join(`device:${deviceId}`);
      app.log.info({ socketId: socket.id, deviceId, clientIp }, 'Device connected');
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

    socket.on('device:heartbeat', (rawPayload: unknown) => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }

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
      if (clientType !== 'device' || !deviceId) {
        return;
      }

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
        firmwareVersion: parsed.data.firmwareVersion ?? parsed.data.firmware,
        sensorVersion: parsed.data.sensorVersion,
        notes: parsed.data.notes,
      };

      const hasAnyField = Object.values(normalizedMetadata).some((value) => value !== undefined);
      if (!hasAnyField) {
        return;
      }

      const result = deviceService.upsertFromSocket(deviceId, normalizedMetadata);
      if (!result.updated) {
        return;
      }

      metrics.incCounter('device_metadata_updates_total', 1, {}, 'Device metadata updates from socket');
      realtimeGateway.broadcastDeviceMetadata({
        deviceId,
        metadata: result.metadata,
      });
      app.log.info(
        {
          deviceId,
          socketId: socket.id,
          uuid: result.metadata.uuid,
          site: result.metadata.site,
          zone: result.metadata.zone,
        },
        'Device metadata updated from socket',
      );
    });

    socket.on('device:telemetry', (rawPayload: unknown) => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }
      logPayload('[device:telemetry]', rawPayload);
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

    socket.on('device:telemetry:xspectrum', (rawPayload: unknown) => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }
      logSpectrumOverview('[device:telemetry:xspectrum]', rawPayload);
    });

    socket.on('device:telemetry:yspectrum', (rawPayload: unknown) => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }
      logSpectrumOverview('[device:telemetry:yspectrum]', rawPayload);
    });

    socket.on('device:telemetry:zspectrum', (rawPayload: unknown) => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }
      logSpectrumOverview('[device:telemetry:zspectrum]', rawPayload);
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
