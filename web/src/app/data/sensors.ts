export type SensorStatus = "normal" | "abnormal";

export interface VibrationPoint {
  time: string;
  value: number;
}

export interface Sensor {
  id: string;
  name: string;
  zone: string;
  site: string;
  uuid: string;
  status: SensorStatus;
  online: boolean;
  lastUpdated: number;
  model: string;
  sensorVersion: string;
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
  vibration1h: VibrationPoint[];
  vibration5h: VibrationPoint[];
}

export interface DeviceMetadata {
  uuid?: string;
  name?: string;
  site?: string;
  zone?: string;
  firmwareVersion?: string;
  sensorVersion?: string;
}

export interface DeviceHeartbeat {
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

function seededValue(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) / 0xffffffff;
}

function createSeries(points: number, base: number, jitter: number, seed: string): number[] {
  const values: number[] = [];
  let current = base;

  for (let i = 0; i < points; i += 1) {
    const n1 = seededValue(`${seed}:${i}`) - 0.5;
    const n2 = seededValue(`${seed}:trend:${i}`) - 0.5;
    current = Math.max(0.02, current + n2 * 0.05);
    const value = Math.max(0, current + n1 * jitter);
    values.push(Number(value.toFixed(3)));
  }

  return values;
}

function buildTimeline(points: number, stepMinutes: number): string[] {
  const now = new Date();
  return Array.from({ length: points }, (_, i) => {
    const d = new Date(now.getTime() - (points - 1 - i) * stepMinutes * 60 * 1000);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
}

function generateVibrationPoints(seed: string, base: number, jitter: number, stepMinutes: number): VibrationPoint[] {
  const values = createSeries(60, base, jitter, seed);
  const times = buildTimeline(60, stepMinutes);
  return values.map((value, index) => ({ time: times[index], value }));
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
  return (
    device.metadata?.firmwareVersion ||
    device.metadata?.sensorVersion ||
    "v2.4.1"
  );
}

function deriveZone(device: DeviceListItem): string {
  return device.metadata?.zone || device.metadata?.site || "Không rõ";
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

export function mapDevicesToSensors(devices: DeviceListItem[]): Sensor[] {
  return devices.map((device) => {
    const id = device.deviceId;
    const online = Boolean(device.online);
    const status = deriveStatus(device);
    const name = device.metadata?.name?.trim() || id;
    const zone = deriveZone(device);
    const site = device.metadata?.site || "--";
    const uuid = device.metadata?.uuid || "--";
    const sensorVersion = device.metadata?.sensorVersion || "--";
    const firmwareVersion = device.metadata?.firmwareVersion || "--";

    const base = status === "abnormal" ? 1.1 : online ? 0.45 : 0.2;
    const jitter = status === "abnormal" ? 0.55 : online ? 0.18 : 0.08;

    return {
      id,
      name,
      zone,
      site,
      uuid,
      status,
      online,
      lastUpdated: toMinutesAgo(device.lastHeartbeatAt),
      model: sensorVersion !== "--" ? sensorVersion : "N/A",
      sensorVersion,
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
      vibration1h: generateVibrationPoints(`${id}:1h`, base, jitter, 1),
      vibration5h: generateVibrationPoints(`${id}:5h`, base, jitter, 5),
    };
  });
}
