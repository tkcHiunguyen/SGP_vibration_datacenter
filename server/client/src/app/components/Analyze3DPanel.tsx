import { Box, Database } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import type { DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { MotorSceneCanvas } from "./MotorSceneCanvas";
import { MotorMockDataPanel } from "./MotorMockDataPanel";
import { ConsolePage, ConsolePageHeader, ConsolePanel } from "./ui";

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
}: Analyze3DPanelProps) {
  const { C } = useTheme();

  return (
    <ConsolePage
      className="flex-1 overflow-auto px-6 py-5"
      style={{
        background: C.bg,
      }}
    >
      <ConsolePageHeader
        icon={<Box size={17} strokeWidth={2.2} />}
        title="Phân tích Digital Twin"
        subtitle="Bước 1: dựng vùng mock data để chọn thiết bị, chọn khoảng thời gian và xem vị trí ghi nhận trước khi nối API thật."
        actions={(
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1"
            style={{ borderColor: `${C.primary}55`, background: C.primaryBg, color: C.primary, fontSize: "0.64rem", fontWeight: 900 }}
          >
            <Database size={12} /> Mock first
          </span>
        )}
      />

      <div className="analyze-digital-twin-layout">
        <ConsolePanel
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            padding: 12,
          }}
        >
          <MotorSceneCanvas className="motor-scene-canvas--panel" />
        </ConsolePanel>

        <MotorMockDataPanel
          sensors={sensors}
          telemetryByDevice={telemetryByDevice}
          telemetryLoadingByDevice={telemetryLoadingByDevice}
        />
      </div>
    </ConsolePage>
  );
}
