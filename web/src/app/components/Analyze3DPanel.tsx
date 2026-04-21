import { useEffect, useMemo, useState } from "react";
import { Box, ChevronDown } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { Accel3DCanvas, Accel3DPoint } from "./SensorChartModal";
import { ConsoleEmptyState, ConsolePage, ConsolePageHeader, ConsolePanel } from "./ui";

const GRAVITY_MS2 = 9.80665;
const TELEMETRY_HISTORY_BUFFER_SIZE = 200;

type TelemetryHistoryRequestOptions = {
  limit?: number;
  from?: string;
  to?: string;
  force?: boolean;
};

interface Analyze3DPanelProps {
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
  onRequestTelemetryHistory: (deviceId: string, options?: TelemetryHistoryRequestOptions) => Promise<void>;
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

    void onRequestTelemetryHistory(selectedSensor.id, { limit: TELEMETRY_HISTORY_BUFFER_SIZE });
    const interval = window.setInterval(() => {
      void onRequestTelemetryHistory(selectedSensor.id, { limit: TELEMETRY_HISTORY_BUFFER_SIZE });
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
    <ConsolePage
      className="flex-1 overflow-auto px-6 py-5"
      style={{
        background: C.bg,
      }}
    >
      <ConsolePageHeader
        icon={<Box size={16} strokeWidth={2.2} />}
        title="Không gian 3D gia tốc (độc lập)"
        subtitle="Xem quỹ đạo gia tốc theo từng thiết bị ở chế độ 3D."
        actions={
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
        }
      />

      <ConsolePanel
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          padding: 12,
        }}
      >
        {loading && accelPoints.length === 0 ? (
          <ConsoleEmptyState title="Đang tải dữ liệu 3D..." className="h-[460px]" />
        ) : accelPoints.length === 0 ? (
          <ConsoleEmptyState
            icon={<Box size={24} strokeWidth={1.8} />}
            title="Chưa có đủ dữ liệu gia tốc."
            description="Khi thiết bị gửi dữ liệu, quỹ đạo 3D sẽ hiển thị tại đây."
            className="h-[460px]"
          />
        ) : (
          <Accel3DCanvas C={C} accelPoints={accelPoints} height={460} />
        )}
      </ConsolePanel>
    </ConsolePage>
  );
}
