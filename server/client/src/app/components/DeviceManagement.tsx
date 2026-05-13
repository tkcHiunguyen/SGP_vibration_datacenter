import React, { lazy, Suspense, useState, useMemo, useEffect, useRef } from "react";
import {
  Info, Search, AlertTriangle,
  Wifi, WifiOff, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, GripVertical,
  Activity, Layers, MapPin, ArrowUpAZ, Hash, CircleDot, Filter, Globe, X, ExternalLink, PencilLine, Trash2,
} from "lucide-react";
import { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { ConsoleStatCard, type ToastItem } from "./ui";
import { useTheme } from "../context/ThemeContext";
import {
  buildDeviceTelemetryCardReadout,
  DEFAULT_DEVICE_SORT,
  getLatestDeviceTelemetryPoint,
  type DeviceSortKey,
} from "./device-display";

const loadDeviceInfoModal = () =>
  import("./DeviceInfoModal").then((module) => ({
    default: module.DeviceInfoModal,
  }));

const loadSensorChartModal = () =>
  import("./SensorChartModal").then((module) => ({
    default: module.SensorChartModal,
  }));

const DeviceInfoModal = lazy(loadDeviceInfoModal);
const SensorChartModal = lazy(loadSensorChartModal);

function splitTelemetryValue(value: string): { amount: string; unit: string } {
  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue === "--") {
    return { amount: "--", unit: "" };
  }

  const valueParts = normalizedValue.match(/^(-?\d+(?:\.\d+)?)(.*)$/);

  if (!valueParts) {
    return { amount: normalizedValue, unit: "" };
  }

  return { amount: valueParts[1], unit: valueParts[2].trim() };
}

function TelemetryValue({
  value,
  color,
  mutedColor,
  fontSize,
  unitSize,
  justify = "flex-start",
}: {
  value: string;
  color: string;
  mutedColor: string;
  fontSize: string;
  unitSize: string;
  justify?: "flex-start" | "center" | "flex-end";
}) {
  const { amount, unit } = splitTelemetryValue(value);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        justifyContent: justify,
        gap: 1,
        minWidth: 0,
        flexShrink: 0,
        color,
        fontSize,
        fontWeight: 900,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.025em",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span>{amount}</span>
      {unit && <span style={{ color: mutedColor, fontSize: unitSize, fontWeight: 850, letterSpacing: "0" }}>{unit}</span>}
    </span>
  );
}

