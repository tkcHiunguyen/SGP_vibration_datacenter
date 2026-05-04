import { useEffect, useMemo, useState } from "react";
import { Clock3, Database, Download, Gauge, MapPin, MousePointer2, Table2 } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import type { DeviceTelemetryPoint, Sensor } from "../data/sensors";
import {
  MOCK_MOTOR_TWINS,
  buildMockMotorPositionSamples,
  type MotorPositionSample,
  type MotorTwin,
} from "../data/motorTwins";
import { ConsoleButton, ConsolePanel } from "./ui";

type TimeRangePresetKey = "1h" | "6h" | "12h" | "1d" | "3d";

type TimeRangePreset = {
  key: TimeRangePresetKey;
  label: string;
  windowMs: number;
};

type DeviceOption = {
  id: string;
  name: string;
  zone: string;
  site: string;
  online: boolean;
  twin: MotorTwin;
};

type MotorMockDataPanelProps = {
  sensors: Sensor[];
  telemetryByDevice: Record<string, DeviceTelemetryPoint[]>;
  telemetryLoadingByDevice: Record<string, boolean>;
};

const TIME_RANGE_PRESETS: TimeRangePreset[] = [
  { key: "1h", label: "1 giờ", windowMs: 60 * 60 * 1000 },
  { key: "6h", label: "6 giờ", windowMs: 6 * 60 * 60 * 1000 },
  { key: "12h", label: "12 giờ", windowMs: 12 * 60 * 60 * 1000 },
  { key: "1d", label: "1 ngày", windowMs: 24 * 60 * 60 * 1000 },
  { key: "3d", label: "3 ngày", windowMs: 3 * 24 * 60 * 60 * 1000 },
];

const DEFAULT_TIME_PRESET = TIME_RANGE_PRESETS[1];

function formatDateTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "--";
  }

  return new Date(parsed).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value: number) {
  return value.toLocaleString("vi-VN", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function buildDeviceOptions(sensors: Sensor[]): DeviceOption[] {
  if (sensors.length === 0) {
    return MOCK_MOTOR_TWINS.map((twin) => ({
      id: twin.sensorId,
      name: twin.name,
      zone: "Mock Zone",
      site: "Digital Twin Lab",
      online: true,
      twin,
    }));
  }

  return sensors.map((sensor) => {
    const linkedTwin = MOCK_MOTOR_TWINS.find(
      (twin) => twin.sensorId === sensor.id || twin.motorId === sensor.id,
    );

    return {
      id: sensor.id,
      name: sensor.name,
      zone: sensor.zone,
      site: sensor.site,
      online: sensor.online,
      twin: linkedTwin
        ? {
            ...linkedTwin,
            sensorId: sensor.id,
            name: sensor.name,
          }
        : {
            motorId: `motor-${sensor.id}`,
            sensorId: sensor.id,
            name: sensor.name,
            position: { x: 0, y: 0, z: 0 },
            rotation: { y: 0 },
          },
    };
  });
}

function filterSamplesByPreset(
  samples: MotorPositionSample[],
  preset: TimeRangePreset,
  referenceNowMs: number,
) {
  const fromMs = referenceNowMs - preset.windowMs;
  return samples.filter((sample) => {
    const recordedMs = Date.parse(sample.recordedAt);
    return recordedMs >= fromMs && recordedMs <= referenceNowMs;
  });
}

function getLatestSample(samples: MotorPositionSample[]) {
  return samples.length > 0 ? samples[samples.length - 1] : null;
}

function BrushTimeline({
  samples,
  allSamples,
  rangeStartMs,
  rangeEndMs,
}: {
  samples: MotorPositionSample[];
  allSamples: MotorPositionSample[];
  rangeStartMs: number;
  rangeEndMs: number;
}) {
  const { C } = useTheme();
  const allTimes = allSamples.map((sample) => Date.parse(sample.recordedAt)).filter(Number.isFinite);
  const minTime = allTimes.length > 0 ? Math.min(...allTimes) : rangeStartMs;
  const maxTime = allTimes.length > 0 ? Math.max(...allTimes) : rangeEndMs;
  const totalSpan = Math.max(1, maxTime - minTime);
  const startPct = Math.max(0, Math.min(100, ((rangeStartMs - minTime) / totalSpan) * 100));
  const endPct = Math.max(startPct, Math.min(100, ((rangeEndMs - minTime) / totalSpan) * 100));
  const selectedIds = new Set(samples.map((sample) => sample.id));

  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: C.input,
        borderRadius: 13,
        padding: "13px 12px 11px",
      }}
    >
      <div style={{ position: "relative", height: 46 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 21,
            height: 6,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${C.border}, ${C.cardBorder})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${startPct}%`,
            width: `${Math.max(2, endPct - startPct)}%`,
            top: 17,
            height: 14,
            borderRadius: 999,
            background: C.primaryBg,
            border: `1px solid ${C.primary}88`,
            boxShadow: `0 0 18px ${C.primaryGlow}`,
          }}
        />
        {allSamples.map((sample) => {
          const recordedMs = Date.parse(sample.recordedAt);
          const leftPct = ((recordedMs - minTime) / totalSpan) * 100;
          const selected = selectedIds.has(sample.id);
          return (
            <span
              key={sample.id}
              title={`${formatDateTime(sample.recordedAt)} · X ${formatNumber(sample.position.x)} · Z ${formatNumber(sample.position.z)}`}
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: selected ? 14 : 18,
                width: selected ? 16 : 10,
                height: selected ? 16 : 10,
                transform: "translateX(-50%)",
                borderRadius: "50%",
                border: `2px solid ${selected ? C.primary : C.textDim}`,
                background: selected ? C.primary : C.surface,
                boxShadow: selected ? `0 0 12px ${C.primary}AA` : "none",
              }}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2" style={{ color: C.textMuted, fontSize: "0.62rem", fontWeight: 800 }}>
        <span>{formatDateTime(new Date(rangeStartMs).toISOString())}</span>
        <span>{samples.length.toLocaleString("vi-VN")} mẫu trong vùng brush</span>
        <span>{formatDateTime(new Date(rangeEndMs).toISOString())}</span>
      </div>
    </div>
  );
}

function DeviceCard({
  device,
  active,
  onSelect,
}: {
  device: DeviceOption;
  active: boolean;
  onSelect: () => void;
}) {
  const { C } = useTheme();
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: "100%",
        border: `1px solid ${active ? C.primary : C.border}`,
        background: active ? C.primaryBg : C.input,
        borderRadius: 12,
        padding: "10px 11px",
        textAlign: "left",
        cursor: "pointer",
        color: C.textBase,
        boxShadow: active ? `0 0 0 1px ${C.primary}33 inset` : "none",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span style={{ color: active ? C.primary : C.textBright, fontSize: "0.76rem", fontWeight: 900 }}>{device.name}</span>
        <span style={{ color: device.online ? C.success : C.textMuted, fontSize: "0.58rem", fontWeight: 900 }}>
          {device.online ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2" style={{ color: C.textMuted, fontSize: "0.63rem" }}>
        <span>{device.id}</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1"><MapPin size={11} /> {device.zone || "--"}</span>
      </div>
    </button>
  );
}

function LoadedDataView({
  device,
  allSamples,
  activePreset,
  onPresetChange,
  referenceNowMs,
  realTelemetryCount,
  realTelemetryLoading,
}: {
  device: DeviceOption;
  allSamples: MotorPositionSample[];
  activePreset: TimeRangePreset;
  onPresetChange: (preset: TimeRangePreset) => void;
  referenceNowMs: number;
  realTelemetryCount: number;
  realTelemetryLoading: boolean;
}) {
  const { C } = useTheme();
  const samples = useMemo(
    () => filterSamplesByPreset(allSamples, activePreset, referenceNowMs),
    [activePreset, allSamples, referenceNowMs],
  );
  const latestSample = getLatestSample(samples);
  const rows = [...samples].reverse();
  const rangeStartMs = referenceNowMs - activePreset.windowMs;

  return (
    <div className="mt-4 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div style={{ color: C.textBright, fontSize: "0.78rem", fontWeight: 900 }}>{device.name}</div>
          <div style={{ color: C.textMuted, fontSize: "0.64rem", marginTop: 3 }}>
            Đã tải mock data cho {device.id}
          </div>
        </div>
        <div style={{ color: realTelemetryLoading ? C.warning : C.textMuted, fontSize: "0.64rem", fontWeight: 800 }}>
          Telemetry thật: {realTelemetryLoading ? "Đang tải" : realTelemetryCount.toLocaleString("vi-VN")}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TIME_RANGE_PRESETS.map((preset) => {
          const active = activePreset.key === preset.key;
          return (
            <ConsoleButton
              key={preset.key}
              type="button"
              size="sm"
              variant={active ? "primary" : "neutral"}
              onClick={() => onPresetChange(preset)}
            >
              {preset.label}
            </ConsoleButton>
          );
        })}
      </div>

      <BrushTimeline
        samples={samples}
        allSamples={allSamples}
        rangeStartMs={rangeStartMs}
        rangeEndMs={referenceNowMs}
      />

      <div className="grid grid-cols-3 gap-2">
        <div style={{ border: `1px solid ${C.border}`, background: C.input, borderRadius: 11, padding: 10 }}>
          <div style={{ color: C.textMuted, fontSize: "0.61rem", fontWeight: 800 }}>Samples</div>
          <div style={{ color: C.primary, fontSize: "0.9rem", fontWeight: 950 }}>{samples.length}</div>
        </div>
        <div style={{ border: `1px solid ${C.border}`, background: C.input, borderRadius: 11, padding: 10 }}>
          <div style={{ color: C.textMuted, fontSize: "0.61rem", fontWeight: 800 }}>Latest X</div>
          <div style={{ color: C.textBright, fontSize: "0.82rem", fontWeight: 900 }}>{latestSample ? formatNumber(latestSample.position.x) : "--"}</div>
        </div>
        <div style={{ border: `1px solid ${C.border}`, background: C.input, borderRadius: 11, padding: 10 }}>
          <div style={{ color: C.textMuted, fontSize: "0.61rem", fontWeight: 800 }}>Latest Z</div>
          <div style={{ color: C.textBright, fontSize: "0.82rem", fontWeight: 900 }}>{latestSample ? formatNumber(latestSample.position.z) : "--"}</div>
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflow: "hidden",
          background: C.input,
        }}
      >
        <div
          className="flex items-center justify-between gap-2 px-3 py-2"
          style={{
            borderBottom: `1px solid ${C.border}`,
            background: C.surface,
            color: C.textBase,
            fontSize: "0.68rem",
            fontWeight: 900,
          }}
        >
          <span className="inline-flex items-center gap-1.5"><Table2 size={13} /> Bảng dữ liệu brush</span>
          <span style={{ color: C.textMuted }}>{latestSample ? formatDateTime(latestSample.recordedAt) : "Không có mẫu"}</span>
        </div>

        {rows.length > 0 ? (
          <div style={{ maxHeight: 220, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${C.scrollbar} transparent` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", color: C.textBase, fontSize: "0.66rem" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1, background: C.input }}>
                <tr style={{ color: C.textMuted, textAlign: "left" }}>
                  <th style={{ padding: "8px 10px", fontWeight: 900 }}>Thời gian</th>
                  <th style={{ padding: "8px 10px", fontWeight: 900 }}>X</th>
                  <th style={{ padding: "8px 10px", fontWeight: 900 }}>Z</th>
                  <th style={{ padding: "8px 10px", fontWeight: 900 }}>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((sample) => (
                  <tr key={sample.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: C.textBright }}>{formatDateTime(sample.recordedAt)}</td>
                    <td style={{ padding: "8px 10px", fontVariantNumeric: "tabular-nums" }}>{formatNumber(sample.position.x)}</td>
                    <td style={{ padding: "8px 10px", fontVariantNumeric: "tabular-nums" }}>{formatNumber(sample.position.z)}</td>
                    <td style={{ padding: "8px 10px", minWidth: 130 }}>{sample.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "22px 14px", color: C.textMuted, fontSize: "0.72rem", textAlign: "center" }}>
            Không có mẫu mock trong khung thời gian này.
          </div>
        )}
      </div>
    </div>
  );
}

