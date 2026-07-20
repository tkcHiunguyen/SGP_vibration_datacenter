import type { SpectrumAxis, TelemetrySpectrumMessage } from '../../shared/types.js';

const DEFAULT_SPECTRUM_VALUE_SCALE = 256;
const DEFAULT_SPECTRUM_MAGNITUDE_UNIT = 'm/s2';
const DEFAULT_SPECTRUM_BIN_COUNT = 512;
const DEFAULT_SPECTRUM_SOURCE_SAMPLE_COUNT = 1024;

type ResolvedSpectrumValues = {
  values: number[];
  source: 'binary_attachment' | 'payload_binary' | 'payload_numeric';
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | undefined {
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
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return undefined;
}

function toUint8Array(value: unknown): Uint8Array | null {
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
}

function decodeSpectrumBuffer(
  buffer: unknown,
  meta: { binCount?: number; valueScale?: number } = {},
): { amplitudes: number[]; peakBinIndex: number; peakAmplitude: number } {
  const bytes = toUint8Array(buffer);
  if (!bytes || bytes.byteLength < 2) {
    return { amplitudes: [], peakBinIndex: 0, peakAmplitude: 0 };
  }

  const viewBuffer = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binCount = Math.max(1, Math.floor(meta.binCount ?? DEFAULT_SPECTRUM_BIN_COUNT));
  const valueScale = meta.valueScale && meta.valueScale > 0 ? meta.valueScale : DEFAULT_SPECTRUM_VALUE_SCALE;
  const availableBins = Math.floor(viewBuffer.byteLength / 2);
  const count = Math.min(binCount, availableBins);

  const amplitudes = new Array<number>(count);
  let peakBinIndex = 0;
  let peakAmplitude = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const raw = viewBuffer.readUInt16LE(i * 2);
    const amp = raw / valueScale;
    amplitudes[i] = amp;

    if (amp > peakAmplitude) {
      peakAmplitude = amp;
      peakBinIndex = i;
    }
  }

  return { amplitudes, peakBinIndex, peakAmplitude: Number.isFinite(peakAmplitude) ? peakAmplitude : 0 };
}

function decodeU16LeValues(value: unknown): number[] {
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
}

function parseNumberArray(value: unknown): number[] {
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
}

function resolveSpectrumValues(
  axis: SpectrumAxis,
  payloadRecord: Record<string, unknown>,
  rawBinary?: unknown,
): ResolvedSpectrumValues | null {
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
}

export function normalizeSpectrumMessage(
  axis: SpectrumAxis,
  defaultDeviceId: string,
  rawPayload: unknown,
  rawBinary?: unknown,
): TelemetrySpectrumMessage | null {
  const payloadRecord = asRecord(rawPayload);
  const rawPayloadBytes = toUint8Array(rawPayload);
  const record = payloadRecord ?? {};
  const binaryAttachment = rawBinary ?? (payloadRecord ? undefined : rawPayloadBytes ?? undefined);
  if (!payloadRecord && !binaryAttachment) {
    return null;
  }

  const payloadEnvelopeRecord = asRecord(record.payload);
  const spectrumRecord =
    payloadEnvelopeRecord && Object.keys(payloadEnvelopeRecord).length > 0
      ? payloadEnvelopeRecord
      : record;

  const declaredBinCount = asFiniteNumber(spectrumRecord.bin_count ?? spectrumRecord.binCount);
  const valueScaleCandidate = asFiniteNumber(spectrumRecord.value_scale ?? spectrumRecord.valueScale);
  const binaryMeta = {
    binCount: declaredBinCount !== undefined ? Math.floor(declaredBinCount) : DEFAULT_SPECTRUM_BIN_COUNT,
    valueScale:
      valueScaleCandidate !== undefined && valueScaleCandidate > 0
        ? valueScaleCandidate
        : DEFAULT_SPECTRUM_VALUE_SCALE,
  };
  const binaryBytes = toUint8Array(binaryAttachment);
  const decodedBinary = binaryBytes ? decodeSpectrumBuffer(binaryAttachment, binaryMeta) : null;
  const resolvedValues = decodedBinary
    ? { values: decodedBinary.amplitudes, source: 'binary_attachment' as const }
    : resolveSpectrumValues(axis, spectrumRecord, binaryAttachment);
  if (!resolvedValues || resolvedValues.values.length === 0) {
    return null;
  }
  const values = resolvedValues.values;

  const normalizedBinCount = declaredBinCount
    ? Math.max(1, Math.min(values.length, Math.floor(declaredBinCount)))
    : Math.max(1, Math.min(values.length, DEFAULT_SPECTRUM_BIN_COUNT));
  const normalizedValues = values.slice(0, normalizedBinCount);
  if (normalizedValues.length === 0) {
    return null;
  }

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
      : DEFAULT_SPECTRUM_SOURCE_SAMPLE_COUNT;
  const binHzFromPayload = asFiniteNumber(spectrumRecord.bin_hz ?? spectrumRecord.binHz);
  const binHz =
    binHzFromPayload ??
    (sampleRateHz !== undefined && sourceSampleCount !== undefined && sourceSampleCount > 0
      ? sampleRateHz / sourceSampleCount
      : undefined);

  const amplitudes =
    resolvedValues.source === 'binary_attachment'
      ? normalizedValues.map((value) => Number(value.toFixed(6)))
      : normalizedValues.map((value) =>
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
}
