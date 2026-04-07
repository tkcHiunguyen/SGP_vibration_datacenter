import React from "react";
import { useTheme } from "../context/ThemeContext";
import { DeviceManagement } from "./DeviceManagement";
import { UnderDevelopment } from "./UnderDevelopment";
import { DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { Analyze3DPanel } from "./Analyze3DPanel";

interface MainPanelProps {
  activeNav: string;
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
  onRequestTelemetryHistory: (deviceId: string, limit?: number) => Promise<void>;
}

export function MainPanel({
  activeNav,
  sensors,
  telemetryByDevice,
  telemetryLoadingByDevice,
  onRequestTelemetryHistory,
}: MainPanelProps) {
  const { C } = useTheme();

  const isDashboard = activeNav === "Tổng quan";

  return (
    <main style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: C.bg, minWidth: 0, overflow: "hidden",
    }}>
      {isDashboard ? (
        <div style={{
          flex: 1, overflowY: "auto", padding: "22px 26px 32px",
          scrollbarWidth: "thin",
          scrollbarColor: `${C.scrollbar} transparent`,
        }}>
          <DeviceManagement
            sensors={sensors}
            telemetryByDevice={telemetryByDevice}
            telemetryLoadingByDevice={telemetryLoadingByDevice}
            onRequestTelemetryHistory={onRequestTelemetryHistory}
          />
        </div>
      ) : activeNav === "Phân tích" ? (
        <Analyze3DPanel
          sensors={sensors}
          telemetryByDevice={telemetryByDevice}
          telemetryLoadingByDevice={telemetryLoadingByDevice}
          onRequestTelemetryHistory={onRequestTelemetryHistory}
        />
      ) : (
        <UnderDevelopment page={activeNav} />
      )}
    </main>
  );
}