/* ── Device Card ── */
function DeviceCard({
  sensor,
  idx,
  onInfo,
  onChart,
  onOpenWeb,
  onContextMenu,
  onPrepareInfo,
  onPrepareChart,
  telemetryPoint,
  showAxisReadout,
  exiting,
}: {
  sensor: Sensor;
  idx: number;
  onInfo: (s: Sensor) => void;
  onChart: (s: Sensor) => void;
  onOpenWeb: (s: Sensor) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, sensor: Sensor) => void;
  onPrepareInfo?: () => void;
  onPrepareChart?: () => void;
  telemetryPoint?: DeviceTelemetryPoint | null;
  showAxisReadout: boolean;
  exiting?: boolean;
}) {
  const { C } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [infoHovered, setInfoHovered] = useState(false);
  const [webHovered, setWebHovered] = useState(false);
  const isOnline   = sensor.online;
  const isAbnormal = sensor.status === "abnormal";
  const accentColor = !isOnline ? "#4b5563" : isAbnormal ? C.danger : C.success;
  const hasWebTarget = sensor.ipAddress !== "N/A" && sensor.ipAddress.trim() !== "";
  const telemetryReadout = buildDeviceTelemetryCardReadout(telemetryPoint, sensor.axisLabels);
  const cardAnimation = exiting
    ? "cardOut 260ms cubic-bezier(0.22, 0.78, 0.3, 1) both"
    : "cardIn 0.3s ease both";

  return (
    <div
      data-ux="device-card"
      data-device-id={sensor.id}
      data-device-name={sensor.name}
      data-device-online={sensor.online ? "true" : "false"}
      style={{
        background: C.card,
        border: `1px solid ${hovered ? accentColor + "55" : C.cardBorder}`,
        position: "relative",
        borderRadius: 10, overflow: "hidden",
        transition: "border-color 0.2s, box-shadow 0.2s, transform 0.15s, opacity 0.2s",
        boxShadow: hovered && !exiting ? `0 4px 14px ${accentColor}16` : "none",
        transform: hovered && !exiting ? "translateY(-2px)" : "translateY(0)",
        cursor: "pointer",
        animation: cardAnimation,
        animationDelay: exiting ? "0s" : `${Math.min(idx * 0.04, 0.4)}s`,
        display: "flex", flexDirection: "column",
        minWidth: 0,
        pointerEvents: exiting ? "none" : "auto",
      }}
      onMouseEnter={() => {
        if (!exiting) {
          setHovered(true);
          onPrepareChart?.();
        }
      }}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!exiting) {
          onChart(sensor);
        }
      }}
      onContextMenu={(event) => onContextMenu(event, sensor)}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: accentColor,
          opacity: isOnline ? 0.82 : 0.3,
          boxShadow: isOnline ? `0 0 10px ${accentColor}66` : "none",
          animation: isOnline && isAbnormal ? "stripPulse 2s ease-in-out infinite" : "none",
        }}
      />

      <div style={{ padding: "5px 10px 6px 10px", display: "flex", flexDirection: "column", flex: 1, gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5, minWidth: 0 }}>
          <div
            title={sensor.name}
            style={{
              color: C.textBright,
              fontSize: "0.72rem",
              fontWeight: 750,
              lineHeight: 1,
              flex: "1 1 auto",
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {sensor.name}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
            <button
              onClick={(e) => { e.stopPropagation(); onInfo(sensor); }}
              title="Thuộc tính thiết bị"
              onMouseEnter={() => {
                setInfoHovered(true);
                onPrepareInfo?.();
              }}
              onMouseLeave={() => setInfoHovered(false)}
              style={{
                width: 20,
                height: 20,
                padding: 0,
                lineHeight: 0,
                borderRadius: 5,
                background: infoHovered ? C.surface : "transparent",
                border: `1px solid ${infoHovered ? C.border : "transparent"}`,
                cursor: "pointer",
                transition: "all 0.12s",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Info size={11} color={infoHovered ? C.primary : C.textMuted} strokeWidth={2} />
            </button>
            <div
              style={{
                position: "absolute",
                right: "calc(100% + 5px)",
                top: "50%",
                pointerEvents: "none",
                opacity: infoHovered ? 1 : 0,
                transform: infoHovered
                  ? "translateY(-50%) translateX(0)"
                  : "translateY(-50%) translateX(2px)",
                transition: "opacity 0.14s ease, transform 0.14s ease",
                background: C.surface,
                border: `1px solid ${C.border}`,
                color: C.textBase,
                fontSize: "0.58rem",
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 6,
                whiteSpace: "nowrap",
                zIndex: 5,
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              }}
            >
              Thông tin
            </div>
            </div>
            <div style={{ position: "relative" }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasWebTarget) {
                    onOpenWeb(sensor);
                  }
                }}
                title={hasWebTarget ? "Truy cập thiết bị" : "Thiết bị chưa có IP"}
                onMouseEnter={() => setWebHovered(true)}
                onMouseLeave={() => setWebHovered(false)}
                disabled={!hasWebTarget}
                style={{
                  width: 20,
                  height: 20,
                  padding: 0,
                  lineHeight: 0,
                  borderRadius: 5,
                  border: `1px solid ${hasWebTarget && webHovered ? C.border : "transparent"}`,
                  background: hasWebTarget && webHovered ? C.surface : "transparent",
                  color: hasWebTarget && webHovered ? C.primary : hasWebTarget ? C.textMuted : C.textDim,
                  cursor: hasWebTarget ? "pointer" : "not-allowed",
                  transition: "all 0.12s",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Globe size={11} strokeWidth={2} />
              </button>
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 5px)",
                  transform: webHovered ? "translateY(0)" : "translateY(2px)",
                  opacity: webHovered ? 1 : 0,
                  pointerEvents: "none",
                  transition: "opacity 0.14s ease, transform 0.14s ease",
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  color: C.textBase,
                  fontSize: "0.58rem",
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                  zIndex: 5,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                }}
              >
                {hasWebTarget ? "Truy cập thiết bị" : "Thiết bị chưa có IP"}
              </div>
            </div>
          </div>
        </div>

        <div
          aria-label="Giá trị telemetry hiện tại"
          style={{
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: showAxisReadout
                ? "minmax(38px, 0.44fr) minmax(78px, 1fr)"
                : "minmax(0, 1fr)",
              gap: 5,
              minWidth: 0,
              alignItems: "center",
            }}
          >
            <div
              title={`Temperature ${telemetryReadout.temperature.value || "--"}`}
              style={{
                minWidth: 0,
                display: "grid",
                alignContent: "center",
                gap: 3,
              }}
            >
              <span style={{ color: C.warning, fontSize: "0.4rem", fontWeight: 900, letterSpacing: "0.09em", lineHeight: 1 }}>
                TEMP
              </span>
              <TelemetryValue
                value={telemetryReadout.temperature.value || "--"}
                color={telemetryReadout.temperature.value ? C.textBright : C.textDim}
                mutedColor={C.warning}
                fontSize="0.76rem"
                unitSize="0.46rem"
              />
            </div>

            {showAxisReadout ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: 2,
                  minWidth: 0,
                }}
              >
                {telemetryReadout.axes.map((item, itemIndex) => (
                  <div
                    key={`${item.label}-${itemIndex}`}
                    title={`${item.label} ${item.value || "--"}`.trim()}
                    style={{
                      minWidth: 0,
                      display: "grid",
                      gridTemplateColumns: "max-content max-content",
                      alignItems: "baseline",
                      justifyContent: "end",
                      columnGap: 2,
                      lineHeight: 1,
                    }}
                  >
                    <span
                      style={{
                        color: C.textMuted,
                        fontSize: "0.42rem",
                        fontWeight: 850,
                        letterSpacing: "0.02em",
                        lineHeight: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "clip",
                        textAlign: "right",
                      }}
                    >
                      {item.label}
                    </span>
                    <TelemetryValue
                      value={item.value || "--"}
                      color={item.value ? C.textBright : C.textDim}
                      mutedColor={C.textMuted}
                      fontSize="0.6rem"
                      unitSize="0.34rem"
                      justify="flex-end"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

    </div>
  );
}

/* ── Sort dropdown ── */
type SortKey = DeviceSortKey;
const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: "status",    label: "Trạng thái",   icon: <CircleDot size={11} strokeWidth={2} /> },
  { key: "zone",      label: "Khu vực",      icon: <MapPin size={11} strokeWidth={2} /> },
  { key: "name-az",   label: "Tên (A-Z)",    icon: <ArrowUpAZ size={11} strokeWidth={2} /> },
  { key: "device-id", label: "Mã thiết bị",  icon: <Hash size={11} strokeWidth={2} /> },
];

function SortDropdown({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find(o => o.key === value)!;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          height: 30, padding: "0 10px", borderRadius: 8,
          background: "transparent", border: "none",
          color: C.textBase, fontSize: "0.78rem", fontWeight: 600,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
          transition: "color 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: C.primary, display: "inline-flex", alignItems: "center" }}>
          {current.icon}
        </span>
        {current.label}
        <ChevronDown size={10} color={C.textMuted} strokeWidth={2}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20,
            background: C.card, border: `1px solid ${C.cardBorder}`,
            borderRadius: 10, overflow: "hidden", minWidth: 175,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            animation: "dropIn 0.15s ease",
          }}>
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => { onChange(opt.key); setOpen(false); }}
                style={{
                  width: "100%", padding: "8px 12px", textAlign: "left",
                  background: value === opt.key ? C.primaryBg : "transparent",
                  color: value === opt.key ? C.primary : C.textBase,
                  fontSize: "0.73rem", fontWeight: value === opt.key ? 600 : 400,
                  border: "none", cursor: "pointer",
                  borderLeft: value === opt.key ? `2px solid ${C.primary}` : "2px solid transparent",
                  transition: "background 0.1s",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={e => { if (value !== opt.key) (e.currentTarget as HTMLElement).style.background = C.surface; }}
                onMouseLeave={e => { if (value !== opt.key) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{ display: "inline-flex", color: value === opt.key ? C.primary : C.textMuted }}>
                  {opt.icon}
                </span>
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const UNASSIGNED_ZONE_LABEL = "Chưa gán";

type ZoneDeviceGroup = {
  key: string;
  label: string;
  devices: Sensor[];
  total: number;
  online: number;
  abnormal: number;
};

function normalizeZoneLabel(value?: string): string {
  const trimmed = value?.trim() || "";
  return trimmed && trimmed !== "--" ? trimmed : "";
}

function getSensorZoneLabel(sensor: Sensor): string {
  return normalizeZoneLabel(sensor.zoneCode) || normalizeZoneLabel(sensor.zone) || UNASSIGNED_ZONE_LABEL;
}

function getSensorZoneKey(sensor: Sensor): string {
  return getSensorZoneLabel(sensor).toLocaleLowerCase("vi-VN");
}

function groupSensorsByZone(sensors: Sensor[]): ZoneDeviceGroup[] {
  const groups = new Map<string, ZoneDeviceGroup>();

  sensors.forEach((sensor) => {
    const label = getSensorZoneLabel(sensor);
    const key = getSensorZoneKey(sensor);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        devices: [],
        total: 0,
        online: 0,
        abnormal: 0,
      });
    }

    const group = groups.get(key)!;
    group.devices.push(sensor);
    group.total += 1;
    if (sensor.online) {
      group.online += 1;
    }
    if (sensor.status === "abnormal") {
      group.abnormal += 1;
    }
  });

  return Array.from(groups.values());
}

