import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ThemeProvider, useTheme } from "./app/context/ThemeContext";
import { TopHeader } from "./app/components/TopHeader";
import { LeftPanel } from "./app/components/LeftPanel";
import { MainPanel } from "./app/components/MainPanel";
import { ToastStack } from "./app/components/ui";
import {
  DeviceListItem,
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
  "Phân tích": "/analytics",
  "Cảm biến": "/sensors",
  "Cài đặt": "/settings",
};

const SIDEBAR_NAV_ORDER = [
  "Tổng quan",
  "Update Center",
  "Quản lý khu vực",
  "Phân tích",
  "Cảm biến",
  "Cài đặt",
] as const;

const PINNED_NAV_STORAGE_KEY = "sgp:pinned-navs:v1";

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
    case "/analytics":
    case "/app/analytics":
      return "Phân tích";
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

const TELEMETRY_VISIBLE_POINTS = 100;
const TELEMETRY_HISTORY_MAX_POINTS = 1000;
const SPECTRUM_HISTORY_BUFFER_SIZE = 120;
const SPECTRUM_FLUSH_INTERVAL_MS = 120;
const TOAST_DURATION_MS = 10_000;
const TOAST_EXIT_MS = 260;

type TelemetryHistoryRequestOptions = {
  limit?: number;
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
    .map((item) => ({
      deviceId: safeString(item.deviceId || item.id || item.device_id),
      online: Boolean(item.online),
      clientIp: safeString(item.clientIp || item.client_ip || item.ipAddress || item.ip_address) || undefined,
      connectedAt: safeString(item.connectedAt || item.connected_at) || undefined,
      lastHeartbeatAt:
        safeString(item.lastHeartbeatAt || item.last_heartbeat_at) || undefined,
      heartbeat: asRecord(item.heartbeat),
      metadata: asRecord(item.metadata),
    }))
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

  const point: DeviceTelemetryPoint = {
    receivedAt: safeString(root.receivedAt || root.timestamp || body.receivedAt || body.timestamp) || new Date().toISOString(),
    available: typeof body.available === "boolean" ? body.available : undefined,
    sampleCount: asNumber(body.sample_count ?? body.sampleCount),
    sampleRateHz: asNumber(body.sample_rate_hz ?? body.sampleRateHz),
    lsbPerG: asNumber(body.lsb_per_g ?? body.lsbPerG),
    temperature: asNumber(body.temperature),
    ax: asNumber(body.ax),
    ay: asNumber(body.ay),
    az: asNumber(body.az),
    uuid: safeString(body.uuid) || undefined,
    telemetryUuid: safeString(body.telemetryUuid || body.telemetry_uuid) || undefined,
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

  return {
    receivedAt,
    available: typeof body.available === "boolean" ? body.available : undefined,
    sampleCount: asNumber(body.sample_count ?? body.sampleCount),
    sampleRateHz: asNumber(body.sample_rate_hz ?? body.sampleRateHz),
    lsbPerG: asNumber(body.lsb_per_g ?? body.lsbPerG),
    temperature: asNumber(body.temperature),
    ax: asNumber(body.ax),
    ay: asNumber(body.ay),
    az: asNumber(body.az),
    uuid: safeString(body.uuid) || undefined,
    telemetryUuid: safeString(body.telemetryUuid || body.telemetry_uuid) || undefined,
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
  return point.telemetryUuid || `${point.receivedAt}|${point.ax ?? ""}|${point.ay ?? ""}|${point.az ?? ""}|${point.temperature ?? ""}`;
}

function mergeTelemetryPoints(
  current: DeviceTelemetryPoint[],
  incoming: DeviceTelemetryPoint[],
  maxPoints = TELEMETRY_VISIBLE_POINTS,
): DeviceTelemetryPoint[] {
  if (incoming.length === 0) {
    return current.slice(-maxPoints);
  }

  const map = new Map<string, DeviceTelemetryPoint>();
  for (const point of current) {
    map.set(telemetryKey(point), point);
  }
  for (const point of incoming) {
    map.set(telemetryKey(point), point);
  }

  return [...map.values()]
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .slice(-maxPoints);
}

function spectrumKey(point: DeviceSpectrumPoint): string {
  return point.telemetryUuid
    ? `${point.telemetryUuid}:${point.axis}`
    : `${point.receivedAt}:${point.axis}:${point.binCount}`;
}

function mergeSpectrumPoints(
  current: DeviceSpectrumPoint[],
  incoming: DeviceSpectrumPoint[],
  maxPoints = SPECTRUM_HISTORY_BUFFER_SIZE,
): DeviceSpectrumPoint[] {
  if (incoming.length === 0) {
    return current.slice(-maxPoints);
  }

  const map = new Map<string, DeviceSpectrumPoint>();
  for (const point of current) {
    map.set(spectrumKey(point), point);
  }
  for (const point of incoming) {
    map.set(spectrumKey(point), point);
  }

  return [...map.values()]
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
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
  toasts: ToastMessage[];
  onDismissToast: (toastId: number) => void;
  signalAlerts: SignalAlert[];
}) {
  const { C, theme } = useTheme();
  const [activeNav, setActiveNav] = useState(() => navFromPathname(window.location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
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

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          style={{
            width: sidebarOpen ? 240 : 0,
            minWidth: sidebarOpen ? 240 : 0,
            overflow: "hidden",
            flexShrink: 0,
            transition:
              "width 0.25s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <LeftPanel
            activeNav={activeNav}
            onNavChange={(label) => navigateToNav(label)}
            navItems={sidebarNavItems}
            pinnedNavItems={pinnedNavLabels}
            onTogglePin={togglePinnedNav}
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
      <Suspense fallback={<div style={{ width: "100vw", height: "100dvh", background: "#000000" }} />}>
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
  const telemetryByDeviceRef = useRef<Record<string, DeviceTelemetryPoint[]>>({});
  const telemetryRetentionByDeviceRef = useRef<Map<string, number>>(new Map());
  const telemetryFetchStateRef = useRef<Map<string, { lastAttemptAt: number; cooldownUntil: number }>>(new Map());
  const telemetryPendingCountRef = useRef<Map<string, number>>(new Map());
  const spectrumPendingByDeviceRef = useRef<Map<string, DeviceSpectrumPoint[]>>(new Map());
  const spectrumFlushTimerRef = useRef<number | null>(null);
  const toastTimersRef = useRef<Map<number, { auto?: number; remove?: number }>>(new Map());
  const nextToastIdRef = useRef(1);
  const deviceOnlineMapRef = useRef<Map<string, { online: boolean; name: string }>>(new Map());
  const inventoryReadyRef = useRef(false);
  const signalAlertsRef = useRef<SignalAlert[]>([]);
  const dismissedWeakSignalDevicesRef = useRef<Set<string>>(new Set());

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

  const flushSpectrumQueue = useCallback(() => {
    spectrumFlushTimerRef.current = null;
    const pendingByDevice = spectrumPendingByDeviceRef.current;
    if (pendingByDevice.size === 0) {
      return;
    }

    const entries = [...pendingByDevice.entries()];
    spectrumPendingByDeviceRef.current = new Map();

    setSpectrumByDevice((previous) => {
      const next = { ...previous };
      for (const [deviceId, pendingPoints] of entries) {
        if (pendingPoints.length === 0) {
          continue;
        }
        const current = next[deviceId] || [];
        next[deviceId] = mergeSpectrumPoints(current, pendingPoints);
      }
      return next;
    });
  }, []);

  const scheduleSpectrumFlush = useCallback(() => {
    if (spectrumFlushTimerRef.current !== null) {
      return;
    }
    spectrumFlushTimerRef.current = window.setTimeout(() => {
      flushSpectrumQueue();
    }, SPECTRUM_FLUSH_INTERVAL_MS);
  }, [flushSpectrumQueue]);

  const enqueueSpectrumPoint = useCallback((deviceId: string, point: DeviceSpectrumPoint) => {
    const queued = spectrumPendingByDeviceRef.current.get(deviceId) || [];
    queued.push(point);
    spectrumPendingByDeviceRef.current.set(deviceId, queued);
    scheduleSpectrumFlush();
  }, [scheduleSpectrumFlush]);

  const requestTelemetryHistory = useCallback(async (
    deviceId: string,
    options?: TelemetryHistoryRequestOptions,
  ): Promise<void> => {
    const targetDeviceId = safeString(deviceId).trim();
    if (!targetDeviceId) {
      return;
    }

    const requestedLimit = Math.max(
      1,
      Math.min(
        Math.floor(asNumber(options?.limit) ?? TELEMETRY_VISIBLE_POINTS),
        1000,
      ),
    );
    const from = safeString(options?.from).trim();
    const to = safeString(options?.to).trim();
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

    const currentRetention = telemetryRetentionByDeviceRef.current.get(targetDeviceId) || TELEMETRY_VISIBLE_POINTS;
    const nextRetention = replace
      ? Math.min(TELEMETRY_HISTORY_MAX_POINTS, Math.max(1, requestedLimit))
      : Math.min(
          TELEMETRY_HISTORY_MAX_POINTS,
          Math.max(TELEMETRY_VISIBLE_POINTS, currentRetention, requestedLimit),
        );
    telemetryRetentionByDeviceRef.current.set(targetDeviceId, nextRetention);

    const pendingBefore = telemetryPendingCountRef.current.get(targetDeviceId) || 0;
    telemetryPendingCountRef.current.set(targetDeviceId, pendingBefore + 1);
    setTelemetryLoadingByDevice((previous) => ({ ...previous, [targetDeviceId]: true }));

    const query = new URLSearchParams();
    query.set("limit", String(requestedLimit));
    if (from) {
      query.set("from", from);
    }
    if (to) {
      query.set("to", to);
    }

    const result = await requestJson<unknown>(
      `/api/devices/${encodeURIComponent(targetDeviceId)}/telemetry?${query.toString()}`,
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

      const points = parseTelemetryHistoryPayload(result.payload);
      if (points.length === 0) {
        return;
      }

      setTelemetryByDevice((previous) => {
        const current = previous[targetDeviceId] || [];
        const retentionLimit =
          telemetryRetentionByDeviceRef.current.get(targetDeviceId) || TELEMETRY_VISIBLE_POINTS;
        const nextPoints = replace
          ? points.slice(-retentionLimit)
          : mergeTelemetryPoints(current, points, retentionLimit);
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
    }
  }, []);

  const clearDeviceChartData = useCallback((deviceId: string): void => {
    const targetDeviceId = safeString(deviceId).trim();
    if (!targetDeviceId) {
      return;
    }

    telemetryFetchStateRef.current.delete(targetDeviceId);
    telemetryPendingCountRef.current.delete(targetDeviceId);
    telemetryRetentionByDeviceRef.current.delete(targetDeviceId);
    spectrumPendingByDeviceRef.current.delete(targetDeviceId);
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

  async function loadDeviceInventory(): Promise<void> {
    setLoadingInventory(true);
    const result = await requestJson<unknown>("/api/devices?limit=500");
    setLoadingInventory(false);

    if (!result.ok || !result.payload) {
      setInventoryDevices([]);
      setStatus("Không tải được danh sách thiết bị");
      return;
    }

    const parsed = parseDevices(result.payload).sort((left, right) =>
      left.deviceId.localeCompare(right.deviceId, "vi"),
    );

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
    void loadDeviceInventory();

    const refreshInventory = window.setInterval(() => {
      void loadDeviceInventory();
    }, 5000);

    return () => {
      window.clearInterval(refreshInventory);
    };
  }, [showToast]);

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

      setTelemetryByDevice((previous) => {
        const current = previous[parsed.deviceId] || [];
        const retentionLimit =
          telemetryRetentionByDeviceRef.current.get(parsed.deviceId) || TELEMETRY_VISIBLE_POINTS;
        const next = mergeTelemetryPoints(current, [parsed.point], retentionLimit);
        return {
          ...previous,
          [parsed.deviceId]: next,
        };
      });
    });

    socket.on("telemetry:spectrum", (event: unknown) => {
      const parsed = parseSpectrumEvent(event);
      if (!parsed) {
        return;
      }

      enqueueSpectrumPoint(parsed.deviceId, parsed.point);
    });

    return () => {
      flushSpectrumQueue();
      socket.disconnect();
    };
  }, [enqueueSpectrumPoint, flushSpectrumQueue, showToast]);

  useEffect(() => {
    return () => {
      if (spectrumFlushTimerRef.current !== null) {
        window.clearTimeout(spectrumFlushTimerRef.current);
        spectrumFlushTimerRef.current = null;
      }
      spectrumPendingByDeviceRef.current.clear();

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
            await requestTelemetryHistory(deviceId, { limit: TELEMETRY_VISIBLE_POINTS });
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
      <DashboardShell
        sensors={sensors}
        telemetryByDevice={telemetryByDevice}
        telemetryLoadingByDevice={telemetryLoadingByDevice}
        spectrumByDevice={spectrumByDevice}
        onRequestTelemetryHistory={requestTelemetryHistory}
        onNotify={showToast}
        onDeviceDataCleared={clearDeviceChartData}
        toasts={toasts}
        onDismissToast={dismissToast}
        signalAlerts={signalAlerts}
      />
    </ThemeProvider>
  );
}
