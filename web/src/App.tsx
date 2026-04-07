import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ThemeProvider, useTheme } from "./app/context/ThemeContext";
import { TopHeader } from "./app/components/TopHeader";
import { LeftPanel } from "./app/components/LeftPanel";
import { MainPanel } from "./app/components/MainPanel";
import { DeviceListItem, DeviceTelemetryPoint, mapDevicesToSensors, Sensor } from "./app/data/sensors";
import { ThreeDPage } from "./app/components/ThreeDPage";

type ApiResult<T> = {
  ok: boolean;
  status: number;
  payload: T | null;
};

const TELEMETRY_VISIBLE_POINTS = 100;
const TELEMETRY_HISTORY_BUFFER_SIZE = 400;
const TOAST_DURATION_MS = 5000;
const TOAST_EXIT_MS = 260;

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
  maxPoints = TELEMETRY_HISTORY_BUFFER_SIZE,
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
  onRequestTelemetryHistory,
  toasts,
  onDismissToast,
  signalAlerts,
  onDismissSignalAlert,
}: {
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
  onRequestTelemetryHistory: (deviceId: string, limit?: number) => Promise<void>;
  toasts: ToastMessage[];
  onDismissToast: (toastId: number) => void;
  signalAlerts: SignalAlert[];
  onDismissSignalAlert: (alertId: string) => void;
}) {
  const { C, theme } = useTheme();
  const [activeNav, setActiveNav] = useState("Tổng quan");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: C.bg,
        fontFamily: "'Inter', 'system-ui', sans-serif",
        transition: "background 0.25s",
        colorScheme: theme,
      }}
    >
      <TopHeader
        activeNav={activeNav}
        onNavChange={setActiveNav}
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
          <LeftPanel sensors={sensors} signalAlerts={signalAlerts} onDismissSignalAlert={onDismissSignalAlert} />
        </div>

        <MainPanel
          activeNav={activeNav}
          sensors={sensors}
          telemetryByDevice={telemetryByDevice}
          telemetryLoadingByDevice={telemetryLoadingByDevice}
          onRequestTelemetryHistory={onRequestTelemetryHistory}
        />
      </div>
      <div className="dc-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`dc-toast dc-toast--${toast.type}${toast.closing ? " is-leaving" : ""}`} role="status">
            <div className={`dc-toast__icon dc-toast__icon--${toast.type}`} aria-hidden="true">
              {toast.type === "success" ? "✓" : "!"}
            </div>
            <div className="dc-toast__body">
              <div className="dc-toast__title">{toast.title || (toast.type === "success" ? "Thiết bị kết nối" : "Thiết bị ngắt kết nối")}</div>
              <div className="dc-toast__content">{toast.text}</div>
            </div>
            <button
              type="button"
              className="dc-toast__close"
              onClick={() => onDismissToast(toast.id)}
              aria-label="Đóng thông báo"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const pathname = window.location.pathname;
  if (pathname === "/threed" || pathname === "/app/threed") {
    return <ThreeDPage />;
  }

  const [inventoryDevices, setInventoryDevices] = useState<DeviceListItem[]>([]);
  const [telemetryByDevice, setTelemetryByDevice] = useState<Record<string, DeviceTelemetryPoint[]>>({});
  const [telemetryLoadingByDevice, setTelemetryLoadingByDevice] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("Datacenter console ready");
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [signalAlerts, setSignalAlerts] = useState<SignalAlert[]>([]);
  const telemetryByDeviceRef = useRef<Record<string, DeviceTelemetryPoint[]>>({});
  const telemetryFetchStateRef = useRef<Map<string, { lastAttemptAt: number; cooldownUntil: number }>>(new Map());
  const telemetryPendingCountRef = useRef<Map<string, number>>(new Map());
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

    setToasts((previous) => [...previous.slice(-5), { id: toastId, ...message }]);

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

  const requestTelemetryHistory = useCallback(async (deviceId: string, limit = TELEMETRY_HISTORY_BUFFER_SIZE): Promise<void> => {
    const targetDeviceId = safeString(deviceId).trim();
    if (!targetDeviceId) {
      return;
    }

    const now = Date.now();
    const currentFetchState = telemetryFetchStateRef.current.get(targetDeviceId) || {
      lastAttemptAt: 0,
      cooldownUntil: 0,
    };
    if (now < currentFetchState.cooldownUntil) {
      return;
    }
    if (now - currentFetchState.lastAttemptAt < 10_000) {
      return;
    }
    telemetryFetchStateRef.current.set(targetDeviceId, {
      ...currentFetchState,
      lastAttemptAt: now,
    });

    const pendingBefore = telemetryPendingCountRef.current.get(targetDeviceId) || 0;
    telemetryPendingCountRef.current.set(targetDeviceId, pendingBefore + 1);
    setTelemetryLoadingByDevice((previous) => ({ ...previous, [targetDeviceId]: true }));

    const result = await requestJson<unknown>(
      `/api/devices/${encodeURIComponent(targetDeviceId)}/telemetry?limit=${Math.max(1, Math.min(limit, 1000))}`,
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
        return {
          ...previous,
          [targetDeviceId]: mergeTelemetryPoints(current, points),
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
        const next = mergeTelemetryPoints(current, [parsed.point]);
        return {
          ...previous,
          [parsed.deviceId]: next,
        };
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [showToast]);

  useEffect(() => {
    return () => {
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
            await requestTelemetryHistory(deviceId, TELEMETRY_VISIBLE_POINTS);
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
        onRequestTelemetryHistory={requestTelemetryHistory}
        toasts={toasts}
        onDismissToast={dismissToast}
        signalAlerts={signalAlerts}
        onDismissSignalAlert={dismissSignalAlert}
      />
    </ThemeProvider>
  );
}