function DeviceWebModal({ sensor, onClose }: { sensor: Sensor | null; onClose: () => void }) {
  const { C } = useTheme();
  const [mountFrame, setMountFrame] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  const sensorId = sensor?.id ?? "";
  const hasWebTarget = Boolean(sensor && sensor.ipAddress !== "N/A" && sensor.ipAddress.trim() !== "");
  const webUrl = sensor ? `/api/devices/${encodeURIComponent(sensor.id)}/ui-proxy/` : "";

  useEffect(() => {
    setMountFrame(false);
    setFrameLoaded(false);
    if (!hasWebTarget) {
      return;
    }

    const raf = window.requestAnimationFrame(() => {
      setMountFrame(true);
    });

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [sensorId, webUrl, hasWebTarget]);

  if (!sensor) {
    return null;
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          background: "rgba(0,0,0,0.55)",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(96vw, 1100px)",
          height: "min(86vh, 760px)",
          zIndex: 71,
          borderRadius: 12,
          border: `1px solid ${C.cardBorder}`,
          background: C.card,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 44,
            padding: "0 12px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: C.surface,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Globe size={14} color={C.primary} strokeWidth={2} />
            <span style={{ color: C.textBright, fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Truy cập thiết bị · {sensor.name}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {hasWebTarget && (
              <a
                href={webUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: C.primary,
                  fontSize: "0.72rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  textDecoration: "none",
                  border: `1px solid ${C.cardBorder}`,
                  borderRadius: 8,
                  padding: "4px 8px",
                  background: C.card,
                }}
              >
                Mở tab mới
                <ExternalLink size={11} strokeWidth={2} />
              </a>
            )}
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: `1px solid ${C.cardBorder}`,
                background: C.card,
                color: C.textBase,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, background: C.bg }}>
          {hasWebTarget && mountFrame ? (
            <div style={{ width: "100%", height: "100%", position: "relative" }}>
              {!frameLoaded && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    color: C.textMuted,
                    fontSize: "0.8rem",
                    background: C.bg,
                    zIndex: 1,
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      border: `2px solid ${C.border}`,
                      borderTopColor: C.primary,
                      animation: "webSpin 0.8s linear infinite",
                    }}
                  />
                  <div
                    style={{
                      width: 220,
                      height: 7,
                      borderRadius: 999,
                      background: `linear-gradient(90deg, ${C.surface} 0%, ${C.card} 35%, ${C.surface} 70%)`,
                      backgroundSize: "200% 100%",
                      animation: "webLoadShimmer 1.2s ease-in-out infinite",
                    }}
                  />
                  <div>Đang kết nối tới giao diện thiết bị...</div>
                </div>
              )}
              <iframe
                src={webUrl}
                title={`Device Web ${sensor.id}`}
                loading="eager"
                onLoad={() => setFrameLoaded(true)}
                style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
              />
            </div>
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.8rem" }}>
              {hasWebTarget ? "Đang chuẩn bị kết nối..." : "Không có địa chỉ IP để truy cập thiết bị."}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Main Component ── */
type FilterKey = "all" | "online" | "offline" | "abnormal";
type DeviceInfoMode = "view" | "edit" | "delete";

type DeviceContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  sensor: Sensor | null;
};

type DeviceContextMenuItem = "info" | "edit" | "delete";
type TelemetryHistoryRequestOptions = {
  limit?: number;
  from?: string;
  to?: string;
  force?: boolean;
  replace?: boolean;
};

interface DeviceManagementProps {
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
  spectrumByDevice: Record<string, DeviceSpectrumPoint[]>;
  onRequestTelemetryHistory: (deviceId: string, options?: TelemetryHistoryRequestOptions) => Promise<void>;
  onNotify: (message: Omit<ToastItem, "id">) => void;
  onDeviceDataCleared: (deviceId: string) => void;
  onSensorUpdated?: (sensor: Sensor) => void;
}

const STORAGE_PAGE_KEY = "sgp_ui_devices_page";
const STORAGE_PAGE_SIZE_KEY = "sgp_ui_devices_page_size";
const STORAGE_CHART_SIDEBAR_WIDTH_KEY = "sgp_ui_chart_sidebar_width";
const DEVICE_CARD_EXIT_MS = 260;
const DATA_VIEW_PREFETCH_TIMEOUT_MS = 2500;
const CHART_SIDEBAR_MIN_WIDTH_PX = 460;
const CHART_SIDEBAR_DEFAULT_WIDTH_PX = 860;
const CHART_SIDEBAR_MAX_WIDTH_PX = 1600;
const CHART_SIDEBAR_MAX_VIEWPORT_RATIO = 0.8;
const CHART_SIDEBAR_MEDIUM_VIEWPORT_RATIO = 0.72;
const CHART_SIDEBAR_MIN_MAIN_AREA_PX = 260;
const CHART_SIDEBAR_MEDIUM_MIN_MAIN_AREA_PX = 300;
const CHART_SIDEBAR_STACKED_BREAKPOINT_PX = 900;
const CHART_SIDEBAR_CONTENT_GAP_PX = 12;

function getChartSidebarMinWidth(viewportWidth: number): number {
  if (viewportWidth < 1200) {
    return 360;
  }
  return CHART_SIDEBAR_MIN_WIDTH_PX;
}

function getChartSidebarMaxWidth(viewportWidth: number): number {
  const minWidth = getChartSidebarMinWidth(viewportWidth);
  const viewportRatio = viewportWidth < 1400 ? CHART_SIDEBAR_MEDIUM_VIEWPORT_RATIO : CHART_SIDEBAR_MAX_VIEWPORT_RATIO;
  const minMainArea = viewportWidth < 1400 ? CHART_SIDEBAR_MEDIUM_MIN_MAIN_AREA_PX : CHART_SIDEBAR_MIN_MAIN_AREA_PX;
  const ratioMax = Math.floor(viewportWidth * viewportRatio);
  const byMainArea = Math.floor(viewportWidth - minMainArea);
  const bounded = Math.min(CHART_SIDEBAR_MAX_WIDTH_PX, ratioMax, byMainArea);
  return Math.max(minWidth, bounded);
}

