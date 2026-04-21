import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Info, Search, AlertTriangle, CheckCircle2,
  Wifi, WifiOff, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight,
  Activity, Cpu, Layers, MapPin, ArrowUpAZ, Hash, CircleDot, Filter, Radio, Globe, X, ExternalLink, PencilLine, Trash2,
} from "lucide-react";
import { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { DeviceInfoModal } from "./DeviceInfoModal";
import { SensorChartModal } from "./SensorChartModal";
import { ConsoleStatCard, type ToastItem } from "./ui";
import { useTheme } from "../context/ThemeContext";

/* ── Device Card ── */
function DeviceCard({
  sensor,
  idx,
  onInfo,
  onChart,
  onOpenWeb,
  onContextMenu,
  exiting,
}: {
  sensor: Sensor;
  idx: number;
  onInfo: (s: Sensor) => void;
  onChart: (s: Sensor) => void;
  onOpenWeb: (s: Sensor) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, sensor: Sensor) => void;
  exiting?: boolean;
}) {
  const { C } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [infoHovered, setInfoHovered] = useState(false);
  const [webHovered, setWebHovered] = useState(false);
  const [cardTooltipPosition, setCardTooltipPosition] = useState({ x: 8, y: 8 });
  const isOnline   = sensor.online;
  const isAbnormal = sensor.status === "abnormal";
  const accentColor = !isOnline ? "#4b5563" : isAbnormal ? C.danger : C.success;
  const hasWebTarget = sensor.ipAddress !== "N/A" && sensor.ipAddress.trim() !== "";
  const cardAnimation = exiting
    ? "cardOut 260ms cubic-bezier(0.22, 0.78, 0.3, 1) both"
    : "cardIn 0.3s ease both";

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${hovered ? accentColor + "55" : C.cardBorder}`,
        position: "relative",
        borderRadius: 12, overflow: "hidden",
        transition: "border-color 0.2s, box-shadow 0.2s, transform 0.15s, opacity 0.2s",
        boxShadow: hovered && !exiting ? `0 6px 24px ${accentColor}18` : "none",
        transform: hovered && !exiting ? "translateY(-1px)" : "translateY(0)",
        cursor: "pointer",
        animation: cardAnimation,
        animationDelay: exiting ? "0s" : `${Math.min(idx * 0.04, 0.4)}s`,
        display: "flex", flexDirection: "column",
        pointerEvents: exiting ? "none" : "auto",
      }}
      onMouseEnter={() => {
        if (!exiting) {
          setHovered(true);
        }
      }}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={(event) => {
        if (exiting) {
          return;
        }
        const cardRect = event.currentTarget.getBoundingClientRect();
        const tooltipWidth = 104;
        const tooltipHeight = 24;
        const offsetX = 12;
        const offsetY = 14;
        const localX = event.clientX - cardRect.left + offsetX;
        const localY = event.clientY - cardRect.top + offsetY;
        const nextX = Math.max(8, Math.min(localX, cardRect.width - tooltipWidth - 8));
        const nextY = Math.max(8, Math.min(localY, cardRect.height - tooltipHeight - 8));
        setCardTooltipPosition({
          x: nextX,
          y: nextY,
        });
      }}
      onClick={() => {
        if (!exiting) {
          onChart(sensor);
        }
      }}
      onContextMenu={(event) => onContextMenu(event, sensor)}
    >
      {/* Top accent strip */}
      <div style={{
        height: 3, flexShrink: 0,
        background: accentColor,
        opacity: isOnline ? 1 : 0.4,
        boxShadow: isOnline ? `0 0 8px ${accentColor}77` : "none",
        animation: isOnline && isAbnormal ? "stripPulse 2s ease-in-out infinite" : "none",
      }} />

      <div style={{ padding: "12px 13px 13px", display: "flex", flexDirection: "column", flex: 1 }}>
        {/* ID + info btn */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: C.textDim, fontSize: "0.6rem", letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 600 }}>
            {sensor.id}
          </span>
          <div style={{ position: "relative" }}>
            <button
              onClick={(e) => { e.stopPropagation(); onInfo(sensor); }}
              title="Thuộc tính thiết bị"
              onMouseEnter={() => setInfoHovered(true)}
              onMouseLeave={() => setInfoHovered(false)}
              style={{
                width: 22, height: 22, borderRadius: 6,
                background: hovered ? C.surface : "transparent",
                border: `1px solid ${hovered ? C.border : "transparent"}`,
                cursor: "pointer", transition: "all 0.12s",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Info size={11} color={hovered ? C.primary : C.textMuted} strokeWidth={2} />
            </button>
            <div
              style={{
                position: "absolute",
                right: "calc(100% + 6px)",
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
                fontSize: "0.62rem",
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 6,
                whiteSpace: "nowrap",
                zIndex: 5,
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              }}
            >
              Thông tin
            </div>
          </div>
        </div>

        {/* Name */}
        <div style={{ color: C.textBright, fontSize: "0.84rem", fontWeight: 700, lineHeight: 1.3, marginBottom: 3 }}>
          {sensor.name}
        </div>

        {/* Zone + Firmware */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div style={{ color: C.textMuted, fontSize: "0.67rem", minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
            {sensor.zone}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 6px", borderRadius: 5,
            background: C.surface, border: `1px solid ${C.border}`,
            color: C.textBase, fontSize: "0.62rem", fontWeight: 500,
            flexShrink: 0,
          }}>
            <Cpu size={9} strokeWidth={2} />
            {sensor.firmwareVersion}
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            color: C.textMuted,
            fontSize: "0.62rem",
            marginBottom: 8,
          }}
        >
          <Radio size={10} strokeWidth={2} />
          IP: {sensor.ipAddress}
        </div>

        {/* Bottom row: web access + online status */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ position: "relative" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasWebTarget) {
                  onOpenWeb(sensor);
                }
              }}
              onMouseEnter={() => setWebHovered(true)}
              onMouseLeave={() => setWebHovered(false)}
              disabled={!hasWebTarget}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                border: `1px solid ${hasWebTarget ? C.cardBorder : C.border}`,
                background: hasWebTarget ? C.surface : "transparent",
                color: hasWebTarget ? C.primary : C.textDim,
                cursor: hasWebTarget ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Globe size={12} strokeWidth={2} />
            </button>
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: "calc(100% + 6px)",
                transform: webHovered ? "translateY(0)" : "translateY(2px)",
                opacity: webHovered ? 1 : 0,
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
              {hasWebTarget ? "Truy cập thiết bị" : "Thiết bị chưa có IP"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            {/* Online/Offline */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: isOnline ? C.success : "#4b5563",
                boxShadow: isOnline ? `0 0 5px ${C.success}88` : "none",
                animation: isOnline ? "dotPulse 2.5s ease-in-out infinite" : "none",
              }} />
              <span style={{ color: isOnline ? C.success : "#4b5563", fontSize: "0.64rem", fontWeight: 600 }}>
                {isOnline ? "Trực tuyến" : "Ngoại tuyến"}
              </span>
            </div>

            {/* Normal/Abnormal */}
            {isOnline && (
              <div style={{
                display: "flex", alignItems: "center", gap: 3,
                padding: "2px 6px", borderRadius: 20,
                background: isAbnormal ? C.dangerBg : C.primaryBg,
                border: `1px solid ${isAbnormal ? C.danger + "30" : C.primary + "30"}`,
              }}>
                {isAbnormal
                  ? <AlertTriangle  size={9} color={C.danger}  strokeWidth={2} />
                  : <CheckCircle2   size={9} color={C.primary} strokeWidth={2} />}
                <span style={{ color: isAbnormal ? C.danger : C.primary, fontSize: "0.6rem", fontWeight: 600 }}>
                  {isAbnormal ? "Bất thường" : "Bình thường"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: cardTooltipPosition.x,
          top: cardTooltipPosition.y,
          pointerEvents: "none",
          opacity: hovered && !exiting ? 1 : 0,
          transform: hovered ? "translateY(0)" : "translateY(2px)",
          transition: "opacity 0.14s ease, transform 0.14s ease",
          background: C.surface,
          border: `1px solid ${C.border}`,
          color: C.textBase,
          fontSize: "0.62rem",
          fontWeight: 600,
          padding: "2px 7px",
          borderRadius: 6,
          whiteSpace: "nowrap",
          zIndex: 20,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}
      >
        Xem lịch sử
      </div>
    </div>
  );
}

/* ── Sort dropdown ── */
type SortKey = "status" | "zone" | "name-az" | "device-id";
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

function DeviceWebModal({ sensor, onClose }: { sensor: Sensor | null; onClose: () => void }) {
  const { C } = useTheme();
  const [mountFrame, setMountFrame] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  const sensorId = sensor?.id ?? "";
  const hasWebTarget = Boolean(sensor && sensor.ipAddress !== "N/A" && sensor.ipAddress.trim() !== "");
  const webUrl = sensor
    ? /^https?:\/\//i.test(sensor.ipAddress)
      ? sensor.ipAddress
      : `http://${sensor.ipAddress}`
    : "";

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
}

