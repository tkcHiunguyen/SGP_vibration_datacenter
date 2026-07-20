import React, { lazy, Suspense, useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Info, Search, AlertTriangle,
  Wifi, WifiOff, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, GripVertical,
  Activity, Layers, MapPin, ArrowUpAZ, Hash, CircleDot, Filter, Globe, X, ExternalLink, PencilLine, Trash2,
  PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { ConsoleStatCard, type ToastItem } from "./ui";
import { useTheme } from "../context/ThemeContext";
import { useDisplayMode } from "../context/DisplayModeContext";
import {
  buildDeviceTelemetryCardReadout,
  DEFAULT_DEVICE_SORT,
  getDeviceAxisPeakMagnitude,
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
      className="dc-telemetry-value"
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
      {unit && <span className="dc-telemetry-value-unit" style={{ color: mutedColor, fontSize: unitSize, fontWeight: 850, letterSpacing: "0" }}>{unit}</span>}
    </span>
  );
}

/* ── Device Card ── */
const DeviceCard = React.memo(function DeviceCard({
  sensor,
  idx,
  onInfo,
  onChart,
  onOpenWeb,
  onContextMenu,
  onPrepareInfo,
  onPrepareChart,
  telemetryPoint,
  telemetryLoading,
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
  telemetryLoading?: boolean;
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
  const telemetryTimestamp = telemetryPoint?.receivedAt ? Date.parse(telemetryPoint.receivedAt) : NaN;
  const hasTelemetry = Boolean(telemetryPoint && Number.isFinite(telemetryTimestamp));
  const showTelemetryShimmer = telemetryLoading && !hasTelemetry;
  const cardAnimation = exiting
    ? "cardOut 260ms cubic-bezier(0.22, 0.78, 0.3, 1) both"
    : "cardIn 0.3s ease both";

  return (
    <div
      className="dc-device-card"
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

      <div className="dc-device-card-body" style={{ padding: "5px 10px 6px 10px", display: "flex", flexDirection: "column", flex: 1, gap: 4 }}>
        <div className="dc-device-card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5, minWidth: 0 }}>
          <div
            className="dc-device-card-title"
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
          <div className="dc-device-card-actions" style={{ display: "inline-flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onInfo(sensor); }}
              title="Thuộc tính thiết bị"
              aria-label={`Mở thuộc tính thiết bị ${sensor.name}`}
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
              className="dc-device-card-action-tooltip"
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
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasWebTarget) {
                    onOpenWeb(sensor);
                  }
                }}
                title={hasWebTarget ? "Truy cập thiết bị" : "Thiết bị chưa có IP"}
                aria-label={hasWebTarget ? `Truy cập giao diện thiết bị ${sensor.name}` : `Thiết bị ${sensor.name} chưa có IP`}
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
                className="dc-device-card-action-tooltip"
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
          className="dc-device-card-telemetry"
          aria-label="Giá trị telemetry hiện tại"
          style={{
            minWidth: 0,
          }}
        >
          {showTelemetryShimmer ? (
            <div style={{ display: "grid", gridTemplateColumns: showAxisReadout ? "minmax(38px, 0.44fr) minmax(78px, 1fr)" : "minmax(0, 1fr)", gap: 5, minWidth: 0, alignItems: "center" }}>
              <div className="device-card-shimmer" style={{ height: 24, borderRadius: 6 }} />
              {showAxisReadout ? <div className="device-card-shimmer" style={{ height: 36, borderRadius: 6 }} /> : null}
            </div>
          ) : (
          <div
            className="dc-device-card-telemetry-grid"
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
              className="dc-device-card-temp"
              title={`Temperature ${telemetryReadout.temperature.value || "--"}`}
              style={{
                minWidth: 0,
                display: "grid",
                alignContent: "center",
                gap: 3,
              }}
            >
              <span className="dc-device-card-temp-label" style={{ color: C.warning, fontSize: "0.4rem", fontWeight: 900, letterSpacing: "0.09em", lineHeight: 1 }}>
                TEMP
              </span>
              <TelemetryValue
                value={telemetryReadout.temperature.value || "--"}
                color={telemetryReadout.temperature.value ? C.textBright : C.textDim}
                mutedColor={C.warning}
                fontSize="var(--dc-device-temp-value-size)"
                unitSize="var(--dc-device-temp-unit-size)"
              />
            </div>

            {showAxisReadout ? (
              <div
                className="dc-device-card-axis-values"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr)",
                  gap: 2,
                  minWidth: 0,
                }}
              >
                {telemetryReadout.axes.map((item, itemIndex) => (
                  <div
                    className="dc-device-card-axis-row"
                    key={`${item.label}-${itemIndex}`}
                    title={`${item.label} ${item.value || "--"}`.trim()}
                    style={{
                      minWidth: 0,
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) max-content",
                      alignItems: "baseline",
                      columnGap: 2,
                      lineHeight: 1,
                    }}
                  >
                    <span
                      className="dc-device-card-axis-label"
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
                      fontSize="var(--dc-device-axis-value-size)"
                      unitSize="var(--dc-device-axis-unit-size)"
                      justify="flex-end"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          )}
        </div>
      </div>

    </div>
  );
});

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
        className="dc-device-sort-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sắp xếp theo ${current.label}`}
        onClick={() => setOpen(v => !v)}
        style={{
          height: 34, padding: "0 10px", borderRadius: 8,
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
          <div className="dc-device-sort-menu" style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 20,
            background: C.card, border: `1px solid ${C.cardBorder}`,
            borderRadius: 10, overflow: "hidden", minWidth: 175,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            animation: "dropIn 0.15s ease",
          }}>
            {SORT_OPTIONS.map(opt => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={value === opt.key}
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
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          background: "rgba(0,0,0,0.55)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Giao diện thiết bị ${sensor.name}`}
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
              type="button"
              aria-label="Đóng giao diện thiết bị"
              onClick={onClose}
              style={{
                width: 34,
                height: 34,
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
  onChartClosed?: (deviceId: string) => void;
  onSensorUpdated?: (sensor: Sensor) => void;
}

const STORAGE_PAGE_KEY = "sgp_ui_devices_page";
const STORAGE_PAGE_SIZE_KEY = "sgp_ui_devices_page_size";
const STORAGE_CHART_SIDEBAR_RATIO_KEY = "sgp_ui_chart_sidebar_ratio_v5";
const DEVICE_CARD_EXIT_MS = 260;
const DATA_VIEW_PREFETCH_TIMEOUT_MS = 2500;
const CHART_SIDEBAR_MIN_WIDTH_PX = 480;
const CHART_SIDEBAR_DEFAULT_VIEWPORT_RATIO = 0.8;
const CHART_SIDEBAR_MAX_VIEWPORT_RATIO = 0.8;
function getChartSidebarDefaultWidth(viewportWidth: number): number {
  return Math.round(viewportWidth * CHART_SIDEBAR_DEFAULT_VIEWPORT_RATIO);
}
const CHART_SIDEBAR_MIN_MAIN_AREA_PX = 320;
const CHART_SIDEBAR_STACKED_BREAKPOINT_PX = 1200;
const CHART_SIDEBAR_MOBILE_BREAKPOINT_PX = 640;
const CHART_SIDEBAR_CONTENT_GAP_PX = 12;

function getChartSidebarMinWidth(viewportWidth: number): number {
  if (viewportWidth < 1200) {
    return 360;
  }
  return CHART_SIDEBAR_MIN_WIDTH_PX;
}

function getChartSidebarMaxWidth(viewportWidth: number): number {
  const minWidth = getChartSidebarMinWidth(viewportWidth);
  const ratioMax = Math.floor(viewportWidth * CHART_SIDEBAR_MAX_VIEWPORT_RATIO);
  const byMainArea = Math.floor(viewportWidth - CHART_SIDEBAR_MIN_MAIN_AREA_PX);
  const bounded = Math.min(ratioMax, byMainArea);
  return Math.max(minWidth, bounded);
}

function clampChartSidebarWidth(width: number, viewportWidth: number): number {
  const minWidth = getChartSidebarMinWidth(viewportWidth);
  const maxWidth = getChartSidebarMaxWidth(viewportWidth);
  const normalized = Number.isFinite(width) ? Math.round(width) : getChartSidebarDefaultWidth(viewportWidth);
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

function readStoredRatio(key: string, fallback: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function DeviceManagement({
  sensors,
  telemetryByDevice,
  telemetryLoadingByDevice,
  spectrumByDevice,
  onRequestTelemetryHistory,
  onNotify,
  onDeviceDataCleared,
  onChartClosed,
  onSensorUpdated,
}: DeviceManagementProps) {
  const { C } = useTheme();
  const { wallboard } = useDisplayMode();
  const layoutHostRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  const [layoutHostWidth, setLayoutHostWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const [selectedSensorMode, setSelectedSensorMode] = useState<DeviceInfoMode>("view");
  const [chartSensor, setChartSensor] = useState<Sensor | null>(null);
  const [chartSidebarCollapsed, setChartSidebarCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < CHART_SIDEBAR_STACKED_BREAKPOINT_PX,
  );
  const [chartSidebarWidthPx, setChartSidebarWidthPx] = useState(() => {
    const initialViewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const storedRatio = readStoredRatio(
      STORAGE_CHART_SIDEBAR_RATIO_KEY,
      CHART_SIDEBAR_DEFAULT_VIEWPORT_RATIO,
    );
    const storedWidth = initialViewportWidth * Math.min(
      CHART_SIDEBAR_MAX_VIEWPORT_RATIO,
      Math.max(0.25, storedRatio),
    );
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
  const viewportWidthRef = useRef(typeof window === "undefined" ? 1440 : window.innerWidth);
  const exitTimeoutsRef = useRef<Record<string, number>>({});
  const cardTelemetryPrefetchRef = useRef<Set<string>>(new Set());
  const cardTelemetryPrefetchTimeoutsRef = useRef<Set<number>>(new Set());
  const chartSidebarResizeRef = useRef({
    active: false,
    startX: 0,
    startWidth: getChartSidebarDefaultWidth(typeof window === "undefined" ? 1440 : window.innerWidth),
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
      const previousViewportWidth = Math.max(1, viewportWidthRef.current);
      viewportWidthRef.current = nextViewportWidth;
      setViewportWidth(nextViewportWidth);
      setChartSidebarWidthPx((previousWidth) => clampChartSidebarWidth(
        previousWidth * (nextViewportWidth / previousViewportWidth),
        nextViewportWidth,
      ));
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
      const rect = node.getBoundingClientRect();
      setLayoutHostWidth(Math.max(0, Math.round(rect.width)));
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

  const highestVibrationSensor = useMemo(() => {
    let candidate: { sensor: Sensor; peak: number } | null = null;

    for (const sensor of visibleSensors) {
      const peak = getDeviceAxisPeakMagnitude(latestTelemetryByDevice[sensor.id]);
      if (peak === null || (candidate !== null && peak <= candidate.peak)) {
        continue;
      }
      candidate = { sensor, peak };
    }

    return candidate?.sensor ?? visibleSensors[0] ?? null;
  }, [latestTelemetryByDevice, visibleSensors]);

  useEffect(() => {
    setChartSensor((current) => current ?? highestVibrationSensor);
  }, [highestVibrationSensor]);

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
    if (typeof window === "undefined" || viewportWidth < CHART_SIDEBAR_STACKED_BREAKPOINT_PX) {
      return;
    }
    window.localStorage.setItem(
      STORAGE_CHART_SIDEBAR_RATIO_KEY,
      String(chartSidebarWidthPx / Math.max(1, viewportWidth)),
    );
  }, [chartSidebarWidthPx, viewportWidth]);

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

  const closeContextMenu = useCallback((): void => {
    setContextHoveredItem(null);
    setContextMenu((current) => {
      if (!current.open) {
        return current;
      }
      return { open: false, x: 0, y: 0, sensor: null };
    });
  }, []);

  const openDeviceInfo = useCallback((sensor: Sensor, mode: DeviceInfoMode): void => {
    closeContextMenu();
    setSelectedSensorMode(mode);
    setSelectedSensor(sensor);
  }, [closeContextMenu]);

  const openDeviceContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, sensor: Sensor): void => {
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
  }, []);

  const markDeviceExiting = useCallback((deviceId: string): void => {
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
  }, []);

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
  const openCardInfo = useCallback((sensor: Sensor) => openDeviceInfo(sensor, "view"), [openDeviceInfo]);
  const openCardChart = useCallback((sensor: Sensor) => {
    closeContextMenu();
    setChartSensor(sensor);
    setChartSidebarCollapsed(false);
  }, [closeContextMenu]);
  const openCardWeb = useCallback((sensor: Sensor) => {
    closeContextMenu();
    setWebSensor(sensor);
  }, [closeContextMenu]);
  const activeChartSensor = chartSensor ?? highestVibrationSensor;
  const chartSidebarAvailable = activeChartSensor !== null;
  const chartSidebarOpen = chartSidebarAvailable && !chartSidebarCollapsed;
  const chartSidebarMobile = viewportWidth < CHART_SIDEBAR_MOBILE_BREAKPOINT_PX;
  const chartSidebarStacked = viewportWidth < CHART_SIDEBAR_STACKED_BREAKPOINT_PX;
  const chartSidebarWidthPxSafe = clampChartSidebarWidth(chartSidebarWidthPx, viewportWidth);
  const chartSidebarWidth = `${chartSidebarWidthPxSafe}px`;
  const chartSidebarReservedWidthPx = chartSidebarOpen && !chartSidebarStacked
    ? chartSidebarWidthPxSafe + CHART_SIDEBAR_CONTENT_GAP_PX
    : 0;
  const dashboardContentWidth = Math.max(320, layoutHostWidth - chartSidebarReservedWidthPx);
  const zoneCollectionColumnCount = dashboardContentWidth >= 2400
    ? 3
    : dashboardContentWidth >= 1440
      ? 2
      : 1;
  const estimatedZoneColumnWidth = (
    dashboardContentWidth - Math.max(0, zoneCollectionColumnCount - 1) * 16
  ) / zoneCollectionColumnCount;
  const zoneDeviceGridTemplateColumns = estimatedZoneColumnWidth >= (wallboard ? 960 : 700)
    ? "repeat(2, minmax(0, 1fr))"
    : "minmax(0, 1fr)";
  const dashboardHeaderControlsSingleColumn = dashboardContentWidth < 840;
  const deviceGridTemplateColumns = dashboardContentWidth < 520
    ? "minmax(0, 1fr)"
    : dashboardContentWidth < 760
      ? "repeat(auto-fit, minmax(min(180px, 100%), 1fr))"
      : dashboardContentWidth < 980
        ? "repeat(auto-fill, minmax(min(210px, 100%), 240px))"
        : "repeat(auto-fill, minmax(min(var(--dc-device-card-min), 100%), var(--dc-device-card-max)))";
  useEffect(() => {
    if (!chartSidebarOpen) {
      return;
    }

    const collapseOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setChartSidebarCollapsed(true);
      }
    };

    window.addEventListener("keydown", collapseOnEscape);
    return () => window.removeEventListener("keydown", collapseOnEscape);
  }, [chartSidebarOpen]);
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
        @keyframes deviceCardShimmer { 0% { background-position: 180% 0; } 100% { background-position: -180% 0; } }
        .device-card-shimmer { background: linear-gradient(90deg, ${C.surface} 0%, ${C.border} 45%, ${C.surface} 90%); background-size: 220% 100%; animation: deviceCardShimmer 1.1s ease-in-out infinite; opacity: 0.55; }
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
          className="dc-device-content-column"
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            order: chartSidebarStacked ? 2 : 1,
            paddingTop: chartSidebarStacked ? 12 : 22,
          }}
        >
      {/* Stat summary moved to sidebar */}

      {/* ── Controls row ── */}
      <div
        className="dc-device-controls"
        style={{
          marginBottom: 12,
        }}
      >
        {/* Search */}
        <div
          data-ux="device-search-shell"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            background: C.card,
            border: `1px solid ${C.cardBorder}`,
            minWidth: 0,
            width: "auto",
            flex: "1 1 300px",
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
          className="dc-device-sort-shell"
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
              className="dc-device-sort-tooltip"
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
          <div style={{ minWidth: 0, flex: "0 0 auto", display: "flex", justifyContent: "flex-start" }}>
            <SortDropdown value={sort} onChange={setSort} />
          </div>
        </div>

        <div className="dc-device-result-count" style={{ color: C.textMuted, display: dashboardHeaderControlsSingleColumn ? "none" : "block", fontSize: "0.72rem", fontWeight: 600, marginLeft: "auto", whiteSpace: "nowrap", flexShrink: 0 }}>
          Hiển thị {pagedDevices.length} / {displayed.length} thiết bị
        </div>

        {!chartSidebarOpen && chartSidebarAvailable ? (
          <button
            className="dc-open-chart-panel-button"
            type="button"
            data-ux="open-chart-panel"
            aria-label={`Mở biểu đồ ${activeChartSensor?.name ?? "thiết bị"}`}
            onClick={() => setChartSidebarCollapsed(false)}
            style={{
              minHeight: 32,
              padding: "0 10px",
              borderRadius: 8,
              border: `1px solid ${C.cardBorder}`,
              background: C.card,
              color: C.textBase,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              flexShrink: 0,
              fontSize: "0.7rem",
              fontWeight: 700,
            }}
          >
            <PanelRightOpen size={13} color={C.primary} strokeWidth={2.2} />
            Mở biểu đồ
          </button>
        ) : null}
      </div>

      {/* ── Card Grid + Right Sidebar ── */}
      <div className="dc-device-workspace">
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
            <div className="dc-device-empty-state" style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: 200, borderRadius: 12,
              background: C.card, border: `1px solid ${C.cardBorder}`,
              color: C.textMuted, gap: 8,
            }}>
              <Layers size={28} strokeWidth={1.2} />
              <div className="dc-device-empty-state-title" style={{ fontSize: "0.82rem" }}>Không tìm thấy thiết bị nào</div>
              <div className="dc-device-empty-state-copy" style={{ fontSize: "0.7rem", color: C.textDim }}>Thử thay đổi bộ lọc hoặc từ khoá tìm kiếm</div>
              {(search || filter !== "all") ? (
                <button
                  className="dc-device-empty-state-action"
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                  style={{
                    height: 32,
                    marginTop: 4,
                    padding: "0 11px",
                    borderRadius: 8,
                    border: `1px solid ${C.cardBorder}`,
                    background: C.surface,
                    color: C.textBase,
                    cursor: "pointer",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                  }}
                >
                  Xoá bộ lọc
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {shouldGroupByZone ? (
                <div
                  className="dc-zone-collection"
                  style={{ gridTemplateColumns: `repeat(${zoneCollectionColumnCount}, minmax(0, 1fr))` }}
                >
                  {pagedZoneGroups.map((zoneGroup) => (
                    <section
                      key={zoneGroup.key}
                      className="dc-zone-device-group"
                      data-ux="device-zone-section"
                      data-zone={zoneGroup.label}
                      style={{ background: C.surface, borderColor: C.border }}
                    >
                      <div
                        className="dc-zone-heading-row"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          marginBottom: 9,
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
                          <span className="dc-zone-device-count" style={{ color: C.textMuted, fontSize: "0.68rem", fontWeight: 650, whiteSpace: "nowrap" }}>
                            {zoneGroup.total} thiết bị
                          </span>
                        </div>
                        <div className="dc-zone-status" style={{ display: "flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: "0.66rem", fontWeight: 650, flexWrap: "wrap" }}>
                          <span style={{ color: C.success, whiteSpace: "nowrap" }}>{zoneGroup.online} online</span>
                          {zoneGroup.abnormal > 0 && <span style={{ color: C.danger, whiteSpace: "nowrap" }}>{zoneGroup.abnormal} cảnh báo</span>}
                        </div>
                      </div>

                      <div
                        data-ux="device-grid"
                        className="dc-zone-device-grid"
                        style={{
                          gridTemplateColumns: zoneGroup.devices.length > 1
                            ? zoneDeviceGridTemplateColumns
                            : "minmax(0, 1fr)",
                        }}
                      >
                        {zoneGroup.devices.map((sensor, idx) => (
                          <DeviceCard
                            key={sensor.id}
                            sensor={sensor}
                            idx={idx}
                            telemetryPoint={latestTelemetryByDevice[sensor.id]}
                            telemetryLoading={Boolean(telemetryLoadingByDevice[sensor.id])}
                            showAxisReadout
                            exiting={exitingDeviceIds.has(sensor.id)}
                            onInfo={openCardInfo}
                            onChart={openCardChart}
                            onOpenWeb={openCardWeb}
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
                      telemetryLoading={Boolean(telemetryLoadingByDevice[sensor.id])}
                      showAxisReadout
                      exiting={exitingDeviceIds.has(sensor.id)}
                      onInfo={openCardInfo}
                      onChart={openCardChart}
                      onOpenWeb={openCardWeb}
                      onContextMenu={openDeviceContextMenu}
                      onPrepareInfo={loadDeviceInfoModal}
                      onPrepareChart={loadSensorChartModal}
                    />
                  ))}
                </div>
              )}

              <div
                className="dc-device-pagination"
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
                      aria-label="Số thiết bị mỗi trang"
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      style={{
                        height: 34,
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
                    type="button"
                    aria-label="Trang trước"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    style={{
                      height: 34,
                      minWidth: 34,
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
                      aria-label="Số trang hiện tại"
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
                        height: 34,
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
                    type="button"
                    aria-label="Trang sau"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    style={{
                      height: 34,
                      minWidth: 34,
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
            position: chartSidebarMobile ? "fixed" : "relative",
            inset: chartSidebarMobile && chartSidebarOpen ? 0 : undefined,
            order: chartSidebarStacked ? -1 : 2,
            width: chartSidebarOpen ? (chartSidebarStacked ? "100%" : chartSidebarWidth) : 0,
            minWidth: 0,
            maxWidth: chartSidebarOpen ? (chartSidebarStacked ? "100%" : chartSidebarWidth) : 0,
            flexShrink: 0,
            height: chartSidebarOpen
              ? chartSidebarMobile
                ? "100dvh"
                : chartSidebarStacked
                  ? "clamp(360px, 55dvh, 680px)"
                  : "100%"
              : 0,
            minHeight: chartSidebarOpen && chartSidebarStacked && !chartSidebarMobile ? 360 : 0,
            opacity: chartSidebarOpen ? 1 : 0,
            transform: chartSidebarOpen ? "translateX(0)" : "translateX(12px)",
            transition: "opacity 180ms ease-out, transform 180ms ease-out",
            pointerEvents: chartSidebarOpen ? "auto" : "none",
            overflow: "visible",
            background: C.bg,
            zIndex: chartSidebarMobile ? 80 : 2,
          }}
        >
          {chartSidebarOpen && activeChartSensor ? (
            <>
              <button
                type="button"
                className="dc-chart-panel-toggle"
                aria-label={chartSidebarMobile ? "Đóng biểu đồ" : "Thu gọn biểu đồ"}
                title={chartSidebarMobile ? "Đóng biểu đồ" : "Thu gọn biểu đồ"}
                onClick={() => setChartSidebarCollapsed(true)}
                style={{
                  width: 34,
                  height: 34,
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
                <PanelRightClose size={14} strokeWidth={2.2} />
              </button>

              {!chartSidebarStacked && !chartSidebarMobile ? (
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

              <Suspense fallback={<div className="dc-chart-panel-loading" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.76rem" }}><span style={{ width: 18, height: 18, marginRight: 8, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "webSpin 0.8s linear infinite" }} />Đang mở biểu đồ...</div>}>
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
                    setChartSidebarCollapsed(true);
                    setChartSidebarResizing(false);
                  }}
                  pinned
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
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, background: "rgba(2,6,23,0.24)" }}>Đang tải...</div>}>
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
