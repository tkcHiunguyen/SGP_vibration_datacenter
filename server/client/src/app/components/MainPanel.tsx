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

const ThresholdAnalysisPage = lazy(() =>
  import("./ThresholdAnalysisPage").then((module) => ({
    default: module.ThresholdAnalysisPage,
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
    <main className="dc-main-panel" style={{ background: C.bg }}>
      {isDashboard ? (
        <div className="dc-dashboard-canvas flex flex-col overflow-hidden">
          <h1 className="sr-only">Tổng quan</h1>
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
        <div className="dc-page-scroll" style={{ scrollbarColor: `${C.scrollbar} transparent` }}>
          <Suspense fallback={panelFallback}>
            <ZoneManagement onNotify={onNotify} />
          </Suspense>
        </div>
      ) : activeNav === "Update Center" ? (
        <div className="dc-page-scroll" style={{ scrollbarColor: `${C.scrollbar} transparent` }}>
          <Suspense fallback={panelFallback}>
            <OtaManagement />
          </Suspense>
        </div>
      ) : activeNav === "Phân tích" ? (
        <div className="dc-page-scroll" style={{ scrollbarColor: `${C.scrollbar} transparent` }}>
          <Suspense fallback={panelFallback}>
            <ThresholdAnalysisPage
              sensors={sensors}
              onNotify={onNotify}
              onSensorUpdated={onSensorUpdated}
            />
          </Suspense>
        </div>
      ) : activeNav === "Cài đặt" ? (
        <div className="dc-page-scroll" style={{ scrollbarColor: `${C.scrollbar} transparent` }}>
          <Suspense fallback={panelFallback}>
            <SettingsPage />
          </Suspense>
        </div>
      ) : (
        <UnderDevelopment page={activeNav} />
      )}
    </main>
  );
}
