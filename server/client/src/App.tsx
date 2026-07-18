import { lazy, Profiler, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ProfilerOnRenderCallback } from "react";
import { io } from "socket.io-client";
import { ThemeProvider, useTheme } from "./app/context/ThemeContext";
import { TopHeader } from "./app/components/TopHeader";
import { LeftPanel } from "./app/components/LeftPanel";
import { MainPanel } from "./app/components/MainPanel";
import { ToastStack } from "./app/components/ui";
import {
  DeviceListItem,
  DeviceAdxlHealth,
  DeviceSpectrumPoint,
  DeviceTelemetryPoint,
  SpectrumAxis,
  mapDevicesToSensors,
  Sensor,
} from "./app/data/sensors";

const ThreeDPage = lazy(() =>
  import("./app/components/ThreeDPage").then((module) => ({
    default: module.ThreeDPage,
  })),
);

const NAV_TO_PATH: Record<string, string> = {
  "Tổng quan": "/dashboard",
  "Update Center": "/ota",
  "Quản lý khu vực": "/zones",
  "Cảm biến": "/sensors",
  "Cài đặt": "/settings",
};

const SIDEBAR_NAV_ORDER = [
  "Tổng quan",
  "Update Center",
  "Quản lý khu vực",
  "Cảm biến",
  "Cài đặt",
] as const;

const PINNED_NAV_STORAGE_KEY = "sgp:pinned-navs:v1";
const SIDEBAR_OPEN_STORAGE_KEY = "sgp:sidebar-open:v1";

function isKnownNavLabel(value: string): value is (typeof SIDEBAR_NAV_ORDER)[number] {
  return SIDEBAR_NAV_ORDER.includes(value as (typeof SIDEBAR_NAV_ORDER)[number]);
}

function normalizePinnedNavLabels(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of input) {
    const label = safeString(item).trim();
    if (label && isKnownNavLabel(label)) {
      unique.add(label);
    }
  }
  return [...unique];
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.replace(/\/+$/, "");
}

function navFromPathname(pathname: string): string {
  const normalized = normalizePathname(pathname);
  switch (normalized) {
    case "/":
    case "/app":
    case "/dashboard":
    case "/app/dashboard":
      return "Tổng quan";
    case "/ota":
    case "/app/ota":
      return "Update Center";
    case "/zones":
    case "/app/zones":
      return "Quản lý khu vực";
    case "/sensors":
    case "/app/sensors":
      return "Cảm biến";
    case "/settings":
    case "/app/settings":
      return "Cài đặt";
    default:
      return "Tổng quan";
  }
}

function pathFromNav(label: string): string {
  return NAV_TO_PATH[label] || "/dashboard";
}

type ApiResult<T> = {
  ok: boolean;
  status: number;
  payload: T | null;
};

const TELEMETRY_OVERVIEW_POINTS = 1;
const TELEMETRY_CHART_INITIAL_POINTS = 100;
// Charts never need more samples than they can draw. Long ranges use server buckets.
const TELEMETRY_HISTORY_RAW_MAX_POINTS = 8_000;
const TELEMETRY_HISTORY_DETAIL_CACHE_MAX_POINTS = 8_000;
const TELEMETRY_HISTORY_BUCKET_FALLBACK_POINTS = 8_000;
const SPECTRUM_OVERVIEW_BUFFER_SIZE = 6;
const REALTIME_FLUSH_INTERVAL_MS = 125;
const INVENTORY_REFRESH_INTERVAL_MS = 30_000;
const TOAST_DURATION_MS = 10_000;
const TOAST_EXIT_MS = 260;

type TelemetryHistoryRequestOptions = {
  limit?: number;
  bucketMs?: number;
  from?: string;
  to?: string;
  force?: boolean;
  replace?: boolean;
};

type ToastMessage = {
  id: number;
  text: string;
  title?: string;
  type: "success" | "warning";
  closing?: boolean;
};

type SignalAlert = {
  id: string;
  deviceId: string;
  deviceName: string;
  signal: number;
  createdAt: string;
};

function safeString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function parseDevices(payload: unknown): DeviceListItem[] {
  const root = asRecord(payload);
  const source = firstArray(root.data, root.devices, root.items, payload);

  return source
    .map((item) => asRecord(item))
    .map((item) => {
      const metadata = asRecord(item.metadata);
      return {
        deviceId: safeString(item.deviceId || item.id || item.device_id),
        online: Boolean(item.online),
        clientIp: safeString(item.clientIp || item.client_ip || item.ipAddress || item.ip_address) || undefined,
        connectedAt: safeString(item.connectedAt || item.connected_at) || undefined,
        lastHeartbeatAt:
          safeString(item.lastHeartbeatAt || item.last_heartbeat_at) || undefined,
        heartbeat: asRecord(item.heartbeat),
        metadata: { ...metadata, adxlHealth: parseAdxlHealth(metadata.adxlHealth || metadata.adxl_health) },
      };
    })
    .filter((item) => Boolean(item.deviceId));
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1") {
    return true;
  }
  if (value === 0 || value === "0") {
    return false;
  }
  return undefined;
}

function parseAdxlHealth(value: unknown): DeviceAdxlHealth | undefined {
  const record = asRecord(value);
  const status = safeString(record.status).trim().toLowerCase();
  if (status !== "ok" && status !== "fault" && status !== "recovering") {
    return undefined;
  }
  const reason = safeString(record.reason).trim().toLowerCase();
  const validReason = reason === "not_detected" || reason === "i2c_read_error" || reason === "capture_timeout" || reason === "unknown";
  return {
    status,
    reason: status === "fault" && validReason ? reason : undefined,
    updatedAt: safeString(record.updatedAt || record.updated_at) || undefined,
    captureTimeoutCount: asNumber(record.captureTimeoutCount ?? record.capture_timeout_count),
    i2cReadErrorCount: asNumber(record.i2cReadErrorCount ?? record.i2c_read_error_count),
  };
}

function getBucketRetentionLimit(bucketMs: number | undefined, from: string, to: string): number {
  if (!bucketMs) {
    return TELEMETRY_CHART_INITIAL_POINTS;
  }

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return TELEMETRY_HISTORY_BUCKET_FALLBACK_POINTS;
  }

  return Math.min(TELEMETRY_HISTORY_DETAIL_CACHE_MAX_POINTS, Math.max(
    TELEMETRY_CHART_INITIAL_POINTS,
    Math.ceil((toMs - fromMs + 1) / bucketMs) + 4,
  ));
}

function asSpectrumAxis(value: unknown): SpectrumAxis | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "x" || normalized === "y" || normalized === "z") {
    return normalized;
  }

  return undefined;
}

function parseAmplitudeArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: number[] = [];
  for (const item of value) {
    const n = asNumber(item);
    if (typeof n === "number") {
      parsed.push(n);
    }
  }
  return parsed;
}

