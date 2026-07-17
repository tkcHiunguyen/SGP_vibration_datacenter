import { lazy, Suspense } from "react";
import { useTheme } from "../context/ThemeContext";
import { DeviceManagement } from "./DeviceManagement";
import { UnderDevelopment } from "./UnderDevelopment";
import { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor } from "../data/sensors";
import type { ToastItem } from "./ui";

const ZoneManagement = lazy(() =>
  import("./ZoneManagement").then((module) => ({
    default: module.ZoneManagement,
  })),
);

const OtaManagement = lazy(() =>
  import("./OtaManagement").then((module) => ({
    default: module.OtaManagement,
  })),
);

const SettingsPage = lazy(() =>
  import("./SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

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
  onChartClosed?: (deviceId: string) => void;
  onSensorUpdated?: (sensor: Sensor) => void;
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
  onChartClosed,
  onSensorUpdated,
}: MainPanelProps) {
  const { C } = useTheme();

  const isDashboard = activeNav === "Tổng quan";
  const panelFallback = (
    <div
      style={{
        flex: 1,
        background: C.bg,
      }}
    />
  );

  return (
    <main style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: C.bg, minWidth: 0, overflow: "hidden",
    }}>
      {isDashboard ? (
        <div style={{
          width: "min(100%, var(--dc-content-max))",
          margin: "0 auto",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: "0 var(--dc-page-gutter) var(--dc-page-bottom)",
        }}>
          <DeviceManagement
            sensors={sensors}
            telemetryByDevice={telemetryByDevice}
            telemetryLoadingByDevice={telemetryLoadingByDevice}
            spectrumByDevice={spectrumByDevice}
            onRequestTelemetryHistory={onRequestTelemetryHistory}
            onNotify={onNotify}
            onDeviceDataCleared={onDeviceDataCleared}
            onChartClosed={onChartClosed}
            onSensorUpdated={onSensorUpdated}
          />
        </div>
      ) : activeNav === "Quản lý khu vực" ? (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "22px var(--dc-page-gutter) var(--dc-page-bottom)",
            scrollbarWidth: "thin",
            scrollbarColor: `${C.scrollbar} transparent`,
          }}
        >
          <Suspense fallback={panelFallback}>
            <ZoneManagement onNotify={onNotify} />
          </Suspense>
        </div>
      ) : activeNav === "Update Center" ? (
        <Suspense fallback={panelFallback}>
          <OtaManagement />
        </Suspense>
      ) : activeNav === "Cài đặt" ? (
        <Suspense fallback={panelFallback}>
          <SettingsPage />
        </Suspense>
      ) : (
        <UnderDevelopment page={activeNav} />
      )}
    </main>
  );
}
