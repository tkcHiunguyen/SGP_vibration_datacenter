import type { DeviceAxisKey, DeviceAxisLabels, DeviceTelemetryPoint, Sensor } from "../data/sensors";

export type DeviceSortKey = "status" | "zone" | "name-az" | "device-id";

export const DEFAULT_DEVICE_SORT: DeviceSortKey = "zone";

export const DEVICE_AXIS_DIRECTION_LABELS: Record<DeviceAxisKey, string> = {
  ax: "Horizontal Direction",
  ay: "Axial Direction",
  az: "Vertical Direction",
};

export type DeviceTelemetrySummaryItem = {
  label: string;
  value: string;
};

export type DeviceTelemetryCardReadout = {
  temperature: DeviceTelemetrySummaryItem;
  axes: DeviceTelemetrySummaryItem[];
};

const DEFAULT_DEVICE_AXIS_LABELS = {
  ax: "X",
  ay: "Y",
  az: "Z",
} as const;

const DEVICE_AXIS_KEYS = ["ax", "ay", "az"] as const;
const UNASSIGNED_ZONE_LABEL = "Chưa gán";

type DeviceZoneOption = {
  code: string;
  name: string;
};

function normalizeZoneComparison(value: string): string {
  return value
    .trim()
    .toLocaleUpperCase("vi-VN")
    .replace(/[^A-Z0-9]+/g, "");
}

export function formatDeviceZoneOptionLabel(zone: DeviceZoneOption): string {
  const code = zone.code.trim();
  const name = zone.name.trim();

  if (!code) {
    return name;
  }
  if (!name || normalizeZoneComparison(code) === normalizeZoneComparison(name)) {
    return code;
  }

  return `${code} - ${name}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatTemperature(value?: number): string {
  return isFiniteNumber(value) ? `${value.toFixed(1)}°C` : "";
}

function formatAxisValue(value?: number): string {
  return isFiniteNumber(value) ? `${value.toFixed(2)}m/s²` : "";
}

function normalizeZoneLabel(value?: string): string {
  const trimmed = value?.trim() || "";
  return trimmed && trimmed !== "--" ? trimmed : "";
}

function getSensorZoneLabel(sensor: Pick<Sensor, "zoneCode" | "zone">): string {
  return normalizeZoneLabel(sensor.zoneCode) || normalizeZoneLabel(sensor.zone) || UNASSIGNED_ZONE_LABEL;
}

function getSensorZoneKey(sensor: Pick<Sensor, "zoneCode" | "zone">): string {
  return getSensorZoneLabel(sensor).toLocaleLowerCase("vi-VN");
}

export function getDeviceAxisPeakMagnitude(point?: DeviceTelemetryPoint | null): number | null {
  let peak: number | null = null;

  for (const axis of DEVICE_AXIS_KEYS) {
    const value = point?.[axis];
    if (!isFiniteNumber(value)) {
      continue;
    }
    const magnitude = Math.abs(value);
    if (peak === null || magnitude > peak) {
      peak = magnitude;
    }
  }

  return peak;
}

export function pickZoneAxisDisplayDeviceIds(
  sensors: ReadonlyArray<Pick<Sensor, "id" | "zoneCode" | "zone">>,
  latestTelemetryByDevice: Record<string, DeviceTelemetryPoint | null | undefined>,
): Set<string> {
  const zoneWinners = new Map<string, { deviceId: string; peak: number }>();

  sensors.forEach((sensor) => {
    const peak = getDeviceAxisPeakMagnitude(latestTelemetryByDevice[sensor.id]);
    if (peak === null) {
      return;
    }

    const zoneKey = getSensorZoneKey(sensor);
    const currentWinner = zoneWinners.get(zoneKey);
    if (!currentWinner || peak > currentWinner.peak) {
      zoneWinners.set(zoneKey, { deviceId: sensor.id, peak });
    }
  });

  return new Set(Array.from(zoneWinners.values(), (winner) => winner.deviceId));
}

export function getLatestDeviceTelemetryPoint(points: DeviceTelemetryPoint[]): DeviceTelemetryPoint | null {
  let latest: DeviceTelemetryPoint | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const timestamp = Date.parse(point.receivedAt);
    if (!Number.isFinite(timestamp) || timestamp < latestTimestamp) {
      continue;
    }
    latest = point;
    latestTimestamp = timestamp;
  }

  return latest;
}

export function buildDeviceTelemetrySummary(
  point?: DeviceTelemetryPoint | null,
  axisLabels?: DeviceAxisLabels,
): DeviceTelemetrySummaryItem[] {
  return [
    { label: "T", value: formatTemperature(point?.temperature) },
    { label: axisLabels?.ax || DEFAULT_DEVICE_AXIS_LABELS.ax, value: formatAxisValue(point?.ax) },
    { label: axisLabels?.ay || DEFAULT_DEVICE_AXIS_LABELS.ay, value: formatAxisValue(point?.ay) },
    { label: axisLabels?.az || DEFAULT_DEVICE_AXIS_LABELS.az, value: formatAxisValue(point?.az) },
  ];
}

export function buildDeviceTelemetryCardReadout(
  point?: DeviceTelemetryPoint | null,
  axisLabels?: DeviceAxisLabels,
): DeviceTelemetryCardReadout {
  const [temperature, ...axes] = buildDeviceTelemetrySummary(point, axisLabels);
  return { temperature, axes };
}

export function buildDeviceAxisLabelUpdate(
  currentLabels: DeviceAxisLabels | undefined,
  axis: DeviceAxisKey,
  label: string,
): DeviceAxisLabels | undefined {
  const nextLabels: DeviceAxisLabels = { ...(currentLabels ?? {}) };
  const normalizedLabel = label.trim();

  if (normalizedLabel) {
    nextLabels[axis] = normalizedLabel;
  } else {
    delete nextLabels[axis];
  }

  return DEVICE_AXIS_KEYS.some((axisKey) => Boolean(nextLabels[axisKey])) ? nextLabels : undefined;
}