export function MotorMockDataPanel({
  sensors,
  telemetryByDevice,
  telemetryLoadingByDevice,
}: MotorMockDataPanelProps) {
  const { C } = useTheme();
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [loadedDeviceId, setLoadedDeviceId] = useState<string | null>(null);
  const [referenceNowMs, setReferenceNowMs] = useState(() => Date.now());
  const [activePresetKey, setActivePresetKey] = useState<TimeRangePresetKey>(DEFAULT_TIME_PRESET.key);

  const deviceOptions = useMemo(() => buildDeviceOptions(sensors), [sensors]);

  useEffect(() => {
    if (deviceOptions.length === 0) {
      return;
    }

    if (!deviceOptions.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(deviceOptions[0].id);
    }
  }, [deviceOptions, selectedDeviceId]);

  const selectedDevice = useMemo(
    () => deviceOptions.find((device) => device.id === selectedDeviceId) ?? deviceOptions[0] ?? null,
    [deviceOptions, selectedDeviceId],
  );

  const loadedDevice = useMemo(
    () => deviceOptions.find((device) => device.id === loadedDeviceId) ?? null,
    [deviceOptions, loadedDeviceId],
  );

  const activePreset = TIME_RANGE_PRESETS.find((preset) => preset.key === activePresetKey) ?? DEFAULT_TIME_PRESET;
  const loadedSamples = useMemo(
    () => loadedDevice ? buildMockMotorPositionSamples(loadedDevice.twin, referenceNowMs) : [],
    [loadedDevice, referenceNowMs],
  );
  const realTelemetryCount = loadedDevice ? telemetryByDevice[loadedDevice.id]?.length ?? 0 : 0;
  const realTelemetryLoading = loadedDevice ? Boolean(telemetryLoadingByDevice[loadedDevice.id]) : false;

  const loadSelectedDevice = () => {
    if (!selectedDevice) {
      return;
    }

    setLoadedDeviceId(selectedDevice.id);
    setReferenceNowMs(Date.now());
    setActivePresetKey(DEFAULT_TIME_PRESET.key);
  };

  return (
    <ConsolePanel
      className="analyze-mock-data-panel"
      style={{
        padding: 14,
        background: `linear-gradient(180deg, ${C.card}, ${C.surface})`,
        borderColor: C.cardBorder,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2" style={{ color: C.primary }}>
            <Database size={16} strokeWidth={2.2} />
            <h3 style={{ color: C.textBright, fontSize: "0.92rem", fontWeight: 900, margin: 0 }}>
              Mock dữ liệu thiết bị
            </h3>
          </div>
          <p style={{ color: C.textMuted, fontSize: "0.68rem", lineHeight: 1.5, margin: "7px 0 0" }}>
            Chọn thiết bị trước, sau đó bấm tải để hiện dữ liệu brush. Phần này chưa tác động vào model 3D.
          </p>
        </div>
        <span
          style={{
            border: `1px solid ${C.primary}55`,
            background: C.primaryBg,
            color: C.primary,
            borderRadius: 999,
            padding: "5px 8px",
            fontSize: "0.58rem",
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          MOCK
        </span>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-1.5" style={{ color: C.textMuted, fontSize: "0.66rem", fontWeight: 800 }}>
          <Gauge size={12} /> Danh sách thiết bị
        </div>
        <div className="grid gap-2" style={{ maxHeight: 250, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${C.scrollbar} transparent` }}>
          {deviceOptions.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              active={selectedDevice?.id === device.id}
              onSelect={() => setSelectedDeviceId(device.id)}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5" style={{ color: C.textMuted, fontSize: "0.64rem" }}>
          <MousePointer2 size={12} />
          {selectedDevice ? `Đang chọn: ${selectedDevice.name}` : "Chưa có thiết bị"}
        </div>
        <ConsoleButton
          type="button"
          variant="primary"
          size="sm"
          disabled={!selectedDevice}
          onClick={loadSelectedDevice}
        >
          <Download size={13} /> Tải thiết bị
        </ConsoleButton>
      </div>

      {loadedDevice ? (
        <LoadedDataView
          device={loadedDevice}
          allSamples={loadedSamples}
          activePreset={activePreset}
          onPresetChange={(preset) => setActivePresetKey(preset.key)}
          referenceNowMs={referenceNowMs}
          realTelemetryCount={realTelemetryCount}
          realTelemetryLoading={realTelemetryLoading}
        />
      ) : (
        <div
          className="mt-4 flex items-center gap-2 rounded-xl border px-3 py-4"
          style={{ borderColor: C.border, background: C.input, color: C.textMuted, fontSize: "0.7rem" }}
        >
          <Clock3 size={14} /> Dữ liệu brush sẽ xuất hiện sau khi bấm “Tải thiết bị”.
        </div>
      )}
    </ConsolePanel>
  );
}