const STORAGE_PAGE_KEY = "sgp_ui_devices_page";
const STORAGE_PAGE_SIZE_KEY = "sgp_ui_devices_page_size";
const DEVICE_CARD_EXIT_MS = 260;

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
}: DeviceManagementProps) {
  const { C } = useTheme();
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const [selectedSensorMode, setSelectedSensorMode] = useState<DeviceInfoMode>("view");
  const [chartSensor, setChartSensor] = useState<Sensor | null>(null);
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
  const [sort, setSort]     = useState<SortKey>("status");
  const [sortIconHovered, setSortIconHovered] = useState(false);
  const [page, setPage] = useState(() => readStoredNumber(STORAGE_PAGE_KEY, 1));
  const [pageSize, setPageSize] = useState(() => {
    const stored = readStoredNumber(STORAGE_PAGE_SIZE_KEY, 20);
    return [10, 20, 50, 100, 200].includes(stored) ? stored : 20;
  });
  const [pageInput, setPageInput] = useState(() => String(readStoredNumber(STORAGE_PAGE_KEY, 1)));
  const didMountRef = useRef(false);
  const exitTimeoutsRef = useRef<Record<string, number>>({});

  const visibleSensors = useMemo(
    () => sensors.filter((sensor) => !hiddenDeviceIds.has(sensor.id)),
    [sensors, hiddenDeviceIds],
  );

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

  const displayed = useMemo(() => {
    let list = visibleSensors.filter(s => {
      const q = search.toLowerCase();
      const matchSearch = s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.zone.toLowerCase().includes(q);
      const matchFilter =
        filter === "all" ? true :
        filter === "online"   ? s.online :
        filter === "offline"  ? !s.online :
        s.status === "abnormal";
      return matchSearch && matchFilter;
    });

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
        list = [...list].sort((a, b) => a.zone.localeCompare(b.zone, "vi"));
        break;
      case "device-id":
        list = [...list].sort((a, b) => a.id.localeCompare(b.id, "vi"));
        break;
    }
    return list;
  }, [visibleSensors, search, filter, sort]);

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
  const pagedDevices = displayed.slice(pageStart, pageEnd);

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
    return () => {
      Object.values(exitTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      exitTimeoutsRef.current = {};
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

      {/* ── Stat summary row ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h2 style={{ color: C.textBright, fontSize: "1rem", fontWeight: 700, marginBottom: 2 }}>
            Quản lý thiết bị
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            height: 32, padding: "0 10px", borderRadius: 8, width: 190,
            background: C.card, border: `1px solid ${C.cardBorder}`,
          }}>
            <Search size={12} color={C.textMuted} strokeWidth={2} />
            <input
              type="text" placeholder="Tìm theo tên, ID, khu vực…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ background: "transparent", border: "none", outline: "none", color: C.textBright, fontSize: "0.72rem", flex: 1 }}
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
            }}
          >
            <div
              style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
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
            <div style={{ width: 1, height: 16, background: C.border }} />
            <SortDropdown value={sort} onChange={setSort} />
          </div>
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <div style={{ color: C.textMuted, fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Bộ lọc nhanh
        </div>
        <div style={{ color: C.textMuted, fontSize: "0.72rem", fontWeight: 600, textAlign: "right" }}>
          Hiển thị {pagedDevices.length} / {displayed.length} thiết bị
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTERS.map(f => {
          const isActive = filter === f.key;
          const dotColor = f.key === "online" ? C.success : f.key === "offline" ? "#6b7280" : f.key === "abnormal" ? C.danger : C.primary;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
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

      {/* ── Card Grid ── */}
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
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: 10,
          }}>
            {pagedDevices.map((sensor, idx) => (
              <DeviceCard
                key={sensor.id}
                sensor={sensor}
                idx={idx}
                exiting={exitingDeviceIds.has(sensor.id)}
                onInfo={(target) => openDeviceInfo(target, "view")}
                onChart={(target) => {
                  closeContextMenu();
                  setChartSensor(target);
                }}
                onOpenWeb={(target) => {
                  closeContextMenu();
                  setWebSensor(target);
                }}
                onContextMenu={openDeviceContextMenu}
              />
            ))}
          </div>

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

      <DeviceInfoModal
        sensor={selectedSensor}
        initialMode={selectedSensorMode}
        onClose={() => {
          setSelectedSensor(null);
          setSelectedSensorMode("view");
        }}
        onSensorUpdated={(updated) => setSelectedSensor(updated)}
        onSensorDeleted={(deviceId) => {
          markDeviceExiting(deviceId);
          setSelectedSensor(null);
          setSelectedSensorMode("view");
        }}
        onNotify={onNotify}
      />
      <SensorChartModal
        sensor={chartSensor}
        telemetryPoints={chartSensor ? telemetryByDevice[chartSensor.id] || [] : []}
        telemetryLoading={chartSensor ? Boolean(telemetryLoadingByDevice[chartSensor.id]) : false}
        spectrumPoints={chartSensor ? spectrumByDevice[chartSensor.id] || [] : []}
        onRequestTelemetryHistory={onRequestTelemetryHistory}
        onNotify={onNotify}
        onDeviceDataCleared={onDeviceDataCleared}
        onClose={() => setChartSensor(null)}
      />
      <DeviceWebModal sensor={webSensor} onClose={() => setWebSensor(null)} />
    </>
  );
}