function parseTelemetryEvent(payload: unknown): { deviceId: string; point: DeviceTelemetryPoint } | null {
  const root = asRecord(payload);
  const body = asRecord(root.payload);

  const deviceId = safeString(root.deviceId || body.deviceId || body.id || body.device_id).trim();
  if (!deviceId) {
    return null;
  }

  const temperatureAvailable = asBoolean(body.temperatureAvailable ?? body.temperature_available);
  const vibrationAvailable = asBoolean(body.vibrationAvailable ?? body.vibration_available);
  const isVibrationUnavailable = vibrationAvailable === false;
  const adxlHealth = parseAdxlHealth({
    status: body.adxlStatus ?? body.adxl_status,
    reason: body.adxlFaultReason ?? body.adxl_fault_reason,
  });
  const point: DeviceTelemetryPoint = {
    receivedAt: safeString(root.receivedAt || root.timestamp || body.receivedAt || body.timestamp) || new Date().toISOString(),
    available: typeof body.available === "boolean" ? body.available : undefined,
    sampleCount: asNumber(body.sample_count ?? body.sampleCount),
    sampleRateHz: asNumber(body.sample_rate_hz ?? body.sampleRateHz),
    lsbPerG: asNumber(body.lsb_per_g ?? body.lsbPerG),
    messageId: safeString(body.messageId || body.message_id) || undefined,
    temperatureAvailable,
    vibrationAvailable,
    adxlStatus: adxlHealth?.status,
    adxlFaultReason: adxlHealth?.reason,
    temperature: temperatureAvailable === false ? undefined : asNumber(body.temperature),
    ax: isVibrationUnavailable ? undefined : asNumber(body.ax),
    ay: isVibrationUnavailable ? undefined : asNumber(body.ay),
    az: isVibrationUnavailable ? undefined : asNumber(body.az),
    vrmsXMms: isVibrationUnavailable ? undefined : asNumber(root.vrmsXMms ?? root.vrms_x_mms ?? body.vrmsXMms ?? body.vrms_x_mms ?? body.vx_rms_mms),
    vrmsYMms: isVibrationUnavailable ? undefined : asNumber(root.vrmsYMms ?? root.vrms_y_mms ?? body.vrmsYMms ?? body.vrms_y_mms ?? body.vy_rms_mms),
    vrmsZMms: isVibrationUnavailable ? undefined : asNumber(root.vrmsZMms ?? root.vrms_z_mms ?? body.vrmsZMms ?? body.vrms_z_mms ?? body.vz_rms_mms),
    vrmsUnit: isVibrationUnavailable ? undefined : safeString(root.vrmsUnit || root.vrms_unit || body.vrmsUnit || body.vrms_unit) || undefined,
    drmsXUm: isVibrationUnavailable ? undefined : asNumber(root.drmsXUm ?? root.drms_x_um ?? body.drmsXUm ?? body.drms_x_um),
    drmsYUm: isVibrationUnavailable ? undefined : asNumber(root.drmsYUm ?? root.drms_y_um ?? body.drmsYUm ?? body.drms_y_um),
    drmsZUm: isVibrationUnavailable ? undefined : asNumber(root.drmsZUm ?? root.drms_z_um ?? body.drmsZUm ?? body.drms_z_um),
    drmsBandMinHz: isVibrationUnavailable ? undefined : asNumber(root.drmsBandMinHz ?? root.drms_band_min_hz ?? body.drmsBandMinHz ?? body.drms_band_min_hz),
    drmsBandMaxHz: isVibrationUnavailable ? undefined : asNumber(root.drmsBandMaxHz ?? root.drms_band_max_hz ?? body.drmsBandMaxHz ?? body.drms_band_max_hz),
    drmsUnit: isVibrationUnavailable ? undefined : safeString(root.drmsUnit || root.drms_unit || body.drmsUnit || body.drms_unit) || undefined,
    uuid: safeString(body.uuid) || undefined,
    telemetryUuid: isVibrationUnavailable ? undefined : safeString(root.telemetryUuid || root.telemetry_uuid || body.telemetryUuid || body.telemetry_uuid) || undefined,
  };

  return { deviceId, point };
}

function parseSpectrumEvent(payload: unknown): { deviceId: string; point: DeviceSpectrumPoint } | null {
  const root = asRecord(payload);
  const body = asRecord(root.payload);

  const deviceId = safeString(root.deviceId || body.deviceId || body.id || body.device_id).trim();
  const axis = asSpectrumAxis(root.axis || body.axis);
  const amplitudes = parseAmplitudeArray(root.amplitudes || body.amplitudes);

  if (!deviceId || !axis || amplitudes.length === 0) {
    return null;
  }

  const point: DeviceSpectrumPoint = {
    receivedAt:
      safeString(root.receivedAt || root.timestamp || body.receivedAt || body.timestamp) ||
      new Date().toISOString(),
    axis,
    telemetryUuid:
      safeString(root.telemetryUuid || root.telemetry_uuid || body.telemetryUuid || body.telemetry_uuid) || undefined,
    uuid: safeString(root.uuid || body.uuid) || undefined,
    sourceSampleCount: asNumber(root.sourceSampleCount ?? root.source_sample_count ?? body.sourceSampleCount ?? body.source_sample_count),
    sampleRateHz: asNumber(root.sampleRateHz ?? root.sample_rate_hz ?? body.sampleRateHz ?? body.sample_rate_hz),
    binCount:
      Math.max(
        1,
        Math.floor(
          asNumber(root.binCount ?? root.bin_count ?? body.binCount ?? body.bin_count) ?? amplitudes.length,
        ),
      ),
    binHz: asNumber(root.binHz ?? root.bin_hz ?? body.binHz ?? body.bin_hz),
    valueScale: asNumber(root.valueScale ?? root.value_scale ?? body.valueScale ?? body.value_scale),
    magnitudeUnit: safeString(root.magnitudeUnit || root.magnitude_unit || body.magnitudeUnit || body.magnitude_unit) || undefined,
    amplitudes,
    peakBinIndex: asNumber(root.peakBinIndex ?? root.peak_bin_index ?? body.peakBinIndex ?? body.peak_bin_index),
    peakFrequencyHz:
      asNumber(root.peakFrequencyHz ?? root.peak_frequency_hz ?? body.peakFrequencyHz ?? body.peak_frequency_hz),
    peakAmplitude:
      asNumber(root.peakAmplitude ?? root.peak_amplitude ?? body.peakAmplitude ?? body.peak_amplitude),
  };

  return { deviceId, point };
}