function clampChartSidebarWidth(width: number, viewportWidth: number): number {
  const minWidth = getChartSidebarMinWidth(viewportWidth);
  const maxWidth = getChartSidebarMaxWidth(viewportWidth);
  const normalized = Number.isFinite(width) ? Math.round(width) : CHART_SIDEBAR_DEFAULT_WIDTH_PX;
  return Math.max(minWidth, Math.min(maxWidth, normalized));
}

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function DeviceManagement({
  sensors,
  telemetryByDevice,
  telemetryLoadingByDevice,
  spectrumByDevice,
  onRequestTelemetryHistory,
  onNotify,
  onDeviceDataCleared,
  onSensorUpdated,
}: DeviceManagementProps) {
  const { C } = useTheme();
  const layoutHostRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  const [layoutHostWidth, setLayoutHostWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const [selectedSensorMode, setSelectedSensorMode] = useState<DeviceInfoMode>("view");
  const [chartSensor, setChartSensor] = useState<Sensor | null>(null);
  const [chartSidebarDismissed, setChartSidebarDismissed] = useState(false);
  const [chartSidebarWidthPx, setChartSidebarWidthPx] = useState(() => {
    const initialViewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const storedWidth = readStoredNumber(STORAGE_CHART_SIDEBAR_WIDTH_KEY, CHART_SIDEBAR_DEFAULT_WIDTH_PX);
    return clampChartSidebarWidth(storedWidth, initialViewportWidth);
  });
  const [chartSidebarResizing, setChartSidebarResizing] = useState(false);
  const [webSensor, setWebSensor] = useState<Sensor | null>(null);
  const [contextMenu, setContextMenu] = useState<DeviceContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    sensor: null,
  });
  const [contextHoveredItem, setContextHoveredItem] = useState<DeviceContextMenuItem | null>(null);
  const [exitingDeviceIds, setExitingDeviceIds] = useState<Set<string>>(() => new Set());
  const [hiddenDeviceIds, setHiddenDeviceIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort]     = useState<SortKey>(DEFAULT_DEVICE_SORT);
  const [sortIconHovered, setSortIconHovered] = useState(false);
  const [page, setPage] = useState(() => readStoredNumber(STORAGE_PAGE_KEY, 1));
  const [pageSize, setPageSize] = useState(() => {
    const stored = readStoredNumber(STORAGE_PAGE_SIZE_KEY, 20);
    return [10, 20, 50, 100, 200].includes(stored) ? stored : 20;
  });
  const [pageInput, setPageInput] = useState(() => String(readStoredNumber(STORAGE_PAGE_KEY, 1)));
  const didMountRef = useRef(false);
  const exitTimeoutsRef = useRef<Record<string, number>>({});
  const cardTelemetryPrefetchRef = useRef<Set<string>>(new Set());
  const cardTelemetryPrefetchTimeoutsRef = useRef<Set<number>>(new Set());
  const chartSidebarResizeRef = useRef({
    active: false,
    startX: 0,
    startWidth: CHART_SIDEBAR_DEFAULT_WIDTH_PX,
  });

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleId: number | null = null;
    let timeoutId: number | null = null;

    const preloadDataView = () => {
      void loadSensorChartModal();
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleId = idleWindow.requestIdleCallback(preloadDataView, {
        timeout: DATA_VIEW_PREFETCH_TIMEOUT_MS,
      });
    } else {
      timeoutId = window.setTimeout(preloadDataView, 900);
    }

    return () => {
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    const handleResize = (): void => {
      const nextViewportWidth = window.innerWidth;
      setViewportWidth(nextViewportWidth);
      setChartSidebarWidthPx((prev) => clampChartSidebarWidth(prev, nextViewportWidth));
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const node = layoutHostRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      setLayoutHostWidth(Math.max(0, Math.round(node.getBoundingClientRect().width)));
    };

    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
      const state = chartSidebarResizeRef.current;
      if (!state.active) {
        return;
      }
      const delta = state.startX - event.clientX;
      const nextWidth = clampChartSidebarWidth(state.startWidth + delta, window.innerWidth);
      setChartSidebarWidthPx(nextWidth);
    };

    const stopResize = (): void => {
      const state = chartSidebarResizeRef.current;
      if (!state.active) {
        return;
      }
      state.active = false;
      setChartSidebarResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
    window.addEventListener("mouseleave", stopResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      window.removeEventListener("mouseleave", stopResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const visibleSensors = useMemo(
    () => sensors.filter((sensor) => !hiddenDeviceIds.has(sensor.id)),
    [sensors, hiddenDeviceIds],
  );

  const latestTelemetryByDevice = useMemo(() => {
    const next: Record<string, DeviceTelemetryPoint | null> = {};
    for (const [deviceId, points] of Object.entries(telemetryByDevice)) {
      next[deviceId] = getLatestDeviceTelemetryPoint(points);
    }
    return next;
  }, [telemetryByDevice]);

  const total    = visibleSensors.length;
  const online   = visibleSensors.filter(s => s.online).length;
  const offline  = visibleSensors.filter(s => !s.online).length;
  const abnormal = visibleSensors.filter(s => s.status === "abnormal").length;

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: "all",      label: "Tất cả thiết bị", count: total    },
    { key: "online",   label: "Online",          count: online   },
    { key: "offline",  label: "Offline",         count: offline  },
    { key: "abnormal", label: "Đang cảnh báo",   count: abnormal },
  ];

  const baseFilteredSensors = useMemo(() => {
    return visibleSensors.filter(s => {
      const q = search.toLowerCase();
      const matchSearch =
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.zone.toLowerCase().includes(q) ||
        s.zoneCode.toLowerCase().includes(q);
      const matchFilter =
        filter === "all" ? true :
        filter === "online"   ? s.online :
        filter === "offline"  ? !s.online :
        s.status === "abnormal";
      return matchSearch && matchFilter;
    });
  }, [visibleSensors, search, filter]);

  const displayed = useMemo(() => {
    let list = [...baseFilteredSensors];

    switch (sort) {
      case "status":
        list = [...list].sort((a, b) => {
          const rank = (sensor: Sensor): number => {
            if (!sensor.online) return 2;
            if (sensor.status === "abnormal") return 0;
            return 1;
          };
          return rank(a) - rank(b);
        });
        break;
      case "name-az":
        list = [...list].sort((a, b) => a.name.localeCompare(b.name, "vi"));
        break;
      case "zone":
        list = [...list].sort((a, b) => getSensorZoneLabel(a).localeCompare(getSensorZoneLabel(b), "vi"));
        break;
      case "device-id":
        list = [...list].sort((a, b) => a.id.localeCompare(b.id, "vi"));
        break;
    }
    return list;
  }, [baseFilteredSensors, sort]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setPage(1);
  }, [search, filter, sort, pageSize]);

  const totalPages = Math.max(1, Math.ceil(displayed.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const pagedDevices = useMemo(
    () => displayed.slice(pageStart, pageEnd),
    [displayed, pageStart, pageEnd],
  );
  const shouldGroupByZone = sort === "zone";
  const pagedZoneGroups = useMemo(
    () => shouldGroupByZone ? groupSensorsByZone(pagedDevices) : [],
    [pagedDevices, shouldGroupByZone],
  );

  useEffect(() => {
    const missingTelemetrySensors = pagedDevices.filter(
      (sensor) =>
        !latestTelemetryByDevice[sensor.id] &&
        !telemetryLoadingByDevice[sensor.id] &&
        !cardTelemetryPrefetchRef.current.has(sensor.id),
    );

    missingTelemetrySensors.forEach((sensor, index) => {
      cardTelemetryPrefetchRef.current.add(sensor.id);
      const timeoutId = window.setTimeout(() => {
        cardTelemetryPrefetchTimeoutsRef.current.delete(timeoutId);
        void onRequestTelemetryHistory(sensor.id, { limit: 1 });
      }, index * 45);
      cardTelemetryPrefetchTimeoutsRef.current.add(timeoutId);
    });
  }, [latestTelemetryByDevice, onRequestTelemetryHistory, pagedDevices, telemetryLoadingByDevice]);

  useEffect(() => {
    if (page !== currentPage) {
      setPage(currentPage);
    }
  }, [page, currentPage]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_PAGE_KEY, String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_PAGE_SIZE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_CHART_SIDEBAR_WIDTH_KEY, String(chartSidebarWidthPx));
  }, [chartSidebarWidthPx]);

  useEffect(() => {
    return () => {
      Object.values(exitTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      exitTimeoutsRef.current = {};
      cardTelemetryPrefetchTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      cardTelemetryPrefetchTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const activeIds = new Set(sensors.map((sensor) => sensor.id));
    setHiddenDeviceIds((current) => {
      let changed = false;
      const next = new Set<string>();
      current.forEach((deviceId) => {
        if (activeIds.has(deviceId)) {
          next.add(deviceId);
          return;
        }
        changed = true;
      });
      return changed ? next : current;
    });
    setExitingDeviceIds((current) => {
      let changed = false;
      const next = new Set<string>();
      current.forEach((deviceId) => {
        if (activeIds.has(deviceId)) {
          next.add(deviceId);
          return;
        }
        const timeoutId = exitTimeoutsRef.current[deviceId];
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          delete exitTimeoutsRef.current[deviceId];
        }
        changed = true;
      });
      return changed ? next : current;
    });
  }, [sensors]);

  function closeContextMenu(): void {
    setContextHoveredItem(null);
    setContextMenu((current) => {
      if (!current.open) {
        return current;
      }
      return { open: false, x: 0, y: 0, sensor: null };
    });
  }

  function openDeviceInfo(sensor: Sensor, mode: DeviceInfoMode): void {
    closeContextMenu();
    setSelectedSensorMode(mode);
    setSelectedSensor(sensor);
  }

  function openDeviceContextMenu(event: React.MouseEvent<HTMLDivElement>, sensor: Sensor): void {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 190;
    const menuHeight = 136;
    const margin = 10;
    const clampedX = Math.max(
      margin,
      Math.min(event.clientX, window.innerWidth - menuWidth - margin),
    );
    const clampedY = Math.max(
      margin,
      Math.min(event.clientY, window.innerHeight - menuHeight - margin),
    );

    setContextMenu({
      open: true,
      x: clampedX,
      y: clampedY,
      sensor,
    });
    setContextHoveredItem(null);
  }

  function markDeviceExiting(deviceId: string): void {
    if (!deviceId) {
      return;
    }

    setExitingDeviceIds((current) => {
      if (current.has(deviceId)) {
        return current;
      }
      const next = new Set(current);
      next.add(deviceId);
      return next;
    });

    const existingTimeout = exitTimeoutsRef.current[deviceId];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    exitTimeoutsRef.current[deviceId] = window.setTimeout(() => {
      setHiddenDeviceIds((current) => {
        if (current.has(deviceId)) {
          return current;
        }
        const next = new Set(current);
        next.add(deviceId);
        return next;
      });
      setExitingDeviceIds((current) => {
        if (!current.has(deviceId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(deviceId);
        return next;
      });
      delete exitTimeoutsRef.current[deviceId];
    }, DEVICE_CARD_EXIT_MS + 30);
  }

  useEffect(() => {
    if (!contextMenu.open) {
      return;
    }

    const closeIfOutside = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-device-context-menu='true']")) {
        return;
      }
      closeContextMenu();
    };

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    const closeOnScroll = (): void => {
      closeContextMenu();
    };

    window.addEventListener("mousedown", closeIfOutside);
    window.addEventListener("contextmenu", closeIfOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);

    return () => {
      window.removeEventListener("mousedown", closeIfOutside);
      window.removeEventListener("contextmenu", closeIfOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [contextMenu.open]);

  function goToPage(rawValue: string): void {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage));
      return;
    }

    const target = Math.min(totalPages, Math.max(1, Math.floor(parsed)));
    setPage(target);
    setPageInput(String(target));
  }

  const contextTarget = contextMenu.sensor;
  const activeChartSensor = chartSensor ?? visibleSensors[0] ?? null;
  const chartSidebarOpen = !chartSidebarDismissed && activeChartSensor !== null;
  const chartSidebarStacked = viewportWidth < CHART_SIDEBAR_STACKED_BREAKPOINT_PX;
  const chartSidebarWidthPxSafe = clampChartSidebarWidth(chartSidebarWidthPx, viewportWidth);
  const chartSidebarWidth = `${chartSidebarWidthPxSafe}px`;
  const chartSidebarReservedWidthPx = chartSidebarOpen && !chartSidebarStacked
    ? chartSidebarWidthPxSafe + CHART_SIDEBAR_CONTENT_GAP_PX
    : 0;
  const dashboardContentWidth = Math.max(320, layoutHostWidth - chartSidebarReservedWidthPx);
  const dashboardHeaderStacked = dashboardContentWidth < 1240;
  const dashboardHeaderControlsSingleColumn = dashboardContentWidth < 840;
  const deviceGridMinCardWidth = dashboardContentWidth < 760 ? 136 : dashboardContentWidth < 980 ? 148 : 158;
  const deviceGridTemplateColumns = `repeat(auto-fill, minmax(min(${deviceGridMinCardWidth}px, 100%), 1fr))`;
  const chartSidebarReservedWidth = chartSidebarReservedWidthPx > 0
    ? `${chartSidebarReservedWidthPx}px`
    : "0px";
  const getContextItemStyle = (item: DeviceContextMenuItem, danger = false): React.CSSProperties => {
    const hovered = contextHoveredItem === item;
    return {
      width: "100%",
      border: "none",
      background: hovered ? C.surface : "transparent",
      color: danger ? C.danger : hovered ? C.textBright : C.textBase,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 11px",
      fontSize: "0.74rem",
      transition: "background 140ms ease, color 140ms ease, transform 120ms ease",
      transform: hovered ? "translateX(1px)" : "translateX(0)",
    };
  };

  return (
    <>
      <style>{`
        @keyframes cardIn     { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes cardOut    { from { opacity:1; transform:translateY(0) scale(1) } to { opacity:0; transform:translateY(7px) scale(0.965) } }
        @keyframes dotPulse   { 0%,100%{ opacity:1 } 50%{ opacity:0.5 } }
        @keyframes barPulse   { 0%,100%{ opacity:1 } 50%{ opacity:0.6 } }
        @keyframes stripPulse { 0%,100%{ opacity:1; box-shadow:none } 50%{ opacity:0.7; } }
        @keyframes dropIn     { from{ opacity:0; transform:translateY(-6px) } to{ opacity:1; transform:translateY(0) } }
        @keyframes webSpin { to { transform: rotate(360deg); } }
        @keyframes webLoadShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .page-input::-webkit-outer-spin-button,
        .page-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .page-input[type="number"] {
          appearance: textfield;
          -moz-appearance: textfield;
        }
      `}</style>

      <div
        ref={layoutHostRef}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            order: chartSidebarStacked ? 2 : 1,
            paddingTop: chartSidebarStacked ? 12 : 22,
            paddingRight: chartSidebarReservedWidth,
            transition: "padding-right 220ms ease",
          }}
        >
      {/* ── Stat summary row ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
          gap: 8,
          marginBottom: chartSidebarStacked ? 14 : 20,
          minWidth: 0,
        }}
      >
        <ConsoleStatCard
          label="Tổng thiết bị"
          value={total}
          color={C.primary}
          bg={C.primaryBg}
          border={C.primary + "22"}
          icon={<Activity size={13} strokeWidth={2.2} />}
          className="flex-1 min-w-0"
        />
        <ConsoleStatCard
          label="Trực tuyến"
          value={online}
          color={C.success}
          bg={C.primaryBg}
          border={C.success + "22"}
          icon={<Wifi size={13} strokeWidth={2.2} />}
          className="flex-1 min-w-0"
        />
        <ConsoleStatCard
          label="Ngoại tuyến"
          value={offline}
          color="#6b7280"
          bg={C.card}
          border={C.cardBorder}
          icon={<WifiOff size={13} strokeWidth={2.2} />}
          className="flex-1 min-w-0"
        />
        <ConsoleStatCard
          label="Cảnh báo"
          value={abnormal}
          color={C.danger}
          bg={C.dangerBg}
          border={C.danger + "22"}
          icon={<AlertTriangle size={13} strokeWidth={2.2} />}
          className="flex-1 min-w-0"
        />
      </div>

      {/* ── Header row ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: dashboardHeaderStacked ? "1fr" : "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={{ color: C.textBright, fontSize: "1rem", fontWeight: 700, marginBottom: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Quản lý thiết bị
          </h2>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            minWidth: 0,
            width: dashboardHeaderStacked ? "100%" : "auto",
            justifySelf: dashboardHeaderStacked ? "stretch" : "end",
            justifyContent: "flex-start",
          }}
        >
          {/* Search */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 32,
              padding: "0 10px",
              borderRadius: 8,
              background: C.card,
              border: `1px solid ${C.cardBorder}`,
              minWidth: dashboardHeaderControlsSingleColumn ? 180 : 220,
              width: dashboardHeaderControlsSingleColumn ? "min(220px, 100%)" : "min(300px, 38vw)",
              flex: "0 1 auto",
            }}
          >
            <Search size={12} color={C.textMuted} strokeWidth={2} />
            <input
              data-ux="device-search"
              type="text"
              placeholder="Tìm theo tên, ID, khu vực…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ background: "transparent", border: "none", outline: "none", color: C.textBright, fontSize: "0.72rem", flex: 1, minWidth: 0 }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 8px",
              borderRadius: 12,
              background: C.surface,
              border: `1px solid ${C.border}`,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
              width: "auto",
              justifyContent: "flex-start",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <div
              style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}
              onMouseEnter={() => setSortIconHovered(true)}
              onMouseLeave={() => setSortIconHovered(false)}
            >
              <span
                style={{
                  color: C.textMuted,
                  fontSize: "0.66rem",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  width: 30,
                  height: 26,
                  justifyContent: "center",
                  borderRadius: 8,
                  border: `1px solid ${C.cardBorder}`,
                  background: C.card,
                }}
                aria-label="Bộ lọc sắp xếp"
              >
                <Filter size={12} strokeWidth={2} />
              </span>
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 6px)",
                  left: "50%",
                  transform: sortIconHovered
                    ? "translateX(-50%) translateY(0)"
                    : "translateX(-50%) translateY(2px)",
                  opacity: sortIconHovered ? 1 : 0,
                  pointerEvents: "none",
                  transition: "opacity 0.14s ease, transform 0.14s ease",
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  color: C.textBase,
                  fontSize: "0.62rem",
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                  zIndex: 5,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                }}
              >
                Sắp xếp
              </div>
            </div>
            <div style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: dashboardHeaderControlsSingleColumn ? "1 1 auto" : "0 0 auto", display: "flex", justifyContent: dashboardHeaderControlsSingleColumn ? "flex-end" : "flex-start" }}>
              <SortDropdown value={sort} onChange={setSort} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <div style={{ color: C.textMuted, fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          Trạng thái vận hành
        </div>
        <div style={{ color: C.textMuted, fontSize: "0.72rem", fontWeight: 600, textAlign: "right", marginLeft: "auto", whiteSpace: "nowrap" }}>
          Hiển thị {pagedDevices.length} / {displayed.length} thiết bị
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 4,
          marginBottom: 16,
          minWidth: 0,
        }}
      >
        {FILTERS.map(f => {
          const isActive = filter === f.key;
          const dotColor = f.key === "online" ? C.success : f.key === "offline" ? "#6b7280" : f.key === "abnormal" ? C.danger : C.primary;
          return (
            <button key={f.key} data-ux={`filter-${f.key}`} onClick={() => setFilter(f.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                justifyContent: "flex-start",
                width: "auto",
                minWidth: 0,
                flexShrink: 0,
                height: 32, padding: "0 12px", borderRadius: 8,
                background: isActive ? C.card : "transparent",
                border: `1px solid ${isActive ? C.cardBorder : "transparent"}`,
                color: isActive ? C.textBright : C.textMuted,
                fontSize: "0.73rem", fontWeight: isActive ? 600 : 400,
                cursor: "pointer", transition: "all 0.15s",
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.textBase; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.textMuted; }}
            >
              {f.key !== "all" && (
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: `0 0 4px ${dotColor}77` }} />
              )}
              {f.label}
              <span style={{
                fontSize: "0.62rem", fontWeight: 700,
                padding: "1px 5px", borderRadius: 20,
                background: isActive ? C.primaryBg : C.surface,
                color: isActive ? C.primary : C.textMuted,
                border: `1px solid ${isActive ? C.primary + "30" : C.border}`,
              }}>
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Card Grid + Right Sidebar ── */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 12, minWidth: 0, flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            minHeight: 0,
            overflowY: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: `${C.scrollbar} transparent`,
            paddingRight: 2,
          }}
        >
          {displayed.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: 200, borderRadius: 12,
              background: C.card, border: `1px solid ${C.cardBorder}`,
              color: C.textMuted, gap: 8,
            }}>
              <Layers size={28} strokeWidth={1.2} />
              <div style={{ fontSize: "0.82rem" }}>Không tìm thấy thiết bị nào</div>
              <div style={{ fontSize: "0.7rem", color: C.textDim }}>Thử thay đổi bộ lọc hoặc từ khoá tìm kiếm</div>
            </div>
          ) : (
            <>
              {shouldGroupByZone ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {pagedZoneGroups.map((zoneGroup) => (
                    <section key={zoneGroup.key} data-ux="device-zone-section" data-zone={zoneGroup.label}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          marginBottom: 8,
                          padding: "0 2px",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                          <MapPin size={13} color={C.primary} strokeWidth={2.2} />
                          <h3
                            style={{
                              color: C.textBright,
                              fontSize: "0.82rem",
                              fontWeight: 800,
                              margin: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              minWidth: 0,
                            }}
                          >
                            {zoneGroup.label}
                          </h3>
                          <span style={{ color: C.textMuted, fontSize: "0.68rem", fontWeight: 650, whiteSpace: "nowrap" }}>
                            {zoneGroup.total} thiết bị
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: "0.66rem", fontWeight: 650, flexWrap: "wrap" }}>
                          <span style={{ color: C.success, whiteSpace: "nowrap" }}>{zoneGroup.online} online</span>
                          {zoneGroup.abnormal > 0 && <span style={{ color: C.danger, whiteSpace: "nowrap" }}>{zoneGroup.abnormal} cảnh báo</span>}
                        </div>
                      </div>

                      <div
                        data-ux="device-grid"
                        style={{
                          display: "grid",
                          gridTemplateColumns: deviceGridTemplateColumns,
                          gap: 6,
                        }}
                      >
                        {zoneGroup.devices.map((sensor, idx) => (
                          <DeviceCard
                            key={sensor.id}
                            sensor={sensor}
                            idx={idx}
                            telemetryPoint={latestTelemetryByDevice[sensor.id]}
                            showAxisReadout
                            exiting={exitingDeviceIds.has(sensor.id)}
                            onInfo={(target) => openDeviceInfo(target, "view")}
                            onChart={(target) => {
                              closeContextMenu();
                              setChartSidebarDismissed(false);
                              setChartSensor(target);
                            }}
                            onOpenWeb={(target) => {
                              closeContextMenu();
                              setWebSensor(target);
                            }}
                            onContextMenu={openDeviceContextMenu}
                            onPrepareInfo={loadDeviceInfoModal}
                            onPrepareChart={loadSensorChartModal}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div
                  data-ux="device-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: deviceGridTemplateColumns,
                    gap: 6,
                  }}
                >
                  {pagedDevices.map((sensor, idx) => (
                    <DeviceCard
                      key={sensor.id}
                      sensor={sensor}
                      idx={idx}
                      telemetryPoint={latestTelemetryByDevice[sensor.id]}
                      showAxisReadout
                      exiting={exitingDeviceIds.has(sensor.id)}
                      onInfo={(target) => openDeviceInfo(target, "view")}
                      onChart={(target) => {
                        closeContextMenu();
                        setChartSidebarDismissed(false);
                        setChartSensor(target);
                      }}
                      onOpenWeb={(target) => {
                        closeContextMenu();
                        setWebSensor(target);
                      }}
                      onContextMenu={openDeviceContextMenu}
                      onPrepareInfo={loadDeviceInfoModal}
                      onPrepareChart={loadSensorChartModal}
                    />
                  ))}
                </div>
              )}

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.textMuted, fontSize: "0.7rem", fontWeight: 600 }}>
                    Thiết bị / trang
                  </span>
                  <div style={{ position: "relative" }}>
                    <select
                      data-ux="page-size-select"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      style={{
                        height: 30,
                        borderRadius: 8,
                        background: C.card,
                        border: `1px solid ${C.cardBorder}`,
                        color: C.textBase,
                        fontSize: "0.72rem",
                        padding: "0 28px 0 10px",
                        appearance: "none",
                        cursor: "pointer",
                      }}
                    >
                      {[10, 20, 50, 100, 200].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={11}
                      color={C.textMuted}
                      strokeWidth={2}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    style={{
                      height: 30,
                      minWidth: 30,
                      borderRadius: 8,
                      border: `1px solid ${C.cardBorder}`,
                      background: C.card,
                      color: currentPage === 1 ? C.textDim : C.textBase,
                      cursor: currentPage === 1 ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChevronLeft size={12} strokeWidth={2} />
                  </button>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: C.textMuted, fontSize: "0.7rem" }}>Trang</span>
                    <input
                      data-ux="page-input"
                      className="page-input"
                      type="number"
                      min={1}
                      max={totalPages}
                      value={pageInput}
                      onChange={(e) => setPageInput(e.target.value)}
                      onBlur={() => goToPage(pageInput)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          goToPage(pageInput);
                        }
                      }}
                      style={{
                        width: 52,
                        height: 30,
                        borderRadius: 8,
                        border: `1px solid ${C.cardBorder}`,
                        background: C.card,
                        color: C.textBase,
                        fontSize: "0.72rem",
                        textAlign: "center",
                        outline: "none",
                      }}
                    />
                    <span style={{ color: C.textMuted, fontSize: "0.7rem" }}>/ {totalPages}</span>
                  </div>

                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    style={{
                      height: 30,
                      minWidth: 30,
                      borderRadius: 8,
                      border: `1px solid ${C.cardBorder}`,
                      background: C.card,
                      color: currentPage >= totalPages ? C.textDim : C.textBase,
                      cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChevronRight size={12} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <div
          data-ux="device-chart-sidebar"
          style={{
            position: chartSidebarStacked ? "relative" : "absolute",
            order: chartSidebarStacked ? 1 : 2,
            top: chartSidebarStacked ? "auto" : 0,
            right: chartSidebarStacked ? "auto" : 0,
            bottom: chartSidebarStacked ? "auto" : 0,
            width: chartSidebarOpen ? (chartSidebarStacked ? "100%" : chartSidebarWidth) : 0,
            minWidth: 0,
            maxWidth: chartSidebarOpen ? (chartSidebarStacked ? "100%" : chartSidebarWidth) : 0,
            height: chartSidebarStacked && chartSidebarOpen ? "min(68vh, 720px)" : undefined,
            minHeight: chartSidebarStacked && chartSidebarOpen ? 360 : undefined,
            marginTop: chartSidebarStacked && chartSidebarOpen ? 12 : 0,
            marginBottom: chartSidebarStacked && chartSidebarOpen ? 12 : 0,
            opacity: chartSidebarOpen ? 1 : 0,
            transform: chartSidebarOpen ? "translateX(0)" : "translateX(12px)",
            transition: "width 220ms ease, max-width 220ms ease, opacity 180ms ease, transform 220ms ease",
            pointerEvents: chartSidebarOpen ? "auto" : "none",
            overflow: "visible",
            zIndex: 2,
          }}
        >
          {chartSidebarOpen && activeChartSensor ? (
            <>
              {!chartSidebarStacked ? (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  title="Kéo để chỉnh độ rộng khung biểu đồ"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    chartSidebarResizeRef.current = {
                      active: true,
                      startX: event.clientX,
                      startWidth: chartSidebarWidthPxSafe,
                    };
                    setChartSidebarResizing(true);
                    document.body.style.cursor = "col-resize";
                    document.body.style.userSelect = "none";
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: -8,
                    width: 16,
                    cursor: "col-resize",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 5,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 46,
                      borderRadius: 999,
                      border: `1px solid ${chartSidebarResizing ? C.primary : C.border}`,
                      background: chartSidebarResizing ? C.primaryBg : C.card,
                      color: chartSidebarResizing ? C.primary : C.textMuted,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.14s ease",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.16)",
                    }}
                  >
                    <GripVertical size={12} strokeWidth={2.2} />
                  </div>
                </div>
              ) : null}

              <Suspense fallback={null}>
                <SensorChartModal
                  sensor={activeChartSensor}
                  telemetryPoints={telemetryByDevice[activeChartSensor.id] || []}
                  telemetryLoading={Boolean(telemetryLoadingByDevice[activeChartSensor.id])}
                  spectrumPoints={spectrumByDevice[activeChartSensor.id] || []}
                  onRequestTelemetryHistory={onRequestTelemetryHistory}
                  onNotify={onNotify}
                  onSensorUpdated={(updated) => {
                    setChartSensor(updated);
                    setSelectedSensor((current) => (current?.id === updated.id ? updated : current));
                    onSensorUpdated?.(updated);
                  }}
                  onDeviceDataCleared={onDeviceDataCleared}
                  onClose={() => {
                    setChartSidebarDismissed(true);
                    setChartSidebarResizing(false);
                  }}
                />
              </Suspense>
            </>
          ) : null}
        </div>
      </div>
        </div>
      </div>

      {contextMenu.open && contextTarget ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 90 }}
          onClick={closeContextMenu}
        >
          <div
            data-device-context-menu="true"
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
              width: 190,
              borderRadius: 10,
              border: `1px solid ${C.cardBorder}`,
              background: C.card,
              boxShadow: "0 12px 28px rgba(2,6,23,0.38)",
              overflow: "hidden",
              animation: "dropIn 0.13s ease both",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              style={getContextItemStyle("info")}
              onMouseEnter={() => setContextHoveredItem("info")}
              onMouseLeave={() => setContextHoveredItem(null)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openDeviceInfo(contextTarget, "view");
              }}
            >
              <Info size={13} strokeWidth={2.1} color={C.primary} />
              Thông tin
            </button>
            <button
              style={{
                ...getContextItemStyle("edit"),
                borderTop: `1px solid ${C.border}`,
              }}
              onMouseEnter={() => setContextHoveredItem("edit")}
              onMouseLeave={() => setContextHoveredItem(null)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openDeviceInfo(contextTarget, "edit");
              }}
            >
              <PencilLine size={13} strokeWidth={2.1} color={C.primary} />
              Chỉnh sửa
            </button>
            <button
              style={{
                ...getContextItemStyle("delete", true),
                borderTop: `1px solid ${C.border}`,
              }}
              onMouseEnter={() => setContextHoveredItem("delete")}
              onMouseLeave={() => setContextHoveredItem(null)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openDeviceInfo(contextTarget, "delete");
              }}
            >
              <Trash2 size={13} strokeWidth={2.1} />
              Xoá thiết bị
            </button>
          </div>
        </div>
      ) : null}

      {selectedSensor ? (
        <Suspense fallback={null}>
          <DeviceInfoModal
            sensor={selectedSensor}
            initialMode={selectedSensorMode}
            onClose={() => {
              setSelectedSensor(null);
              setSelectedSensorMode("view");
            }}
            onSensorUpdated={(updated) => {
              setSelectedSensor(updated);
              onSensorUpdated?.(updated);
            }}
            onSensorDeleted={(deviceId) => {
              markDeviceExiting(deviceId);
              setSelectedSensor(null);
              setSelectedSensorMode("view");
            }}
            onNotify={onNotify}
          />
        </Suspense>
      ) : null}
      <DeviceWebModal sensor={webSensor} onClose={() => setWebSensor(null)} />
    </>
  );
}
