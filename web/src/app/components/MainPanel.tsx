import React from "react";
import { useTheme } from "../context/ThemeContext";
import { DeviceManagement } from "./DeviceManagement";
import { UnderDevelopment } from "./UnderDevelopment";
import { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor } from "../data/sensors";
import { Analyze3DPanel } from "./Analyze3DPanel";
import { ZoneManagement } from "./ZoneManagement";
import { OtaManagement } from "./OtaManagement";
import type { ToastItem } from "./ui";

type TelemetryHistoryRequestOptions = {
  limit?: number;
  from?: string;
  to?: string;
  force?: boolean;
};

interface MainPanelProps {
  activeNav: string;
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
  spectrumByDevice: Record<string, DeviceSpectrumPoint[]>;
  onRequestTelemetryHistory: (deviceId: string, options?: TelemetryHistoryRequestOptions) => Promise<void>;
  onNotify: (message: Omit<ToastItem, "id">) => void;
  onDeviceDataCleared: (deviceId: string) => void;
}

export function MainPanel({
  activeNav,
  sensors,
  telemetryByDevice,
  telemetryLoadingByDevice,
  spectrumByDevice,
  onRequestTelemetryHistory,
  onNotify,
  onDeviceDataCleared,
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
            spectrumByDevice={spectrumByDevice}
            onRequestTelemetryHistory={onRequestTelemetryHistory}
            onNotify={onNotify}
            onDeviceDataCleared={onDeviceDataCleared}
          />
        </div>
      ) : activeNav === "Quản lý khu vực" ? (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "22px 26px 32px",
            scrollbarWidth: "thin",
            scrollbarColor: `${C.scrollbar} transparent`,
          }}
        >
          <ZoneManagement onNotify={onNotify} />
        </div>
      ) : activeNav === "Update Center" ? (
        <OtaManagement />
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
