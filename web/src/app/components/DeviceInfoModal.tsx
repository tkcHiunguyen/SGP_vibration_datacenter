import React, { useEffect, useState } from "react";
import { X, Cpu, MapPin, Wifi, WifiOff, Calendar, Activity, AlertTriangle, Radio, Server, Clock3 } from "lucide-react";
import { Sensor } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";

interface DeviceInfoModalProps {
  sensor: Sensor | null;
  onClose: () => void;
}

function PropRow({ icon, label, value, valueColor }: { icon: React.ReactNode; label: string; value: string; valueColor?: string }) {
  const { C } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: C.textMuted }}>{icon}</span>
        <span style={{ color: C.textBase, fontSize: "0.77rem" }}>{label}</span>
      </div>
      <span style={{ color: valueColor ?? C.textBright, fontSize: "0.77rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

export function DeviceInfoModal({ sensor, onClose }: DeviceInfoModalProps) {
  const { C } = useTheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sensor) { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }
    else { setVisible(false); }
  }, [sensor]);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 220); };

  if (!sensor) return null;
  const isOnline   = sensor.online;
  const isAbnormal = sensor.status === "abnormal";

  return (
    <>
      {/* Backdrop */}
      <div onClick={handleClose} style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)",
        opacity: visible ? 1 : 0, transition: "opacity 0.22s ease",
      }} />

      {/* Modal */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 51,
        transform: visible ? "translate(-50%,-50%) scale(1)" : "translate(-50%,-48%) scale(0.97)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.22s cubic-bezier(0.32,0.72,0,1), opacity 0.22s ease",
        width: 390, background: C.surface,
        border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "16px 18px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: C.textMuted, fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 5 }}>
              <Cpu size={10} strokeWidth={2} /> Thuộc tính thiết bị
            </div>
            <div style={{ color: C.textBright, fontSize: "0.93rem", fontWeight: 700 }}>{sensor.name}</div>
            <div style={{ color: C.textMuted, fontSize: "0.68rem", marginTop: 2 }}>{sensor.id} · {sensor.zone}</div>
          </div>
          <button onClick={handleClose} style={{ width: 26, height: 26, borderRadius: 7, background: C.surface, border: `1px solid ${C.border}`, cursor: "pointer", flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={11} color={C.textMuted} strokeWidth={2} />
          </button>
        </div>

        {/* Status badges */}
        <div style={{ display: "flex", gap: 6, padding: "10px 18px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: isOnline ? C.primaryBg : "#6b728012", border: `1px solid ${isOnline ? C.primary + "28" : "#6b728028"}` }}>
            {isOnline ? <Wifi size={10} color={C.success} strokeWidth={2} /> : <WifiOff size={10} color="#6b7280" strokeWidth={2} />}
            <span style={{ color: isOnline ? C.success : "#6b7280", fontSize: "0.65rem", fontWeight: 600 }}>{isOnline ? "Trực tuyến" : "Ngoại tuyến"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: isAbnormal ? C.dangerBg : C.primaryBg, border: `1px solid ${isAbnormal ? C.danger + "28" : C.primary + "28"}` }}>
            {isAbnormal ? <AlertTriangle size={10} color={C.danger} strokeWidth={2} /> : <Activity size={10} color={C.success} strokeWidth={2} />}
            <span style={{ color: isAbnormal ? C.danger : C.success, fontSize: "0.65rem", fontWeight: 600 }}>{isAbnormal ? "Bất thường" : "Bình thường"}</span>
          </div>
        </div>

        {/* Props */}
        <div style={{ padding: "4px 18px 6px" }}>
          <PropRow icon={<Server   size={12} strokeWidth={2} />} label="UUID"               value={sensor.uuid}                    />
          <PropRow icon={<MapPin   size={12} strokeWidth={2} />} label="Site"               value={sensor.site}                    />
          <PropRow icon={<MapPin   size={12} strokeWidth={2} />} label="Zone"               value={sensor.zone}                    />
          <PropRow icon={<Cpu      size={12} strokeWidth={2} />} label="Sensor Version"     value={sensor.sensorVersion}           />
          <PropRow icon={<Cpu      size={12} strokeWidth={2} />} label="Firmware Version"   value={sensor.firmwareVersion}         />
          <PropRow icon={<Radio    size={12} strokeWidth={2} />} label="Signal"             value={sensor.signal}                  valueColor={C.primary} />
          <PropRow icon={<Clock3   size={12} strokeWidth={2} />} label="Uptime"             value={sensor.uptime}                  />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: C.textMuted }}><Calendar size={12} strokeWidth={2} /></span>
              <span style={{ color: C.textBase, fontSize: "0.77rem" }}>Connected At</span>
            </div>
            <span style={{ color: C.textBright, fontSize: "0.77rem", fontWeight: 600 }}>{sensor.connectedAt}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: C.textMuted }}><Calendar size={12} strokeWidth={2} /></span>
              <span style={{ color: C.textBase, fontSize: "0.77rem" }}>Last Heartbeat</span>
            </div>
            <span style={{ color: C.textBright, fontSize: "0.77rem", fontWeight: 600 }}>{sensor.lastHeartbeatAt}</span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: C.card, borderTop: `1px solid ${C.border}`, padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: C.textMuted, fontSize: "0.67rem" }}>Cập nhật {sensor.lastUpdated} phút trước</span>
          <button onClick={handleClose} style={{ height: 28, padding: "0 14px", borderRadius: 7, background: C.surface, border: `1px solid ${C.border}`, color: C.textBase, fontSize: "0.72rem", fontWeight: 500, cursor: "pointer" }}>
            Đóng
          </button>
        </div>
      </div>
    </>
  );
}