function parseTelemetryPoint(item: unknown): DeviceTelemetryPoint | null {
  const row = asRecord(item);
  const body = asRecord(row.payload);
  const receivedAt = safeString(row.receivedAt || row.timestamp || body.receivedAt || body.timestamp).trim();
  if (!receivedAt) {
    return null;
  }

  const temperatureAvailable = asBoolean(body.temperatureAvailable ?? body.temperature_available);
  const vibrationAvailable = asBoolean(body.vibrationAvailable ?? body.vibration_available);
  const isVibrationUnavailable = vibrationAvailable === false;
  const adxlHealth = parseAdxlHealth({
    status: body.adxlStatus ?? body.adxl_status,
    reason: body.adxlFaultReason ?? body.adxl_fault_reason,
  });
  return {
    receivedAt,
    available: typeof body.available === "boolean" ? body.available : undefined,
    sampleCount: asNumber(body.sample_count ?? body.sampleCount),
    sampleRateHz: asNumber(body.sample_rate_hz ?? body.sampleRateHz),
    lsbPerG: asNumber(body.lsb_per_g ?? body.lsbPerG),
    messageId: safeString(body.messageId || body.message_id) || undefined,
    temperatureAvailable,
    vibrationAvailable,
    adxlStatus: adxlHealth?.status,
    adxlFaultReason: adxlHealth?.reason,
    temperature: temperatureAvailable === false ? undefined : asNumber(body.temperature),
    ax: isVibrationUnavailable ? undefined : asNumber(body.ax),
    ay: isVibrationUnavailable ? undefined : asNumber(body.ay),
    az: isVibrationUnavailable ? undefined : asNumber(body.az),
    vrmsXMms: isVibrationUnavailable ? undefined : asNumber(row.vrmsXMms ?? row.vrms_x_mms ?? body.vrmsXMms ?? body.vrms_x_mms ?? body.vx_rms_mms),
    vrmsYMms: isVibrationUnavailable ? undefined : asNumber(row.vrmsYMms ?? row.vrms_y_mms ?? body.vrmsYMms ?? body.vrms_y_mms ?? body.vy_rms_mms),
    vrmsZMms: isVibrationUnavailable ? undefined : asNumber(row.vrmsZMms ?? row.vrms_z_mms ?? body.vrmsZMms ?? body.vrms_z_mms ?? body.vz_rms_mms),
    vrmsUnit: isVibrationUnavailable ? undefined : safeString(row.vrmsUnit || row.vrms_unit || body.vrmsUnit || body.vrms_unit) || undefined,
    drmsXUm: isVibrationUnavailable ? undefined : asNumber(row.drmsXUm ?? row.drms_x_um ?? body.drmsXUm ?? body.drms_x_um),
    drmsYUm: isVibrationUnavailable ? undefined : asNumber(row.drmsYUm ?? row.drms_y_um ?? body.drmsYUm ?? body.drms_y_um),
    drmsZUm: isVibrationUnavailable ? undefined : asNumber(row.drmsZUm ?? row.drms_z_um ?? body.drmsZUm ?? body.drms_z_um),
    drmsBandMinHz: isVibrationUnavailable ? undefined : asNumber(row.drmsBandMinHz ?? row.drms_band_min_hz ?? body.drmsBandMinHz ?? body.drms_band_min_hz),
    drmsBandMaxHz: isVibrationUnavailable ? undefined : asNumber(row.drmsBandMaxHz ?? row.drms_band_max_hz ?? body.drmsBandMaxHz ?? body.drms_band_max_hz),
    drmsUnit: isVibrationUnavailable ? undefined : safeString(row.drmsUnit || row.drms_unit || body.drmsUnit || body.drms_unit) || undefined,
    uuid: safeString(body.uuid) || undefined,
    telemetryUuid: isVibrationUnavailable ? undefined : safeString(row.telemetryUuid || row.telemetry_uuid || body.telemetryUuid || body.telemetry_uuid) || undefined,
  };
}

function parseTelemetryHistoryPayload(payload: unknown): DeviceTelemetryPoint[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const source = firstArray(data.items, root.items, payload);

  return source
    .map((item) => parseTelemetryPoint(item))
    .filter((item): item is DeviceTelemetryPoint => Boolean(item))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

function telemetryKey(point: DeviceTelemetryPoint): string {
  return point.messageId || point.telemetryUuid || point.receivedAt;
}

function telemetryTimestampMs(point: DeviceTelemetryPoint): number {
  const parsed = Date.parse(point.receivedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function insertRealtimePoint<T extends { receivedAt: string }>(
  current: T[],
  incoming: T,
  keyOf: (point: T) => string,
  maxPoints: number,
): T[] {
  if (current.length === 0) {
    return [incoming];
  }

  const incomingKey = keyOf(incoming);
  const lastIndex = current.length - 1;
  const last = current[lastIndex];
  if (keyOf(last) === incomingKey) {
    const next = current.slice();
    next[lastIndex] = incoming;
    return next;
  }

  // Device events are normally ordered. Keep the hot path O(1), with a binary
  // insertion fallback for a delayed packet rather than sorting every update.
  if (incoming.receivedAt >= last.receivedAt) {
    return [...current, incoming].slice(-maxPoints);
  }

  let low = 0;
  let high = current.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (current[middle].receivedAt < incoming.receivedAt) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const existing = current[low];
  const next = current.slice();
  if (existing && keyOf(existing) === incomingKey) {
    next[low] = incoming;
  } else {
    next.splice(low, 0, incoming);
  }
  return next.slice(-maxPoints);
}

function mergeTelemetryPoints(
  current: DeviceTelemetryPoint[],
  incoming: DeviceTelemetryPoint[],
  maxPoints = TELEMETRY_OVERVIEW_POINTS,
): DeviceTelemetryPoint[] {
  return incoming.reduce(
    (points, point) => insertRealtimePoint(points, point, telemetryKey, maxPoints),
    current.slice(-maxPoints),
  );
}

function spectrumKey(point: DeviceSpectrumPoint): string {
  return point.telemetryUuid
    ? `${point.telemetryUuid}:${point.axis}`
    : `${point.receivedAt}:${point.axis}:${point.binCount}`;
}

function mergeSpectrumPoints(
  current: DeviceSpectrumPoint[],
  incoming: DeviceSpectrumPoint[],
  maxPoints = SPECTRUM_OVERVIEW_BUFFER_SIZE,
): DeviceSpectrumPoint[] {
  return incoming.reduce(
    (points, point) => insertRealtimePoint(points, point, spectrumKey, maxPoints),
    current.slice(-maxPoints),
  );
}

function mergeTelemetryHistory(
  current: DeviceTelemetryPoint[],
  incoming: DeviceTelemetryPoint[],
  maxPoints: number,
): DeviceTelemetryPoint[] {
  const unique = new Map<string, DeviceTelemetryPoint>();
  for (const point of current) {
    unique.set(telemetryKey(point), point);
  }
  for (const point of incoming) {
    unique.set(telemetryKey(point), point);
  }
  return [...unique.values()]
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
    .slice(-maxPoints);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const headers = new Headers({
      Accept: "application/json",
    });

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });

    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      payload: payload as T | null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: { error: safeString(error) } as T,
    };
  }
}

