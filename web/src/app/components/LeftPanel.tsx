import React from "react";
import { Activity, Wifi, WifiOff, AlertTriangle, X } from "lucide-react";
import { Sensor } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";

function KpiCard({ label, value, total, icon, accent }: {
  label: string; value: number; total: number;
  icon: React.ReactNode; accent: string;
}) {
  const { C } = useTheme();
  const pct = total > 0 ? (value / total) * 100 : 0;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.cardBorder}`,
      borderRadius: 10, padding: "11px 13px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: accent + "18", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <div>
          <div style={{ color: C.textMuted, fontSize: "0.57rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, lineHeight: 1 }}>
            {label}
          </div>
          <div style={{ color: C.textBright, fontSize: "1.45rem", fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {value}
          </div>
        </div>
      </div>
      {/* Mini progress bar */}
      <div style={{ height: 3, background: C.border, borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: accent, borderRadius: 99,
          transition: "width 0.6s ease",
          boxShadow: `0 0 6px ${accent}55`,
        }} />
      </div>
    </div>
  );
}

interface LeftPanelProps {
  sensors: Sensor[];
  signalAlerts?: Array<{
    id: string;
    deviceId: string;
    deviceName: string;
    signal: number;
    createdAt: string;
  }>;
  onDismissSignalAlert?: (alertId: string) => void;
}

export function LeftPanel({ sensors, signalAlerts = [], onDismissSignalAlert }: LeftPanelProps) {
  const { C } = useTheme();
  const total    = sensors.length;
  const online   = sensors.filter(s => s.online).length;
  const offline  = sensors.filter(s => !s.online).length;
  const abnormal = signalAlerts.length;
  const healthPercent = total > 0 ? Math.round(((total - abnormal) / total) * 100) : 0;
  const healthyCount = Math.max(0, total - abnormal);

  return (
    <aside style={{
      width: "100%", height: "100%",
      background: C.surface, borderRight: `1px solid ${C.border}`,
      padding: "18px 14px", display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ color: C.textDim, fontSize: "0.56rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>
        Tổng quan hệ thống
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <KpiCard label="Tổng thiết bị" value={total}    total={total}  icon={<Activity    size={13} strokeWidth={2} />} accent={C.primary}  />
        <KpiCard label="Trực tuyến"    value={online}   total={total}  icon={<Wifi        size={13} strokeWidth={2} />} accent={C.success}  />
        <KpiCard label="Ngoại tuyến"   value={offline}  total={total}  icon={<WifiOff     size={13} strokeWidth={2} />} accent="#6b7280"    />
        <KpiCard label="Cảnh báo"      value={abnormal} total={total}  icon={<AlertTriangle size={13} strokeWidth={2}/>} accent={C.danger}  />
      </div>

      {/* Health score */}
      <div style={{ margin: "16px 0 0", padding: "12px", background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ color: C.textMuted, fontSize: "0.62rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Sức khoẻ hệ thống
          </span>
          <span style={{ color: C.primary, fontSize: "0.82rem", fontWeight: 700 }}>
            {healthPercent}%
          </span>
        </div>
        <div style={{ height: 5, background: C.border, borderRadius: 99, overflow: "hidden" }}>
          <div style={{
            width: `${healthPercent}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${C.primaryDim}, ${C.primary})`,
            borderRadius: 99,
            boxShadow: `0 0 8px ${C.primary}44`,
            transition: "width 0.8s ease",
          }} />
        </div>
        <div style={{ color: C.textDim, fontSize: "0.63rem", marginTop: 5 }}>
          {healthyCount}/{total} thiết bị hoạt động bình thường
        </div>
      </div>

      <div style={{ height: 1, background: C.border, margin: "14px 0" }} />

      {/* Alert list */}
      <div style={{ color: C.textDim, fontSize: "0.56rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 9 }}>
        Cảnh báo RSSI
      </div>
      {signalAlerts.length === 0 ? (
        <div style={{ color: C.textMuted, fontSize: "0.68rem", marginBottom: 12 }}>
          Không có cảnh báo đang hoạt động.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 12, maxHeight: 140, overflowY: "auto", paddingRight: 2 }}>
          {signalAlerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                background: C.card,
                border: `1px solid ${C.danger}33`,
                borderRadius: 9,
                padding: "8px 8px 7px",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: C.textBright, fontSize: "0.68rem", fontWeight: 700, lineHeight: 1.3 }}>
                    {alert.deviceName}
                  </div>
                  <div style={{ color: C.danger, fontSize: "0.66rem", fontWeight: 700, lineHeight: 1.35 }}>
                    RSSI: {alert.signal} dBm
                  </div>
                  <div style={{ color: C.textDim, fontSize: "0.6rem", lineHeight: 1.3 }}>
                    {new Date(alert.createdAt).toLocaleString("vi-VN")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDismissSignalAlert?.(alert.id)}
                  title="Xoá cảnh báo"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: "transparent",
                    color: C.textMuted,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <X size={11} strokeWidth={2.2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 1, background: C.border, margin: "2px 0 12px" }} />

      {/* Legend */}
      <div style={{ color: C.textDim, fontSize: "0.56rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 9 }}>
        Chú thích trạng thái
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { color: C.success, glow: true,  label: "Bình thường" },
          { color: C.danger,  glow: true,  label: "Bất thường – cần kiểm tra" },
          { color: "#6b7280", glow: false, label: "Ngoại tuyến" },
        ].map(({ color, glow, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: color, flexShrink: 0,
              boxShadow: glow ? `0 0 5px ${color}88` : "none",
            }} />
            <span style={{ color: C.textBase, fontSize: "0.71rem" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
        <div style={{ color: C.textDim, fontSize: "0.62rem", textAlign: "center" }}>
          Đồng bộ · {new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      </div>
    </aside>
  );
}
