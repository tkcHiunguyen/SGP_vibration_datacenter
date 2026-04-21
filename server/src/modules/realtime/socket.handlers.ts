import type { FastifyInstance } from 'fastify';
import type { Socket } from 'socket.io';
import { inspect } from 'node:util';
import { z } from 'zod';
import type { SpectrumAxis, TelemetrySpectrumMessage } from '../../shared/types.js';
import { AlertService } from '../alert/alert.service.js';
import { CommandService } from '../command/command.service.js';
import { DeviceService } from '../device/device.service.js';
import type { ObservabilityMetricsRegistry } from '../observability/index.js';
import type { RealtimeGateway } from './realtime.gateway.js';
import { TelemetryIngressGuard } from '../reliability/telemetry-ingress-guard.js';
import { SpectrumStorageService } from '../spectrum/spectrum-storage.service.js';
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
  spectrumStorageService: SpectrumStorageService;
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
  spectrumStorageService,
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
    status: z.string().trim().max(64).optional(),
    detail: z.string().trim().max(256).optional(),
    deviceId: z.string().trim().max(128).optional(),
    uuid: z.string().trim().max(256).optional(),
    version_firmware: z.string().trim().max(128).optional(),
    firmwareVersion: z.string().trim().max(128).optional(),
  });

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };

  const asFiniteNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return undefined;
  };

  const asNonEmptyString = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return undefined;
  };

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

  const toUint8Array = (value: unknown): Uint8Array | null => {
    if (Buffer.isBuffer(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    if (value instanceof Uint8Array) {
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }

    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    return null;
  };

  const decodeU16LeValues = (value: unknown): number[] => {
    const bytes = toUint8Array(value);
    if (!bytes || bytes.byteLength < 2) {
      return [];
    }

    const normalizedByteLength = bytes.byteLength - (bytes.byteLength % 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, normalizedByteLength);
    const values = new Array<number>(Math.floor(normalizedByteLength / 2));

    for (let index = 0; index < values.length; index += 1) {
      values[index] = view.getUint16(index * 2, true);
    }

    return values;
  };

  const parseNumberArray = (value: unknown): number[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    const numbers: number[] = [];
    for (const item of value) {
      const parsed = asFiniteNumber(item);
      if (parsed !== undefined) {
        numbers.push(parsed);
      }
    }
    return numbers;
  };

  const DEFAULT_SPECTRUM_VALUE_SCALE = 256;
  const DEFAULT_SPECTRUM_MAGNITUDE_UNIT = 'm/s2';

  type ResolvedSpectrumValues = {
    values: number[];
    source: 'binary_attachment' | 'payload_binary' | 'payload_numeric';
  };

  const resolveSpectrumValues = (
    axis: SpectrumAxis,
    payloadRecord: Record<string, unknown>,
    rawBinary?: unknown,
  ): ResolvedSpectrumValues | null => {
    const decodedBinaryAttachment = decodeU16LeValues(rawBinary);
    if (decodedBinaryAttachment.length > 0) {
      return {
        values: decodedBinaryAttachment,
        source: 'binary_attachment',
      };
    }

    const axisPayloadKey = `${axis}_spectrum` as const;
    const candidates: unknown[] = [
      payloadRecord[axisPayloadKey],
      payloadRecord.spectrum,
      payloadRecord.values,
      payloadRecord.data,
    ];

    for (const candidate of candidates) {
      const decodedValues = decodeU16LeValues(candidate);
      if (decodedValues.length > 0) {
        return {
          values: decodedValues,
          source: 'payload_binary',
        };
      }

      const numericValues = parseNumberArray(candidate);
      if (numericValues.length > 0) {
        return {
          values: numericValues,
          source: 'payload_numeric',
        };
      }
    }

    return null;
  };

  const normalizeSpectrumMessage = (
    axis: SpectrumAxis,
    defaultDeviceId: string,
    rawPayload: unknown,
    rawBinary?: unknown,
  ): TelemetrySpectrumMessage | null => {
    const record = asRecord(rawPayload);
    if (!record) {
      return null;
    }

    const payloadEnvelopeRecord = asRecord(record.payload);
    const spectrumRecord =
      payloadEnvelopeRecord && Object.keys(payloadEnvelopeRecord).length > 0
        ? payloadEnvelopeRecord
        : record;

    const resolvedValues = resolveSpectrumValues(axis, spectrumRecord, rawBinary);
    if (!resolvedValues || resolvedValues.values.length === 0) {
      return null;
    }
    const values = resolvedValues.values;

    const declaredBinCount = asFiniteNumber(spectrumRecord.bin_count ?? spectrumRecord.binCount);
    const normalizedBinCount = declaredBinCount
      ? Math.max(1, Math.min(values.length, Math.floor(declaredBinCount)))
      : values.length;
    const normalizedValues = values.slice(0, normalizedBinCount);
    if (normalizedValues.length === 0) {
      return null;
    }

    const valueScaleCandidate = asFiniteNumber(spectrumRecord.value_scale ?? spectrumRecord.valueScale);
    const defaultValueScale =
      resolvedValues.source === 'payload_numeric' ? undefined : DEFAULT_SPECTRUM_VALUE_SCALE;
    const valueScale =
      valueScaleCandidate !== undefined && valueScaleCandidate > 0 ? valueScaleCandidate : defaultValueScale;

    const sampleRateHz = asFiniteNumber(spectrumRecord.sample_rate_hz ?? spectrumRecord.sampleRateHz);
    const sourceSampleCountFromPayload = asFiniteNumber(
      spectrumRecord.source_sample_count ?? spectrumRecord.sourceSampleCount,
    );
    const sourceSampleCount =
      sourceSampleCountFromPayload !== undefined && sourceSampleCountFromPayload > 0
        ? Math.floor(sourceSampleCountFromPayload)
        : normalizedValues.length * 2;
    const binHzFromPayload = asFiniteNumber(spectrumRecord.bin_hz ?? spectrumRecord.binHz);
    const binHz =
      binHzFromPayload ??
      (sampleRateHz !== undefined && sourceSampleCount !== undefined && sourceSampleCount > 0
        ? sampleRateHz / sourceSampleCount
        : undefined);

    const amplitudes = normalizedValues.map((value) =>
      valueScale !== undefined ? Number((value / valueScale).toFixed(6)) : Number(value.toFixed(6)),
    );

    let peakBinIndex = 0;
    let peakAmplitude = amplitudes[0] ?? 0;
    for (let index = 1; index < amplitudes.length; index += 1) {
      if ((amplitudes[index] ?? 0) > peakAmplitude) {
        peakAmplitude = amplitudes[index] ?? 0;
        peakBinIndex = index;
      }
    }

    const peakFrequencyHz = binHz !== undefined ? Number((binHz * (peakBinIndex + 1)).toFixed(6)) : undefined;
    const deviceIdFromPayload = asNonEmptyString(
      spectrumRecord.deviceId ?? spectrumRecord.device_id ?? record.deviceId ?? record.device_id,
    );

    return {
      deviceId: deviceIdFromPayload ?? defaultDeviceId,
      receivedAt: new Date().toISOString(),
      axis,
      telemetryUuid: asNonEmptyString(
        spectrumRecord.telemetryUuid ?? spectrumRecord.telemetry_uuid ?? record.telemetryUuid ?? record.telemetry_uuid,
      ),
      uuid: asNonEmptyString(spectrumRecord.uuid ?? record.uuid),
      sourceSampleCount,
      sampleRateHz,
      binCount: normalizedValues.length,
      binHz,
      valueScale,
      magnitudeUnit:
        asNonEmptyString(spectrumRecord.magnitude_unit ?? spectrumRecord.magnitudeUnit) ??
        DEFAULT_SPECTRUM_MAGNITUDE_UNIT,
      amplitudes,
      peakBinIndex,
      peakFrequencyHz,
      peakAmplitude,
    };
  };

  const logSpectrumOverview = (label: string, spectrum: TelemetrySpectrumMessage): void => {
    console.log(
      [
        `${label} overview`,
        `  axis: ${spectrum.axis}`,
        `  telemetry_uuid: ${spectrum.telemetryUuid ?? '-'}`,
        `  source_sample_count: ${spectrum.sourceSampleCount ?? '-'}`,
        `  sample_rate_hz: ${spectrum.sampleRateHz ?? '-'}`,
        `  bin_count: ${spectrum.binCount}`,
        `  bin_hz: ${spectrum.binHz ?? '-'}`,
        `  value_scale: ${spectrum.valueScale ?? '-'}`,
        `  magnitude_unit: ${spectrum.magnitudeUnit ?? '-'}`,
        `  peak_bin_index: ${spectrum.peakBinIndex ?? '-'}`,
        `  peak_freq_hz: ${spectrum.peakFrequencyHz?.toFixed(3) ?? '-'}`,
        `  peak_amplitude: ${spectrum.peakAmplitude?.toFixed(4) ?? '-'}`,
        `  amplitude[head]: ${previewValues(spectrum.amplitudes)}`,
        `  amplitude[tail]: ${previewTailValues(spectrum.amplitudes)}`,
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
    version_firmware: z.string().trim().max(128).optional(),
    name: z.string().trim().max(256).optional(),
    site: z.string().trim().max(128).optional(),
    zone: z.string().trim().max(128).optional(),
    firmwareVersion: z.string().trim().max(128).optional(),
    sensorVersion: z.string().trim().max(128).optional(),
    sensor_version: z.string().trim().max(128).optional(),
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
        firmwareVersion: parsed.data.firmwareVersion ?? parsed.data.version_firmware ?? parsed.data.firmware,
        sensorVersion: parsed.data.sensorVersion ?? parsed.data.sensor_version,
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

      metrics.incCounter('device_metadata_updates_total', 1, {}, 'Device metadata updates from socket');
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

    const handleSpectrumEvent = (
      axis: SpectrumAxis,
      label: string,
      rawPayload: unknown,
      rawBinary?: unknown,
    ): void => {
      if (clientType !== 'device' || !deviceId) {
        return;
      }

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

      metrics.incCounter(
        'telemetry_spectrum_ingest_total',
        1,
        { axis: spectrum.axis },
        'Accepted telemetry spectrum frames',
      );
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

      const acked = commandService.acknowledge(parsed.data.commandId, deviceId, {
        status: parsed.data.status,
        detail: parsed.data.detail,
        uuid: parsed.data.uuid,
        firmwareVersion: parsed.data.firmwareVersion ?? parsed.data.version_firmware,
        raw: parsed.data as unknown as Record<string, unknown>,
      });
      if (acked) {
        metrics.incCounter('device_command_ack_total', 1, {}, 'Acknowledged device commands');
      }
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
  });
}
