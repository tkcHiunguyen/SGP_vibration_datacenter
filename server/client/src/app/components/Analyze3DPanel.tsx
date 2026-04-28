import { Box } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import type { DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { MotorSceneCanvas } from "./MotorSceneCanvas";
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

export function Analyze3DPanel(_: Analyze3DPanelProps) {
  const { C } = useTheme();

  return (
    <ConsolePage
      className="flex-1 overflow-auto px-6 py-5"
      style={{
        background: C.bg,
      }}
    >
      <ConsolePageHeader icon={<Box size={16} strokeWidth={2.2} />} title="Mô hình 3D motor" />

      <ConsolePanel
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          padding: 12,
        }}
      >
        <MotorSceneCanvas className="motor-scene-canvas--panel" />
      </ConsolePanel>
    </ConsolePage>
  );
}
