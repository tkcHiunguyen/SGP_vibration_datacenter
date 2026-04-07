import { useEffect, useMemo, useState } from "react";
import { Box, ChevronDown } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { Accel3DCanvas, Accel3DPoint } from "./SensorChartModal";

const GRAVITY_MS2 = 9.80665;
const TELEMETRY_HISTORY_BUFFER_SIZE = 400;

interface Analyze3DPanelProps {
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
  onRequestTelemetryHistory: (deviceId: string, limit?: number) => Promise<void>;
}

export function Analyze3DPanel({
  sensors,
  telemetryByDevice,
  telemetryLoadingByDevice,
  onRequestTelemetryHistory,
}: Analyze3DPanelProps) {
  const { C } = useTheme();
  const [selectedSensorId, setSelectedSensorId] = useState<string>("");

  useEffect(() => {
    if (sensors.length === 0) {
      return;
    }
    if (selectedSensorId && sensors.some((sensor) => sensor.id === selectedSensorId)) {
      return;
    }
    const defaultSensor = sensors.find((sensor) => sensor.online) ?? sensors[0];
    setSelectedSensorId(defaultSensor.id);
  }, [selectedSensorId, sensors]);

  const selectedSensor = useMemo(
    () => sensors.find((sensor) => sensor.id === selectedSensorId) ?? null,
    [selectedSensorId, sensors],
  );

  useEffect(() => {
    if (!selectedSensor) {
      return;
    }

    void onRequestTelemetryHistory(selectedSensor.id, TELEMETRY_HISTORY_BUFFER_SIZE);
    const interval = window.setInterval(() => {
      void onRequestTelemetryHistory(selectedSensor.id, TELEMETRY_HISTORY_BUFFER_SIZE);
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedSensor, onRequestTelemetryHistory]);

  const accelPoints = useMemo<Accel3DPoint[]>(() => {
    if (!selectedSensor) {
      return [];
    }

    const rows = telemetryByDevice[selectedSensor.id] || [];
    return rows
      .filter(
        (row) =>
          typeof row.ax === "number" &&
          typeof row.ay === "number" &&
          typeof row.az === "number",
      )
      .map((row) => ({
        ts: Date.parse(row.receivedAt),
        ax: Number(((row.ax as number) * GRAVITY_MS2).toFixed(4)),
        ay: Number(((row.ay as number) * GRAVITY_MS2).toFixed(4)),
        az: Number(((row.az as number) * GRAVITY_MS2).toFixed(4)),
      }))
      .filter((row) => Number.isFinite(row.ts));
  }, [selectedSensor, telemetryByDevice]);

  const loading = selectedSensor ? Boolean(telemetryLoadingByDevice[selectedSensor.id]) : false;

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        minWidth: 0,
        overflow: "auto",
        padding: "20px 24px 26px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ color: C.textMuted, fontSize: "0.66rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
            Analyze
          </div>
          <div style={{ color: C.textBright, fontSize: "1rem", fontWeight: 700 }}>
            Không gian 3D gia tốc (độc lập)
          </div>
        </div>

        <div style={{ position: "relative", minWidth: 260 }}>
          <select
            value={selectedSensorId}
            onChange={(event) => setSelectedSensorId(event.target.value)}
            style={{
              width: "100%",
              height: 34,
              borderRadius: 9,
              background: C.card,
              border: `1px solid ${C.cardBorder}`,
              color: C.textBase,
              fontSize: "0.75rem",
              padding: "0 30px 0 10px",
              appearance: "none",
              cursor: "pointer",
            }}
          >
            {sensors.map((sensor) => (
              <option key={sensor.id} value={sensor.id}>
                {sensor.name} ({sensor.id})
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            color={C.textMuted}
            strokeWidth={2}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          />
        </div>
      </div>

      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 12,
        }}
      >
        {loading && accelPoints.length === 0 ? (
          <div style={{ height: 460, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.8rem" }}>
            Đang tải dữ liệu 3D...
          </div>
        ) : accelPoints.length === 0 ? (
          <div style={{ height: 460, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textMuted }}>
            <Box size={24} strokeWidth={1.8} />
            <div style={{ fontSize: "0.8rem" }}>Chưa có đủ dữ liệu gia tốc để dựng quỹ đạo 3D.</div>
          </div>
        ) : (
          <Accel3DCanvas C={C} accelPoints={accelPoints} height={460} />
        )}
      </div>
    </main>
  );
}