function DashboardShell({
  sensors,
  telemetryByDevice,
  telemetryLoadingByDevice,
  spectrumByDevice,
  onRequestTelemetryHistory,
  onNotify,
  onDeviceDataCleared,
  onChartClosed,
  onSensorUpdated,
  toasts,
  onDismissToast,
  signalAlerts,
}: {
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
  spectrumByDevice: Record<string, DeviceSpectrumPoint[]>;
  onRequestTelemetryHistory: (deviceId: string, options?: TelemetryHistoryRequestOptions) => Promise<void>;
  onNotify: (message: Omit<ToastMessage, "id">) => void;
  onDeviceDataCleared: (deviceId: string) => void;
  onChartClosed: (deviceId: string) => void;
  onSensorUpdated: (sensor: Sensor) => void;
  toasts: ToastMessage[];
  onDismissToast: (toastId: number) => void;
  signalAlerts: SignalAlert[];
}) {
  const { C, theme } = useTheme();
  const [activeNav, setActiveNav] = useState(() => navFromPathname(window.location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
      return raw === null ? false : raw === "true";
    } catch {
      return false;
    }
  });
  const [pinnedNavLabels, setPinnedNavLabels] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_NAV_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      return normalizePinnedNavLabels(JSON.parse(raw));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PINNED_NAV_STORAGE_KEY,
        JSON.stringify(normalizePinnedNavLabels(pinnedNavLabels)),
      );
    } catch {
      // ignore storage errors
    }
  }, [pinnedNavLabels]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(sidebarOpen));
    } catch {
      // ignore storage errors
    }
  }, [sidebarOpen]);

  const sidebarNavItems = useMemo(() => {
    const pinned = normalizePinnedNavLabels(pinnedNavLabels);
    const rest = SIDEBAR_NAV_ORDER.filter((label) => !pinned.includes(label));
    return [...pinned, ...rest];
  }, [pinnedNavLabels]);

  const topbarNavItems = useMemo(() => {
    // Keep strict pin order: first pinned appears on the left, next pins append to the right.
    return normalizePinnedNavLabels(pinnedNavLabels);
  }, [pinnedNavLabels]);

  const togglePinnedNav = useCallback((label: string) => {
    if (!isKnownNavLabel(label)) {
      return;
    }
    setPinnedNavLabels((prev) =>
      prev.includes(label)
        ? prev.filter((item) => item !== label)
        : [...prev, label],
    );
  }, []);

  const navigateToNav = useCallback((label: string, mode: "push" | "replace" = "push") => {
    const targetLabel = label || "Tổng quan";
    const targetPath = pathFromNav(targetLabel);
    setActiveNav(targetLabel);

    if (normalizePathname(window.location.pathname) === normalizePathname(targetPath)) {
      return;
    }

    if (mode === "replace") {
      window.history.replaceState({}, "", targetPath);
      return;
    }

    window.history.pushState({}, "", targetPath);
  }, []);

  useEffect(() => {
    const currentNav = navFromPathname(window.location.pathname);
    navigateToNav(currentNav, "replace");

    const handlePopState = () => {
      setActiveNav(navFromPathname(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [navigateToNav]);

  return (
    <div
      className="dc-app-shell"
      style={{
        background: C.bg,
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        transition: "background 0.25s",
        colorScheme: theme,
      }}
    >
      <TopHeader
        activeNav={activeNav}
        onNavChange={(label) => navigateToNav(label)}
        navItems={topbarNavItems}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        sensors={sensors}
        alertCount={signalAlerts.length}
      />

      <div className="dc-app-body">
        <button
          type="button"
          aria-label="Đóng menu điều hướng"
          className={`dc-sidebar-backdrop${sidebarOpen ? " is-visible" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />
        <div
          className={`dc-sidebar-shell${sidebarOpen ? " is-open" : ""}`}
        >
          <LeftPanel
            activeNav={activeNav}
            onNavChange={(label) => navigateToNav(label)}
            navItems={sidebarNavItems}
            pinnedNavItems={pinnedNavLabels}
            onTogglePin={togglePinnedNav}
            totalSensors={sensors.length}
            onlineSensors={sensors.filter((sensor) => sensor.online).length}
            offlineSensors={sensors.filter((sensor) => !sensor.online).length}
            alertCount={signalAlerts.length}
          />
        </div>

        <MainPanel
          activeNav={activeNav}
          sensors={sensors}
          telemetryByDevice={telemetryByDevice}
          telemetryLoadingByDevice={telemetryLoadingByDevice}
          spectrumByDevice={spectrumByDevice}
          onRequestTelemetryHistory={onRequestTelemetryHistory}
          onNotify={onNotify}
          onDeviceDataCleared={onDeviceDataCleared}
          onChartClosed={onChartClosed}
          onSensorUpdated={onSensorUpdated}
        />
      </div>
      <ToastStack items={toasts} onDismiss={onDismissToast} />
    </div>
  );
}

export default function App() {
  const pathname = window.location.pathname;
  if (pathname === "/threed" || pathname === "/app/threed") {
    return (
      <Suspense fallback={<div style={{ width: "100vw", height: "100dvh", background: "#020617" }} />}>
        <ThreeDPage />
      </Suspense>
    );
  }

  const [inventoryDevices, setInventoryDevices] = useState<DeviceListItem[]>([]);
  const [telemetryByDevice, setTelemetryByDevice] = useState<Record<string, DeviceTelemetryPoint[]>>({});
  const [telemetryLoadingByDevice, setTelemetryLoadingByDevice] = useState<Record<string, boolean>>({});
  const [spectrumByDevice, setSpectrumByDevice] = useState<Record<string, DeviceSpectrumPoint[]>>({});
  const [status, setStatus] = useState("Datacenter console ready");
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [signalAlerts, setSignalAlerts] = useState<SignalAlert[]>([]);
  const performanceProfileEnabled = new URLSearchParams(window.location.search).has("perf");
  const telemetryByDeviceRef = useRef<Record<string, DeviceTelemetryPoint[]>>({});
  const telemetryRetentionByDeviceRef = useRef<Map<string, number>>(new Map());
  const telemetryFetchStateRef = useRef<Map<string, { lastAttemptAt: number; cooldownUntil: number }>>(new Map());
  const telemetryPendingCountRef = useRef<Map<string, number>>(new Map());
  const telemetryRequestSeqRef = useRef<Map<string, number>>(new Map());
  const telemetryRequestAbortRef = useRef<Map<string, AbortController>>(new Map());
  const realtimeTelemetryQueueRef = useRef<Map<string, DeviceTelemetryPoint>>(new Map());
  const realtimeSpectrumQueueRef = useRef<Map<string, { deviceId: string; point: DeviceSpectrumPoint }>>(new Map());
  const realtimeInventoryPatchQueueRef = useRef<Map<string, Partial<DeviceListItem>>>(new Map());
  const realtimeFlushTimerRef = useRef<number | null>(null);
  const documentVisibleRef = useRef(typeof document === "undefined" || !document.hidden);
  const inventoryRequestInFlightRef = useRef(false);
  const inventorySignatureRef = useRef("");
  const toastTimersRef = useRef<Map<number, { auto?: number; remove?: number }>>(new Map());
  const nextToastIdRef = useRef(1);
  const deviceOnlineMapRef = useRef<Map<string, { online: boolean; name: string }>>(new Map());
  const inventoryReadyRef = useRef(false);
  const signalAlertsRef = useRef<SignalAlert[]>([]);
  const dismissedWeakSignalDevicesRef = useRef<Set<string>>(new Set());

  const captureDashboardRender: ProfilerOnRenderCallback = useCallback((
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    const profileWindow = window as Window & {
      __sgpDashboardProfile?: Array<Record<string, number | string>>;
    };
    const entries = profileWindow.__sgpDashboardProfile || [];
    if (entries.length < 2_000) {
      entries.push({ id, phase, actualDuration, baseDuration, startTime, commitTime });
    }
    profileWindow.__sgpDashboardProfile = entries;
  }, []);

  const removeToast = useCallback((toastId: number) => {
    const timerBucket = toastTimersRef.current.get(toastId);
    if (timerBucket?.auto !== undefined) {
      window.clearTimeout(timerBucket.auto);
    }
    if (timerBucket?.remove !== undefined) {
      window.clearTimeout(timerBucket.remove);
    }
    toastTimersRef.current.delete(toastId);
    setToasts((previous) => previous.filter((item) => item.id !== toastId));
  }, []);

  const dismissToast = useCallback((toastId: number) => {
    setToasts((previous) =>
      previous.map((item) => (item.id === toastId ? { ...item, closing: true } : item)),
    );

    const existing = toastTimersRef.current.get(toastId) || {};
    if (existing.auto !== undefined) {
      window.clearTimeout(existing.auto);
      delete existing.auto;
    }
    if (existing.remove !== undefined) {
      window.clearTimeout(existing.remove);
    }
    existing.remove = window.setTimeout(() => {
      removeToast(toastId);
    }, TOAST_EXIT_MS);
    toastTimersRef.current.set(toastId, existing);
  }, [removeToast]);

  const showToast = useCallback((message: Omit<ToastMessage, "id">) => {
    const toastId = nextToastIdRef.current;
    nextToastIdRef.current += 1;

    setToasts((previous) => [...previous, { id: toastId, ...message }]);

    const autoTimeoutId = window.setTimeout(() => {
      dismissToast(toastId);
    }, TOAST_DURATION_MS);
    toastTimersRef.current.set(toastId, { auto: autoTimeoutId });
  }, [dismissToast]);

  const dismissSignalAlert = useCallback((alertId: string) => {
    setSignalAlerts((previous) => {
      const target = previous.find((item) => item.id === alertId);
      if (target) {
        dismissedWeakSignalDevicesRef.current.add(target.deviceId);
      }
      return previous.filter((item) => item.id !== alertId);
    });
  }, []);

  const flushRealtimeUpdates = useCallback(() => {
    realtimeFlushTimerRef.current = null;
    if (!documentVisibleRef.current) {
      return;
    }

    const telemetryUpdates = [...realtimeTelemetryQueueRef.current.entries()];
    const spectrumUpdates = [...realtimeSpectrumQueueRef.current.values()];
    const inventoryPatches = [...realtimeInventoryPatchQueueRef.current.entries()];
    realtimeTelemetryQueueRef.current.clear();
    realtimeSpectrumQueueRef.current.clear();
    realtimeInventoryPatchQueueRef.current.clear();

    if (telemetryUpdates.length > 0) {
      setTelemetryByDevice((previous) => {
        const next = { ...previous };
        for (const [deviceId, point] of telemetryUpdates) {
          const retentionLimit = telemetryRetentionByDeviceRef.current.get(deviceId) || TELEMETRY_OVERVIEW_POINTS;
          next[deviceId] = mergeTelemetryPoints(previous[deviceId] || [], [point], retentionLimit);
        }
        return next;
      });
      setTelemetryLoadingByDevice((previous) => {
        const next = { ...previous };
        let changed = false;
        for (const [deviceId] of telemetryUpdates) {
          if (next[deviceId]) {
            next[deviceId] = false;
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    }

    if (spectrumUpdates.length > 0) {
      setSpectrumByDevice((previous) => {
        const next = { ...previous };
        for (const { deviceId, point } of spectrumUpdates) {
          // A batch normally contains X/Y/Z frames for one device. Merge from
          // the progressively built value so later axes do not replace earlier ones.
          next[deviceId] = mergeSpectrumPoints(next[deviceId] || [], [point]);
        }
        return next;
      });
    }

    if (inventoryPatches.length > 0) {
      const patchesByDeviceId = new Map(inventoryPatches);
      setInventoryDevices((current) => {
        let changed = false;
        const next = current.map((device) => {
          const patch = patchesByDeviceId.get(device.deviceId);
          if (!patch) {
            return device;
          }
          changed = true;
          return {
            ...device,
            ...patch,
            metadata: patch.metadata ? { ...device.metadata, ...patch.metadata } : device.metadata,
          };
        });
        return changed ? next : current;
      });
    }
  }, []);

  const scheduleRealtimeFlush = useCallback(() => {
    if (!documentVisibleRef.current || realtimeFlushTimerRef.current !== null) {
      return;
    }
    realtimeFlushTimerRef.current = window.setTimeout(flushRealtimeUpdates, REALTIME_FLUSH_INTERVAL_MS);
  }, [flushRealtimeUpdates]);

  const enqueueTelemetryPoint = useCallback((deviceId: string, point: DeviceTelemetryPoint) => {
    // The server is the source of truth for history; the dashboard only needs the latest queued sample.
    realtimeTelemetryQueueRef.current.set(deviceId, point);
    scheduleRealtimeFlush();
  }, [scheduleRealtimeFlush]);

  const enqueueSpectrumPoint = useCallback((deviceId: string, point: DeviceSpectrumPoint) => {
    // Store the latest frame per device/axis until the batch flushes, not every incoming FFT frame.
    realtimeSpectrumQueueRef.current.set(`${deviceId}:${point.axis}`, { deviceId, point });
    scheduleRealtimeFlush();
  }, [scheduleRealtimeFlush]);

  const requestTelemetryHistory = useCallback(async (
    deviceId: string,
    options?: TelemetryHistoryRequestOptions,
  ): Promise<void> => {
    const targetDeviceId = safeString(deviceId).trim();
    if (!targetDeviceId) {
      return;
    }

    const requestedLimitValue = asNumber(options?.limit);
    const requestedBucketMsValue = asNumber(options?.bucketMs);
    const bucketMs = typeof requestedBucketMsValue === "number" && requestedBucketMsValue > 0
      ? Math.max(1_000, Math.floor(requestedBucketMsValue))
      : undefined;
    const hasExplicitLimit = typeof requestedLimitValue === "number" && requestedLimitValue > 0;
    const requestedLimit = Math.max(
      1,
      Math.min(
        Math.floor(requestedLimitValue ?? TELEMETRY_CHART_INITIAL_POINTS),
        TELEMETRY_HISTORY_RAW_MAX_POINTS,
      ),
    );
    const from = safeString(options?.from).trim();
    const to = safeString(options?.to).trim();
    const bucketRetentionLimit = getBucketRetentionLimit(bucketMs, from, to);
    const force = options?.force === true;
    const replace = options?.replace === true;

    const now = Date.now();
    const currentFetchState = telemetryFetchStateRef.current.get(targetDeviceId) || {
      lastAttemptAt: 0,
      cooldownUntil: 0,
    };
    if (now < currentFetchState.cooldownUntil) {
      return;
    }
    if (!force && now - currentFetchState.lastAttemptAt < 10_000) {
      return;
    }
    telemetryFetchStateRef.current.set(targetDeviceId, {
      ...currentFetchState,
      lastAttemptAt: now,
    });

    const currentRetention = telemetryRetentionByDeviceRef.current.get(targetDeviceId) || TELEMETRY_OVERVIEW_POINTS;
    const unboundedBucketRequest = Boolean(bucketMs && !hasExplicitLimit);
    const appendDetailRequest = force && !replace;
    const nextRetention = replace
      ? unboundedBucketRequest
        ? bucketRetentionLimit
        : Math.min(TELEMETRY_HISTORY_RAW_MAX_POINTS, Math.max(1, requestedLimit))
      : appendDetailRequest
        ? Math.min(
            TELEMETRY_HISTORY_DETAIL_CACHE_MAX_POINTS,
            Math.max(
              TELEMETRY_CHART_INITIAL_POINTS,
              currentRetention + (unboundedBucketRequest ? bucketRetentionLimit : requestedLimit),
            ),
          )
        : Math.min(
            TELEMETRY_HISTORY_RAW_MAX_POINTS,
            Math.max(TELEMETRY_OVERVIEW_POINTS, currentRetention, requestedLimit),
          );
    telemetryRetentionByDeviceRef.current.set(targetDeviceId, nextRetention);

    const requestSeq = (telemetryRequestSeqRef.current.get(targetDeviceId) || 0) + 1;
    telemetryRequestSeqRef.current.set(targetDeviceId, requestSeq);

    const pendingBefore = telemetryPendingCountRef.current.get(targetDeviceId) || 0;
    telemetryPendingCountRef.current.set(targetDeviceId, pendingBefore + 1);
    setTelemetryLoadingByDevice((previous) => ({ ...previous, [targetDeviceId]: true }));

    const query = new URLSearchParams();
    if (hasExplicitLimit || !bucketMs) {
      query.set("limit", String(requestedLimit));
    }
    if (bucketMs) {
      query.set("bucketMs", String(bucketMs));
    }
    if (from) {
      query.set("from", from);
    }
    if (to) {
      query.set("to", to);
    }

    telemetryRequestAbortRef.current.get(targetDeviceId)?.abort();
    const abortController = new AbortController();
    telemetryRequestAbortRef.current.set(targetDeviceId, abortController);
    const result = await requestJson<unknown>(
      `/api/devices/${encodeURIComponent(targetDeviceId)}/telemetry?${query.toString()}`,
      { signal: abortController.signal },
    );
    try {
      if (!result.ok && result.status === 429) {
        const payloadRecord = asRecord(result.payload);
        const message = safeString(payloadRecord.message);
        const retryMatch = message.match(/retry in (\d+) seconds/i);
        const retrySeconds = retryMatch ? Number(retryMatch[1]) : 30;
        const cooldownMs = Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 30_000;
        telemetryFetchStateRef.current.set(targetDeviceId, {
          lastAttemptAt: Date.now(),
          cooldownUntil: Date.now() + Math.max(10_000, cooldownMs),
        });
        return;
      }
      if (!result.ok || !result.payload) {
        return;
      }
      if (telemetryRequestSeqRef.current.get(targetDeviceId) !== requestSeq) {
        return;
      }

      const points = parseTelemetryHistoryPayload(result.payload);
      if (points.length === 0) {
        return;
      }

      setTelemetryByDevice((previous) => {
        const current = previous[targetDeviceId] || [];
        const retentionLimit =
          telemetryRetentionByDeviceRef.current.get(targetDeviceId) || TELEMETRY_OVERVIEW_POINTS;
        const incomingLatestMs = points.reduce(
          (latest, point) => Math.max(latest, telemetryTimestampMs(point)),
          Number.NEGATIVE_INFINITY,
        );
        const requestedToMs = Date.parse(to);
        const shouldKeepNewerRealtime = replace && (
          !Number.isFinite(requestedToMs) || requestedToMs >= Date.now() - 60_000
        );
        const newerRealtimePoints = shouldKeepNewerRealtime && Number.isFinite(incomingLatestMs)
          ? current.filter((point) => telemetryTimestampMs(point) > incomingLatestMs)
          : [];
        const nextPoints = replace
          ? mergeTelemetryHistory(points, newerRealtimePoints, retentionLimit)
          : mergeTelemetryHistory(current, points, retentionLimit);
        return {
          ...previous,
          [targetDeviceId]: nextPoints,
        };
      });
    } finally {
      const pendingCurrent = telemetryPendingCountRef.current.get(targetDeviceId) || 1;
      const pendingAfter = Math.max(0, pendingCurrent - 1);
      if (pendingAfter === 0) {
        telemetryPendingCountRef.current.delete(targetDeviceId);
        setTelemetryLoadingByDevice((previous) => ({ ...previous, [targetDeviceId]: false }));
      } else {
        telemetryPendingCountRef.current.set(targetDeviceId, pendingAfter);
      }
      if (telemetryRequestAbortRef.current.get(targetDeviceId) === abortController) {
        telemetryRequestAbortRef.current.delete(targetDeviceId);
      }
    }
  }, []);

  const clearDeviceChartData = useCallback((deviceId: string): void => {
    const targetDeviceId = safeString(deviceId).trim();
    if (!targetDeviceId) {
      return;
    }

    telemetryFetchStateRef.current.delete(targetDeviceId);
    telemetryPendingCountRef.current.delete(targetDeviceId);
    telemetryRequestAbortRef.current.get(targetDeviceId)?.abort();
    telemetryRequestAbortRef.current.delete(targetDeviceId);
    telemetryRequestSeqRef.current.set(targetDeviceId, (telemetryRequestSeqRef.current.get(targetDeviceId) || 0) + 1);
    telemetryRetentionByDeviceRef.current.delete(targetDeviceId);
    telemetryByDeviceRef.current = {
      ...telemetryByDeviceRef.current,
      [targetDeviceId]: [],
    };

    setTelemetryLoadingByDevice((previous) => ({
      ...previous,
      [targetDeviceId]: false,
    }));
    setTelemetryByDevice((previous) => ({
      ...previous,
      [targetDeviceId]: [],
    }));
    setSpectrumByDevice((previous) => ({
      ...previous,
      [targetDeviceId]: [],
    }));
  }, []);

  const releaseDeviceChartCache = useCallback((deviceId: string): void => {
    const targetDeviceId = safeString(deviceId).trim();
    if (!targetDeviceId) {
      return;
    }

    telemetryRequestAbortRef.current.get(targetDeviceId)?.abort();
    telemetryRequestAbortRef.current.delete(targetDeviceId);
    telemetryRequestSeqRef.current.set(targetDeviceId, (telemetryRequestSeqRef.current.get(targetDeviceId) || 0) + 1);
    telemetryRetentionByDeviceRef.current.set(targetDeviceId, TELEMETRY_OVERVIEW_POINTS);
    setTelemetryByDevice((previous) => {
      const current = previous[targetDeviceId] || [];
      const nextPoints = current.slice(-TELEMETRY_OVERVIEW_POINTS);
      if (nextPoints.length === current.length) {
        return previous;
      }
      return { ...previous, [targetDeviceId]: nextPoints };
    });
    setSpectrumByDevice((previous) => {
      const current = previous[targetDeviceId] || [];
      const nextPoints = current.slice(-SPECTRUM_OVERVIEW_BUFFER_SIZE);
      if (nextPoints.length === current.length) {
        return previous;
      }
      return { ...previous, [targetDeviceId]: nextPoints };
    });
  }, []);

  const updateInventoryDeviceFromSensor = useCallback((updatedSensor: Sensor): void => {
    setInventoryDevices((current) =>
      current.map((device) => {
        if (device.deviceId !== updatedSensor.id) {
          return device;
        }

        return {
          ...device,
          metadata: {
            ...(device.metadata ?? {}),
            name: updatedSensor.name,
            zone: updatedSensor.zoneCode || undefined,
            axisLabels: updatedSensor.axisLabels,
          },
        };
      }),
    );
  }, []);

  const patchInventoryDevice = useCallback((deviceId: string, patch: Partial<DeviceListItem>): void => {
    if (!deviceId) {
      return;
    }
    const currentPatch = realtimeInventoryPatchQueueRef.current.get(deviceId);
    realtimeInventoryPatchQueueRef.current.set(deviceId, {
      ...currentPatch,
      ...patch,
      metadata: patch.metadata ? { ...currentPatch?.metadata, ...patch.metadata } : currentPatch?.metadata,
    });
    scheduleRealtimeFlush();
  }, [scheduleRealtimeFlush]);

  async function loadDeviceInventory(initialLoad = false): Promise<void> {
    if (inventoryRequestInFlightRef.current || (!initialLoad && document.hidden)) {
      return;
    }
    inventoryRequestInFlightRef.current = true;
    if (initialLoad) {
      setLoadingInventory(true);
    }
    const result = await requestJson<unknown>("/api/devices?limit=500");
    inventoryRequestInFlightRef.current = false;
    if (initialLoad) {
      setLoadingInventory(false);
    }

    if (!result.ok || !result.payload) {
      if (initialLoad) {
        setInventoryDevices([]);
        setStatus("Không tải được danh sách thiết bị");
      }
      return;
    }

    const parsed = parseDevices(result.payload).sort((left, right) =>
      left.deviceId.localeCompare(right.deviceId, "vi"),
    );
    const signature = parsed
      .map((device) => [
        device.deviceId,
        device.online ? "1" : "0",
        device.lastHeartbeatAt || "",
        device.metadata?.name || "",
        device.metadata?.zone || "",
        device.metadata?.firmwareVersion || "",
      ].join("|"))
      .join("\n");
    if (inventorySignatureRef.current === signature) {
      return;
    }
    inventorySignatureRef.current = signature;

    const nextOnlineMap = new Map(
      parsed.map((item) => [item.deviceId, { online: item.online, name: item.metadata?.name?.trim() || item.deviceId }]),
    );
    if (inventoryReadyRef.current) {
      for (const [deviceId, next] of nextOnlineMap.entries()) {
        const previous = deviceOnlineMapRef.current.get(deviceId);
        if (previous === undefined || previous.online === next.online) {
          continue;
        }

        if (next.online) {
          showToast({
            text: `Thiết bị ${next.name} đã kết nối`,
            type: "success",
          });
        } else {
          showToast({
            text: `Thiết bị ${next.name} đã ngắt kết nối`,
            type: "warning",
          });
        }
      }
    }

    const currentAlertsByDevice = new Map(
      signalAlertsRef.current.map((item) => [item.deviceId, item]),
    );
    let nextAlerts = [...signalAlertsRef.current];
    let alertsMutated = false;

    for (const item of parsed) {
      const deviceId = item.deviceId;
      const deviceName = item.metadata?.name?.trim() || deviceId;
      const signal = item.heartbeat?.signal;
      const hasWeakSignal = Boolean(
        item.online &&
        typeof signal === "number" &&
        signal < -85,
      );

      if (!hasWeakSignal) {
        dismissedWeakSignalDevicesRef.current.delete(deviceId);
        continue;
      }

      const existing = currentAlertsByDevice.get(deviceId);
      if (existing) {
        if (existing.signal !== signal || existing.deviceName !== deviceName) {
          nextAlerts = nextAlerts.map((entry) =>
            entry.deviceId === deviceId
              ? { ...entry, signal: signal as number, deviceName }
              : entry,
          );
          currentAlertsByDevice.set(deviceId, {
            ...existing,
            signal: signal as number,
            deviceName,
          });
          alertsMutated = true;
        }
        continue;
      }

      if (dismissedWeakSignalDevicesRef.current.has(deviceId)) {
        continue;
      }

      const nextAlert: SignalAlert = {
        id: `${deviceId}:${Date.now()}`,
        deviceId,
        deviceName,
        signal: signal as number,
        createdAt: new Date().toISOString(),
      };
      nextAlerts = [nextAlert, ...nextAlerts].slice(0, 100);
      currentAlertsByDevice.set(deviceId, nextAlert);
      alertsMutated = true;
      showToast({
        type: "warning",
        title: "Cảnh báo RSSI yếu",
        text: `${deviceName}: ${signal} dBm (< -85 dBm)`,
      });
    }

    if (alertsMutated) {
      setSignalAlerts(nextAlerts);
    }

    deviceOnlineMapRef.current = nextOnlineMap;
    inventoryReadyRef.current = true;

    setInventoryDevices(parsed);
    setStatus(`Đã tải ${parsed.length} thiết bị`);
  }

  useEffect(() => {
    document.title = "SGP Vibration Datacenter";
    void loadDeviceInventory(true);

    const refreshInventory = () => {
      if (!document.hidden) {
        void loadDeviceInventory();
      }
    };
    const refreshTimer = window.setInterval(refreshInventory, INVENTORY_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      documentVisibleRef.current = !document.hidden;
      if (documentVisibleRef.current) {
        flushRealtimeUpdates();
        refreshInventory();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushRealtimeUpdates, showToast]);

  useEffect(() => {
    const socket = io(window.location.origin, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { clientType: "dashboard" },
    });

    socket.on("connect", () => {
      showToast({
        text: "Đã kết nối tới server realtime",
        type: "success",
      });
      void loadDeviceInventory();
    });

    socket.on("disconnect", () => {
      showToast({
        text: "Mất kết nối realtime, đang thử kết nối lại",
        type: "warning",
      });
    });

    socket.on("telemetry", (event: unknown) => {
      const parsed = parseTelemetryEvent(event);
      if (!parsed) {
        return;
      }

      enqueueTelemetryPoint(parsed.deviceId, parsed.point);
    });

    socket.on("telemetry:spectrum", (event: unknown) => {
      const parsed = parseSpectrumEvent(event);
      if (!parsed) {
        return;
      }

      enqueueSpectrumPoint(parsed.deviceId, parsed.point);
    });

    socket.on("device:heartbeat", (event: unknown) => {
      const payload = asRecord(event);
      const deviceId = safeString(payload.deviceId).trim();
      if (!deviceId) {
        return;
      }
      patchInventoryDevice(deviceId, {
        online: true,
        connectedAt: safeString(payload.connectedAt) || undefined,
        lastHeartbeatAt: safeString(payload.lastHeartbeatAt) || new Date().toISOString(),
        heartbeat: asRecord(payload.heartbeat),
      });
    });

    socket.on("device:metadata", (event: unknown) => {
      const payload = asRecord(event);
      const deviceId = safeString(payload.deviceId).trim();
      if (!deviceId) {
        return;
      }
      patchInventoryDevice(deviceId, { metadata: asRecord(payload.metadata) });
    });

    socket.on("device:sensor-status", (event: unknown) => {
      const payload = asRecord(event);
      const deviceId = safeString(payload.deviceId).trim();
      const adxlHealth = parseAdxlHealth(payload);
      if (!deviceId || !adxlHealth) {
        return;
      }
      patchInventoryDevice(deviceId, { metadata: { adxlHealth } });
    });

    return () => {
      socket.disconnect();
    };
  }, [enqueueSpectrumPoint, enqueueTelemetryPoint, patchInventoryDevice, showToast]);

  useEffect(() => {
    return () => {
      if (realtimeFlushTimerRef.current !== null) {
        window.clearTimeout(realtimeFlushTimerRef.current);
      }
      telemetryRequestAbortRef.current.forEach((controller) => controller.abort());
      telemetryRequestAbortRef.current.clear();
      realtimeInventoryPatchQueueRef.current.clear();
      for (const timeoutId of toastTimersRef.current.values()) {
        if (timeoutId.auto !== undefined) {
          window.clearTimeout(timeoutId.auto);
        }
        if (timeoutId.remove !== undefined) {
          window.clearTimeout(timeoutId.remove);
        }
      }
      toastTimersRef.current.clear();
    };
  }, []);

  const sensors = useMemo(() => mapDevicesToSensors(inventoryDevices), [inventoryDevices]);

  useEffect(() => {
    telemetryByDeviceRef.current = telemetryByDevice;
  }, [telemetryByDevice]);

  useEffect(() => {
    signalAlertsRef.current = signalAlerts;
  }, [signalAlerts]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const snapshot = telemetryByDeviceRef.current;
      const deviceIds = Object.keys(snapshot).slice(0, 5);
      if (deviceIds.length === 0) {
        return;
      }

      void Promise.all(
        deviceIds.map(async (deviceId) => {
          const localLatest = (snapshot[deviceId] || []).at(-1);
          if (!localLatest) {
            return;
          }

          const check = await requestJson<unknown>(
            `/api/devices/${encodeURIComponent(deviceId)}/telemetry?limit=1`,
          );
          if (!check.ok || !check.payload) {
            return;
          }

          const dbLatest = parseTelemetryHistoryPayload(check.payload).at(-1);
          if (!dbLatest) {
            return;
          }

          const realtimeKey = telemetryKey(localLatest);
          const dbKey = telemetryKey(dbLatest);
          if (realtimeKey !== dbKey) {
            console.warn(
              `[telemetry:reconcile] mismatch detected for ${deviceId}, syncing latest history`,
              { realtime: localLatest, db: dbLatest },
            );
            await requestTelemetryHistory(deviceId, { limit: TELEMETRY_OVERVIEW_POINTS });
          }
        }),
      );
    }, 120_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [requestTelemetryHistory]);

  return (
    <ThemeProvider>
      {performanceProfileEnabled ? (
        <Profiler id="dashboard" onRender={captureDashboardRender}>
          <DashboardShell
            sensors={sensors}
            telemetryByDevice={telemetryByDevice}
            telemetryLoadingByDevice={telemetryLoadingByDevice}
            spectrumByDevice={spectrumByDevice}
            onRequestTelemetryHistory={requestTelemetryHistory}
            onNotify={showToast}
            onDeviceDataCleared={clearDeviceChartData}
            onChartClosed={releaseDeviceChartCache}
            onSensorUpdated={updateInventoryDeviceFromSensor}
            toasts={toasts}
            onDismissToast={dismissToast}
            signalAlerts={signalAlerts}
          />
        </Profiler>
      ) : (
        <DashboardShell
          sensors={sensors}
          telemetryByDevice={telemetryByDevice}
          telemetryLoadingByDevice={telemetryLoadingByDevice}
          spectrumByDevice={spectrumByDevice}
          onRequestTelemetryHistory={requestTelemetryHistory}
          onNotify={showToast}
          onDeviceDataCleared={clearDeviceChartData}
          onChartClosed={releaseDeviceChartCache}
          onSensorUpdated={updateInventoryDeviceFromSensor}
          toasts={toasts}
          onDismissToast={dismissToast}
          signalAlerts={signalAlerts}
        />
      )}
    </ThemeProvider>
  );
}
