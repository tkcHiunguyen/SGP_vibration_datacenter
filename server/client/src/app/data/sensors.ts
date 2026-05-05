type SensorStatus = "normal" | "abnormal";

export type DeviceAxisKey = "ax" | "ay" | "az";
export type DeviceAxisLabels = Partial<Record<DeviceAxisKey, string>>;

interface VibrationPoint {
  time: string;
  value: number;
}

export interface Sensor {
  id: string;
  name: string;
  zone: string;
  zoneCode: string;
  site: string;
  uuid: string;
  status: SensorStatus;
  online: boolean;
  lastUpdated: number;
  model: string;
  firmwareVersion: string;
  firmware: string;
  ipAddress: string;
  threshold: number;
  installDate: string;
  samplingRate: string;
  connectedAt: string;
  lastHeartbeatAt: string;
  signal: string;
  uptime: string;
  axisLabels?: DeviceAxisLabels;
  vibration1h: VibrationPoint[];
  vibration5h: VibrationPoint[];
}

interface DeviceMetadata {
  uuid?: string;
  name?: string;
  site?: string;
  zone?: string;
  firmwareVersion?: string;
  axisLabels?: DeviceAxisLabels;
}

interface DeviceHeartbeat {
  socketConnected?: boolean;
  staConnected?: boolean;
  signal?: number;
  uptimeSec?: number;
}

export interface DeviceListItem {
  deviceId: string;
  online: boolean;
  clientIp?: string;
  metadata?: DeviceMetadata;
  connectedAt?: string;
  lastHeartbeatAt?: string;
  heartbeat?: DeviceHeartbeat;
}

export interface DeviceTelemetryPoint {
  receivedAt: string;
  available?: boolean;
  sampleCount?: number;
  sampleRateHz?: number;
  lsbPerG?: number;
  temperature?: number;
  ax?: number;
  ay?: number;
  az?: number;
  uuid?: string;
  telemetryUuid?: string;
}

export type SpectrumAxis = "x" | "y" | "z";

export interface DeviceSpectrumPoint {
  receivedAt: string;
  axis: SpectrumAxis;
  telemetryUuid?: string;
  uuid?: string;
  sourceSampleCount?: number;
  sampleRateHz?: number;
  binCount: number;
  binHz?: number;
  valueScale?: number;
  magnitudeUnit?: string;
  amplitudes: number[];
  peakBinIndex?: number;
  peakFrequencyHz?: number;
  peakAmplitude?: number;
}

function toMinutesAgo(timestamp?: string): number {
  if (!timestamp) {
    return 0;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  const diffMs = Date.now() - parsed;
  return Math.max(0, Math.round(diffMs / 60000));
}

function normalizeFirmware(device: DeviceListItem): string {
  return device.metadata?.firmwareVersion || "v2.4.1";
}

function formatDateTime(timestamp?: string): string {
  if (!timestamp) {
    return "--";
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return "--";
  }

  return new Date(parsed).toLocaleString("vi-VN");
}

function formatUptimeSeconds(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "--";
  }

  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function deriveStatus(device: DeviceListItem): SensorStatus {
  if (!device.online) {
    return "normal";
  }

  const signal = device.heartbeat?.signal;
  // Rule: mark abnormal only when RSSI is weaker than -85 dBm.
  if (typeof signal === "number" && signal < -85) {
    return "abnormal";
  }

  return "normal";
}

function deriveInstallDate(device: DeviceListItem): string {
  const source = device.connectedAt || device.lastHeartbeatAt;
  if (!source) {
    return "--/--/----";
  }

  const parsed = Date.parse(source);
  if (Number.isNaN(parsed)) {
    return "--/--/----";
  }

  return new Date(parsed).toLocaleDateString("vi-VN");
}

function normalizeAxisLabels(axisLabels?: DeviceAxisLabels): DeviceAxisLabels | undefined {
  if (!axisLabels) {
    return undefined;
  }

  const normalized: DeviceAxisLabels = {};
  (["ax", "ay", "az"] as const).forEach((axis) => {
    const label = axisLabels[axis]?.trim();
    if (label) {
      normalized[axis] = label;
    }
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function mapDevicesToSensors(devices: DeviceListItem[]): Sensor[] {
  return devices.map((device) => {
    const id = device.deviceId;
    const online = Boolean(device.online);
    const status = deriveStatus(device);
    const name = device.metadata?.name?.trim() || id;
    const zoneCode = (device.metadata?.zone || "").trim();
    const zone = zoneCode || "--";
    const site = device.metadata?.site || "--";
    const uuid = device.metadata?.uuid || "--";
    const firmwareVersion = device.metadata?.firmwareVersion || "--";

    return {
      id,
      name,
      zone,
      zoneCode,
      site,
      uuid,
      status,
      online,
      lastUpdated: toMinutesAgo(device.lastHeartbeatAt),
      model: "N/A",
      firmwareVersion,
      firmware: normalizeFirmware(device),
      ipAddress: device.clientIp || "N/A",
      threshold: status === "abnormal" ? 1.5 : 1.2,
      installDate: deriveInstallDate(device),
      samplingRate: "1 kHz",
      connectedAt: formatDateTime(device.connectedAt),
      lastHeartbeatAt: formatDateTime(device.lastHeartbeatAt),
      signal:
        typeof device.heartbeat?.signal === "number"
          ? `${device.heartbeat.signal} dBm`
          : "--",
      uptime: formatUptimeSeconds(device.heartbeat?.uptimeSec),
      axisLabels: normalizeAxisLabels(device.metadata?.axisLabels),
      vibration1h: [],
      vibration5h: [],
    };
  });
}
