import type { DeviceAdxlHealth, DeviceTelemetryPoint } from "./sensors";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = asFiniteNumber(value);
    if (typeof parsed === "number") return parsed;
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const parsed = String(value).trim();
    if (parsed) return parsed;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return undefined;
}

function parseAdxlHealth(body: Record<string, unknown>): DeviceAdxlHealth | undefined {
  const status = firstString(body.adxlStatus, body.adxl_status)?.toLowerCase();
  if (status !== "ok" && status !== "fault" && status !== "recovering") return undefined;

  const reason = firstString(body.adxlFaultReason, body.adxl_fault_reason)?.toLowerCase();
  const validReason = reason === "not_detected"
    || reason === "i2c_read_error"
    || reason === "capture_timeout"
    || reason === "unknown";
  return { status, reason: status === "fault" && validReason ? reason : undefined };
}

function parseTelemetryHistoryPoint(item: unknown): DeviceTelemetryPoint | null {
  const row = asRecord(item);
  const body = asRecord(row.payload);
  const receivedAt = firstString(row.receivedAt, row.timestamp, body.receivedAt, body.timestamp);
  if (!receivedAt) return null;

  const temperatureAvailable = asBoolean(body.temperatureAvailable ?? body.temperature_available);
  const vibrationAvailable = asBoolean(body.vibrationAvailable ?? body.vibration_available);
  const vibrationUnavailable = vibrationAvailable === false;
  const adxlHealth = parseAdxlHealth(body);

  return {
    receivedAt,
    bucketStartedAt: firstString(row.bucketStartedAt, row.bucket_started_at),
    bucketEndedAt: firstString(row.bucketEndedAt, row.bucket_ended_at),
    available: typeof body.available === "boolean" ? body.available : undefined,
    sampleCount: firstFiniteNumber(row.sampleCount, row.sample_count, body.sampleCount, body.sample_count),
    sampleRateHz: firstFiniteNumber(body.sampleRateHz, body.sample_rate_hz),
    lsbPerG: firstFiniteNumber(body.lsbPerG, body.lsb_per_g),
    messageId: firstString(row.messageId, row.message_id, body.messageId, body.message_id),
    temperatureAvailable,
    vibrationAvailable,
    adxlStatus: adxlHealth?.status,
    adxlFaultReason: adxlHealth?.reason,
    temperature: temperatureAvailable === false ? undefined : firstFiniteNumber(row.temperature, body.temperature),
    ax: vibrationUnavailable ? undefined : firstFiniteNumber(row.ax, body.ax),
    ay: vibrationUnavailable ? undefined : firstFiniteNumber(row.ay, body.ay),
    az: vibrationUnavailable ? undefined : firstFiniteNumber(row.az, body.az),
    vrmsXMms: vibrationUnavailable ? undefined : firstFiniteNumber(row.vrmsXMms, row.vrms_x_mms, body.vrmsXMms, body.vrms_x_mms, body.vx_rms_mms),
    vrmsYMms: vibrationUnavailable ? undefined : firstFiniteNumber(row.vrmsYMms, row.vrms_y_mms, body.vrmsYMms, body.vrms_y_mms, body.vy_rms_mms),
    vrmsZMms: vibrationUnavailable ? undefined : firstFiniteNumber(row.vrmsZMms, row.vrms_z_mms, body.vrmsZMms, body.vrms_z_mms, body.vz_rms_mms),
    vrmsUnit: vibrationUnavailable ? undefined : firstString(row.vrmsUnit, row.vrms_unit, body.vrmsUnit, body.vrms_unit),
    drmsXUm: vibrationUnavailable ? undefined : firstFiniteNumber(row.drmsXUm, row.drms_x_um, body.drmsXUm, body.drms_x_um),
    drmsYUm: vibrationUnavailable ? undefined : firstFiniteNumber(row.drmsYUm, row.drms_y_um, body.drmsYUm, body.drms_y_um),
    drmsZUm: vibrationUnavailable ? undefined : firstFiniteNumber(row.drmsZUm, row.drms_z_um, body.drmsZUm, body.drms_z_um),
    drmsBandMinHz: vibrationUnavailable ? undefined : firstFiniteNumber(row.drmsBandMinHz, row.drms_band_min_hz, body.drmsBandMinHz, body.drms_band_min_hz),
    drmsBandMaxHz: vibrationUnavailable ? undefined : firstFiniteNumber(row.drmsBandMaxHz, row.drms_band_max_hz, body.drmsBandMaxHz, body.drms_band_max_hz),
    drmsUnit: vibrationUnavailable ? undefined : firstString(row.drmsUnit, row.drms_unit, body.drmsUnit, body.drms_unit),
    uuid: firstString(row.uuid, body.uuid),
    telemetryUuid: vibrationUnavailable
      ? undefined
      : firstString(row.telemetryUuid, row.telemetry_uuid, body.telemetryUuid, body.telemetry_uuid),
  };
}

export function parseTelemetryHistoryPayload(payload: unknown): DeviceTelemetryPoint[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  return firstArray(data.items, root.items, payload)
    .map(parseTelemetryHistoryPoint)
    .filter((item): item is DeviceTelemetryPoint => Boolean(item))
    .sort((left, right) => (left.bucketStartedAt ?? left.receivedAt).localeCompare(right.bucketStartedAt ?? right.receivedAt));
}
