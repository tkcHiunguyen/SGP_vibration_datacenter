import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { X, Thermometer, BarChart3, Activity, Trash2, Settings, Clock3, ChevronDown } from "lucide-react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Brush } from "@visx/brush";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { init, use as useECharts } from "echarts/core";
import { BarChart as EChartsBarChart, LineChart as EChartsLineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECharts, EChartsOption } from "echarts";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewportGizmo } from "three-viewport-gizmo";
import { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor, SpectrumAxis } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";
import type { ToastItem } from "./ui";
import { ConsoleButton, Modal } from "./ui";

useECharts([EChartsBarChart, EChartsLineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const GRAVITY_MS2 = 9.80665;
const ACCEL_LIMIT_MS2 = 8 * GRAVITY_MS2;
const DEFAULT_VISIBLE_POINTS = 120;
const MIN_VISIBLE_POINTS = 60;
const MAX_VISIBLE_POINTS = 5000;
const TREND_MIN_RENDER_POINTS = 240;
const TREND_MAX_RENDER_POINTS = 2200;
const TREND_TILE_PIXEL_WIDTH = 12;
const TREND_RELOAD_SPINNER_MIN_MS = 170;
const DEFAULT_SPECTRUM_SAMPLE_RATE_HZ = 1000;
const DEFAULT_SPECTRUM_SOURCE_SAMPLES = 1024;
const SPECTRUM_RENDER_BARS = 512;
const SPECTRUM_HOVER_FETCH_DEBOUNCE_MS = 500;
const SPECTRUM_HOVER_FETCH_MIN_DELTA_MS = 500;
const SPECTRUM_FIXED_Y_MAX_FALLBACK = 1;
const EMPTY_SPECTRUM_POINTS: DeviceSpectrumPoint[] = [];
const DATA_SETTINGS_MODAL_CLOSE_MS = 190;
const DATA_SETTINGS_SUMMARY_FETCH_DELAY_MS = 220;
const DATA_SETTINGS_SUMMARY_CACHE_TTL_MS = 12_000;
const CLEAR_DATA_CONFIRM_MODAL_CLOSE_MS = 170;

type HistoryPresetKey = "1h" | "6h" | "12h" | "1d" | "3d" | "1w" | "1m";
const DEFAULT_HISTORY_PRESET_KEY: HistoryPresetKey = "1h";
const TEMP_HALF_SPAN_MIN = 1;
const TEMP_HALF_SPAN_MAX = 20;
const ACCEL_LIMIT_MIN = 0.5 * GRAVITY_MS2;
const ACCEL_LIMIT_MAX = 16 * GRAVITY_MS2;

const TELEMETRY_HISTORY_PRESETS: Array<{
  key: HistoryPresetKey;
  label: string;
  windowMs: number;
  limit: number;
  visiblePoints: number;
}> = [
  { key: "1h", label: "1 giờ", windowMs: 60 * 60 * 1000, limit: 800, visiblePoints: 280 },
  { key: "6h", label: "6 giờ", windowMs: 6 * 60 * 60 * 1000, limit: 1000, visiblePoints: 420 },
  { key: "12h", label: "12 giờ", windowMs: 12 * 60 * 60 * 1000, limit: 1400, visiblePoints: 520 },
  { key: "1d", label: "1 ngày", windowMs: 24 * 60 * 60 * 1000, limit: 1800, visiblePoints: 620 },
  { key: "3d", label: "3 ngày", windowMs: 3 * 24 * 60 * 60 * 1000, limit: 2400, visiblePoints: 720 },
  { key: "1w", label: "1 tuần", windowMs: 7 * 24 * 60 * 60 * 1000, limit: 3000, visiblePoints: 820 },
  { key: "1m", label: "1 tháng", windowMs: 30 * 24 * 60 * 60 * 1000, limit: 3600, visiblePoints: 900 },
];

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asTimestampMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : undefined;
  }
  return asFiniteNumber(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function safeString(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || "unknown_error";
  }
  if (value instanceof Error) {
    return value.message || "unknown_error";
  }
  if (value && typeof value === "object") {
    const message = asNonEmptyString((value as Record<string, unknown>).message);
    if (message) {
      return message;
    }
  }
  return "unknown_error";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asSpectrumAxis(value: unknown): SpectrumAxis | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "x" || normalized === "y" || normalized === "z") {
    return normalized as SpectrumAxis;
  }
  return undefined;
}

function parseAmplitudeArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const values: number[] = [];
  for (const item of value) {
    const parsed = asFiniteNumber(item);
    if (typeof parsed === "number") {
      values.push(parsed);
    }
  }
  return values;
}

function parseSpectrumPoint(value: unknown): DeviceSpectrumPoint | null {
  const row = asRecord(value);
  const axis = asSpectrumAxis(row.axis);
  const amplitudes = parseAmplitudeArray(row.amplitudes);
  const receivedAtRaw = row.receivedAt;
  const receivedAt =
    typeof receivedAtRaw === "string" && receivedAtRaw.trim() ? receivedAtRaw.trim() : undefined;
  if (!axis || amplitudes.length === 0 || !receivedAt) {
    return null;
  }

  return {
    receivedAt,
    axis,
    telemetryUuid:
      typeof row.telemetryUuid === "string" && row.telemetryUuid.trim()
        ? row.telemetryUuid.trim()
        : undefined,
    uuid: typeof row.uuid === "string" && row.uuid.trim() ? row.uuid.trim() : undefined,
    sourceSampleCount: asFiniteNumber(row.sourceSampleCount),
    sampleRateHz: asFiniteNumber(row.sampleRateHz),
    binCount: Math.max(
      1,
      Math.floor(asFiniteNumber(row.binCount) ?? amplitudes.length),
    ),
    binHz: asFiniteNumber(row.binHz),
    valueScale: asFiniteNumber(row.valueScale),
    magnitudeUnit:
      typeof row.magnitudeUnit === "string" && row.magnitudeUnit.trim()
        ? row.magnitudeUnit.trim()
        : undefined,
    amplitudes,
    peakBinIndex: asFiniteNumber(row.peakBinIndex),
    peakFrequencyHz: asFiniteNumber(row.peakFrequencyHz),
    peakAmplitude: asFiniteNumber(row.peakAmplitude),
  };
}

function parseSpectrumFramePayload(payload: unknown): DeviceSpectrumPoint[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const hasAllAxes = (points: DeviceSpectrumPoint[]): boolean => {
    const axes = new Set(points.map((point) => point.axis));
    return axes.has("x") && axes.has("y") && axes.has("z");
  };

  const pointsCandidate = Array.isArray(data.points) ? data.points : [];
  if (pointsCandidate.length > 0) {
    const parsed = pointsCandidate
      .map((item) => parseSpectrumPoint(item))
      .filter((item): item is DeviceSpectrumPoint => Boolean(item));
    return hasAllAxes(parsed) ? parsed : [];
  }

  const axesRecord = asRecord(data.axes);
  const axisValues = Object.values(axesRecord);
  const parsed = axisValues
    .map((item) => parseSpectrumPoint(item))
    .filter((item): item is DeviceSpectrumPoint => Boolean(item));
  return hasAllAxes(parsed) ? parsed : [];
}

function formatChartTime(input: string): string {
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    return "--:--";
  }
  const d = new Date(parsed);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function formatAbsoluteAxisTime(input: number): string {
  if (!Number.isFinite(input)) {
    return "";
  }
  const d = new Date(input);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} ${dd}/${mo}`;
}

function formatTooltipDateTime(input: unknown): string {
  const ts =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Date.parse(input)
        : Number.NaN;
  if (!Number.isFinite(ts)) {
    return String(input ?? "");
  }
  const d = new Date(ts);
  return `${formatChartTime(d.toISOString())} · ${d.toLocaleDateString("vi-VN")}`;
}

function formatFrequencyHz(input: unknown): string {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return "-- Hz";
  }
  return `${input.toFixed(3)} Hz`;
}

function normalizeSpectrumUnit(input: unknown): string {
  if (typeof input !== "string") {
    return "m/s²";
  }

  const normalized = input.trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "m/s2" || normalized === "m/s^2" || normalized === "m/s²") {
    return "m/s²";
  }

  return input.trim();
}

function formatPeakSummary(frequencyHz?: number, amplitude?: number, unit = "m/s²"): string {
  if (
    typeof frequencyHz !== "number" ||
    !Number.isFinite(frequencyHz) ||
    typeof amplitude !== "number" ||
    !Number.isFinite(amplitude)
  ) {
    return "Peak: --";
  }
  return `Peak: ${frequencyHz.toFixed(1)} Hz / ${amplitude.toFixed(3)} ${unit}`;
}

function formatOptionalValue(value: number | undefined, precision: number, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return `${value.toFixed(precision)}${suffix}`;
}

function formatByteSize(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "--";
  }
  if (value === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const fixed = size >= 10 ? size.toFixed(1) : size.toFixed(2);
  return `${fixed} ${units[unitIndex]}`;
}

function clampTrendVisiblePoints(value: number): number {
  return Math.max(MIN_VISIBLE_POINTS, Math.min(MAX_VISIBLE_POINTS, Math.round(value)));
}

function clampTempHalfSpan(value: number): number {
  return Math.max(TEMP_HALF_SPAN_MIN, Math.min(TEMP_HALF_SPAN_MAX, Number(value.toFixed(2))));
}

function clampAccelAmplitudeLimit(value: number): number {
  return Math.max(ACCEL_LIMIT_MIN, Math.min(ACCEL_LIMIT_MAX, Number(value.toFixed(3))));
}

function buildNullGapRanges<T>(
  rows: T[],
  isValueAvailable: (row: T) => boolean,
  getTs: (row: T) => number,
  stepMs: number,
): TrendGapSegment[] {
  if (rows.length === 0 || stepMs <= 0) {
    return [];
  }

  const ranges: TrendGapSegment[] = [];
  let gapStartIndex: number | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const hasValue = isValueAvailable(row);
    if (!hasValue) {
      if (gapStartIndex === null) {
        gapStartIndex = index;
      }
      continue;
    }

    if (gapStartIndex !== null) {
      const from = getTs(rows[gapStartIndex]);
      const to = getTs(rows[index - 1]) + stepMs;
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
        ranges.push({ from, to });
      }
      gapStartIndex = null;
    }
  }

  if (gapStartIndex !== null) {
    const from = getTs(rows[gapStartIndex]);
    const to = getTs(rows[rows.length - 1]) + stepMs;
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      ranges.push({ from, to });
    }
  }

  return ranges;
}

function spectrumBinHz(point: DeviceSpectrumPoint | null): number | undefined {
  if (!point) {
    return undefined;
  }

  if (typeof point.binHz === "number" && Number.isFinite(point.binHz) && point.binHz > 0) {
    return point.binHz;
  }

  if (
    typeof point.sampleRateHz === "number" &&
    Number.isFinite(point.sampleRateHz) &&
    point.sampleRateHz > 0 &&
    typeof point.sourceSampleCount === "number" &&
    Number.isFinite(point.sourceSampleCount) &&
    point.sourceSampleCount > 0
  ) {
    return point.sampleRateHz / point.sourceSampleCount;
  }

  return undefined;
}

type SpectrumChartDataPoint = {
  bin: number;
  freq: number;
  amp: number;
  unit: string;
};

function toSpectrumChartData(point: DeviceSpectrumPoint | null): SpectrumChartDataPoint[] {
  if (!point || !Array.isArray(point.amplitudes)) {
    return [];
  }

  const resolvedBinCount =
    typeof point.binCount === "number" && Number.isFinite(point.binCount) && point.binCount > 0
      ? Math.max(1, Math.min(point.amplitudes.length, Math.floor(point.binCount)))
      : point.amplitudes.length;
  if (resolvedBinCount <= 0) {
    return [];
  }

  const binHz = spectrumBinHz(point);
  const resolvedBinHz = binHz ?? DEFAULT_SPECTRUM_SAMPLE_RATE_HZ / DEFAULT_SPECTRUM_SOURCE_SAMPLES;
  const unit = normalizeSpectrumUnit(point.magnitudeUnit);
  return Array.from({ length: resolvedBinCount }, (_, index) => {
    const raw = point.amplitudes[index];
    const amp = typeof raw === "number" && Number.isFinite(raw) ? Number(raw.toFixed(6)) : 0;
    const bin = index + 1;
    return {
      bin,
      freq: Number((resolvedBinHz * bin).toFixed(3)),
      amp,
      unit,
    };
  });
}

function downsampleSpectrumChartData(
  data: SpectrumChartDataPoint[],
  maxBars = SPECTRUM_RENDER_BARS,
): SpectrumChartDataPoint[] {
  if (data.length <= maxBars) {
    return data;
  }

  const bucketSize = Math.ceil(data.length / maxBars);
  const reduced: SpectrumChartDataPoint[] = [];
  for (let start = 0; start < data.length; start += bucketSize) {
    const end = Math.min(data.length, start + bucketSize);
    let peak = data[start];
    for (let index = start + 1; index < end; index += 1) {
      const next = data[index];
      if (next.amp > peak.amp) {
        peak = next;
      }
    }
    reduced.push(peak);
  }

  return reduced;
}

type ChartPanState = {
  startX: number;
  startOffset: number;
  width: number;
  maxOffset: number;
};

type HoverTelemetrySnapshot = {
  ts: number;
  temp?: number;
  ax?: number;
  ay?: number;
  az?: number;
};

type SpectrumHoverTarget = {
  timestampMs: number;
  telemetryUuid?: string;
};

type TrendRow = {
  ts: number;
  telemetryUuid?: string;
  [seriesKey: string]: number | string | null | undefined;
};

type TrendSeriesConfig = {
  key: string;
  name: string;
  color: string;
  strokeWidth?: number;
  latestLabelFormatter?: (value: number) => string | undefined;
};

type TrendGapSegment = {
  from: number;
  to: number;
};

type DenseTelemetryRow = {
  ts: number;
  telemetryUuid?: string;
  temp: number | null;
  ax: number | null;
  ay: number | null;
  az: number | null;
};

function thinSampleIndices(sortedIndices: number[], maxCount: number): number[] {
  if (sortedIndices.length <= maxCount) {
    return sortedIndices;
  }
  if (maxCount <= 2) {
    return [sortedIndices[0], sortedIndices[sortedIndices.length - 1]];
  }

  const result: number[] = [sortedIndices[0]];
  const span = sortedIndices.length - 1;
  for (let index = 1; index < maxCount - 1; index += 1) {
    const mapped = Math.round((index * span) / (maxCount - 1));
    result.push(sortedIndices[mapped]);
  }
  result.push(sortedIndices[sortedIndices.length - 1]);
  return [...new Set(result)].sort((left, right) => left - right);
}

function buildTiledTrendRows(
  rows: TrendRow[],
  seriesKeys: string[],
  maxPoints: number,
  tileCount: number,
): TrendRow[] {
  if (rows.length <= maxPoints || rows.length <= 2) {
    return rows;
  }

  const safeMaxPoints = Math.max(32, maxPoints);
  const totalRows = rows.length;
  const safeTileCount = Math.max(1, Math.min(tileCount, totalRows));
  const tileSize = Math.max(1, Math.ceil(totalRows / safeTileCount));
  const selected = new Set<number>();

  for (let tileStart = 0; tileStart < totalRows; tileStart += tileSize) {
    const tileEnd = Math.min(totalRows, tileStart + tileSize);
    if (tileEnd <= tileStart) {
      continue;
    }

    selected.add(tileStart);
    selected.add(tileEnd - 1);

    const tileRowCount = tileEnd - tileStart;
    const targetPerTile = Math.max(3, Math.ceil(safeMaxPoints / safeTileCount));
    const stride = Math.max(1, Math.floor(tileRowCount / targetPerTile));
    for (let index = tileStart; index < tileEnd; index += stride) {
      selected.add(index);
    }

    let firstNullIndex = -1;
    let lastNullIndex = -1;

    for (const seriesKey of seriesKeys) {
      let minValue = Number.POSITIVE_INFINITY;
      let maxValue = Number.NEGATIVE_INFINITY;
      let minIndex = -1;
      let maxIndex = -1;

      for (let index = tileStart; index < tileEnd; index += 1) {
        const rawValue = rows[index]?.[seriesKey];
        if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
          continue;
        }
        if (rawValue < minValue) {
          minValue = rawValue;
          minIndex = index;
        }
        if (rawValue > maxValue) {
          maxValue = rawValue;
          maxIndex = index;
        }
      }

      if (minIndex >= 0) {
        selected.add(minIndex);
      }
      if (maxIndex >= 0) {
        selected.add(maxIndex);
      }
    }

    for (let index = tileStart; index < tileEnd; index += 1) {
      const row = rows[index];
      const hasAnyValue = seriesKeys.some((seriesKey) => {
        const raw = row?.[seriesKey];
        return typeof raw === "number" && Number.isFinite(raw);
      });
      if (hasAnyValue) {
        continue;
      }
      if (firstNullIndex < 0) {
        firstNullIndex = index;
      }
      lastNullIndex = index;
    }

    if (firstNullIndex >= 0) {
      selected.add(firstNullIndex);
    }
    if (lastNullIndex >= 0) {
      selected.add(lastNullIndex);
    }
  }

  const selectedIndices = Array.from(selected).sort((left, right) => left - right);
  const trimmedIndices = thinSampleIndices(selectedIndices, safeMaxPoints);
  return trimmedIndices
    .map((index) => rows[index])
    .filter((row): row is TrendRow => Boolean(row));
}

type DeviceDataSummary = {
  updatedAt?: string;
  totalRecords: number;
  totalBytes: number;
  telemetry: {
    records: number;
    latestAt?: string;
    estimatedBytes: number;
  };
  spectrum: {
    frames: number;
    latestAt?: string;
    totalBytes: number;
  };
};

function parseDeviceDataSummaryPayload(payload: unknown): DeviceDataSummary | null {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  if (Object.keys(data).length === 0) {
    return null;
  }

  const telemetry = asRecord(data.telemetry);
  const spectrum = asRecord(data.spectrum);

  return {
    updatedAt: asNonEmptyString(data.updatedAt),
    totalRecords: Math.max(0, Math.floor(asFiniteNumber(data.totalRecords) ?? 0)),
    totalBytes: Math.max(0, Math.floor(asFiniteNumber(data.totalBytes) ?? 0)),
    telemetry: {
      records: Math.max(0, Math.floor(asFiniteNumber(telemetry.records) ?? 0)),
      latestAt: asNonEmptyString(telemetry.latestAt),
      estimatedBytes: Math.max(0, Math.floor(asFiniteNumber(telemetry.estimatedBytes) ?? 0)),
    },
    spectrum: {
      frames: Math.max(0, Math.floor(asFiniteNumber(spectrum.frames) ?? 0)),
      latestAt: asNonEmptyString(spectrum.latestAt),
      totalBytes: Math.max(0, Math.floor(asFiniteNumber(spectrum.totalBytes) ?? 0)),
    },
  };
}

function parseSpectrumHoverTarget(state: unknown): SpectrumHoverTarget | null {
  const row = asRecord(state);
  const timestampMsDirect = asFiniteNumber(row.timestampMs);
  if (typeof timestampMsDirect === "number" && Number.isFinite(timestampMsDirect)) {
    return {
      timestampMs: timestampMsDirect,
      telemetryUuid: asNonEmptyString(row.telemetryUuid ?? row.telemetry_uuid),
    };
  }

  const labelTimestamp = asFiniteNumber(row.activeLabel);
  const activePayload = Array.isArray(row.activePayload) ? row.activePayload : [];
  const firstPayload = activePayload.length > 0 ? asRecord(activePayload[0]) : {};
  const payloadRecord = asRecord(firstPayload.payload);
  const payloadTimestamp = asFiniteNumber(payloadRecord.ts);
  const timestampMs = labelTimestamp ?? payloadTimestamp;
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
    return null;
  }

  const telemetryUuid = asNonEmptyString(payloadRecord.telemetryUuid ?? payloadRecord.telemetry_uuid);
  return { timestampMs, telemetryUuid };
}

function TimeWindowBrush({
  rows,
  selectedStartTs,
  selectedEndTs,
  onRangeCommit,
  resetKey,
  axisLabelColor,
  C,
}: {
  rows: DenseTelemetryRow[];
  selectedStartTs?: number;
  selectedEndTs?: number;
  onRangeCommit?: (startTs: number, endTs: number) => void;
  resetKey: string;
  axisLabelColor: string;
  C: {
    surface: string;
    border: string;
    textBright: string;
    textMuted: string;
    primary: string;
  };
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastBrushRangeRef = useRef<{ startTs: number; endTs: number } | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const height = 96;
  const margin = useMemo(() => ({ top: 8, right: 10, bottom: 22, left: 10 }), []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const updateWidth = () => {
      const next = Math.max(0, Math.round(wrapper.getBoundingClientRect().width));
      setChartWidth(next);
    };
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(wrapper);
    window.addEventListener("resize", updateWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  const firstTs = rows[0]?.ts ?? Date.now() - 1000;
  const lastTsRaw = rows[rows.length - 1]?.ts ?? Date.now();
  const lastTs = lastTsRaw > firstTs ? lastTsRaw : firstTs + 1000;
  const safeStartTs = typeof selectedStartTs === "number" ? selectedStartTs : firstTs;
  const safeEndTs = typeof selectedEndTs === "number" ? selectedEndTs : lastTs;
  const normalizedSelectedStartTs = Math.min(safeStartTs, safeEndTs);
  const normalizedSelectedEndTs = Math.max(safeStartTs, safeEndTs);

  const xMax = Math.max(1, chartWidth - margin.left - margin.right);
  const yMax = Math.max(1, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () =>
      scaleTime<number>({
        domain: [new Date(firstTs), new Date(lastTs)],
        range: [0, xMax],
      }),
    [firstTs, lastTs, xMax],
  );

  const lineData = useMemo(
    () =>
      rows
        .map((row) => {
          const values = [row.temp, row.ax, row.ay, row.az].filter(
            (value): value is number => typeof value === "number" && Number.isFinite(value),
          );
          if (values.length === 0) {
            return null;
          }
          const magnitude = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
          return { ts: row.ts, value: magnitude };
        })
        .filter((item): item is { ts: number; value: number } => Boolean(item)),
    [rows],
  );

  const [yMin, yMaxValue] = useMemo(() => {
    if (lineData.length === 0) {
      return [0, 1] as const;
    }
    const min = Math.min(...lineData.map((point) => point.value));
    const max = Math.max(...lineData.map((point) => point.value));
    if (max <= min) {
      return [Math.max(0, min - 0.5), max + 0.5] as const;
    }
    const padding = (max - min) * 0.12;
    return [Math.max(0, min - padding), max + padding] as const;
  }, [lineData]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [yMin, yMaxValue],
        range: [yMax, 0],
      }),
    [yMax, yMaxValue, yMin],
  );

  const initialBrushPosition = useMemo(() => {
    const startX = Math.max(0, Math.min(xMax, xScale(new Date(normalizedSelectedStartTs))));
    const endX = Math.max(0, Math.min(xMax, xScale(new Date(normalizedSelectedEndTs))));
    return {
      start: { x: Math.min(startX, endX), y: 0 },
      end: { x: Math.max(startX, endX), y: yMax },
    };
  }, [normalizedSelectedEndTs, normalizedSelectedStartTs, xMax, xScale, yMax]);

  const handleBrushChange = useCallback(
    (bounds: unknown) => {
      const domain = asRecord(bounds);
      const x0 = asTimestampMs(domain.x0);
      const x1 = asTimestampMs(domain.x1);
      if (typeof x0 !== "number" || typeof x1 !== "number") {
        return;
      }

      const nextStartTs = Math.max(firstTs, Math.min(lastTs, Math.min(x0, x1)));
      const nextEndTs = Math.max(firstTs, Math.min(lastTs, Math.max(x0, x1)));
      const previous = lastBrushRangeRef.current;
      if (
        previous
        && Math.abs(nextStartTs - previous.startTs) <= 1
        && Math.abs(nextEndTs - previous.endTs) <= 1
      ) {
        return;
      }

      lastBrushRangeRef.current = { startTs: nextStartTs, endTs: nextEndTs };
      onRangeCommit?.(nextStartTs, nextEndTs);
    },
    [firstTs, lastTs, onRangeCommit],
  );

  return (
    <div ref={wrapperRef} style={{ width: "100%", height }}>
      {chartWidth > 0 ? (
        <svg width={chartWidth} height={height}>
          <Group left={margin.left} top={margin.top}>
            <rect
              x={0}
              y={0}
              width={xMax}
              height={yMax}
              rx={6}
              fill={C.surface}
              stroke={C.border}
            />

            {lineData.length > 1 ? (
              <LinePath
                data={lineData}
                x={(point) => xScale(new Date(point.ts))}
                y={(point) => yScale(point.value)}
                stroke={C.primary}
                strokeWidth={1.6}
                strokeOpacity={0.8}
              />
            ) : null}

            <Brush
              key={resetKey}
              xScale={xScale}
              yScale={yScale}
              width={xMax}
              height={yMax}
              initialBrushPosition={initialBrushPosition}
              handleSize={10}
              brushDirection="horizontal"
              resizeTriggerAreas={["left", "right"]}
              disableDraggingSelection={false}
              disableDraggingOverlay
              useWindowMoveEvents
              onClick={() => {
                lastBrushRangeRef.current = { startTs: firstTs, endTs: lastTs };
                onRangeCommit?.(firstTs, lastTs);
              }}
              selectedBoxStyle={{
                fill: "rgba(250, 204, 21, 0.22)",
                stroke: "#facc15",
                strokeWidth: 1.4,
                strokeOpacity: 0.95,
              }}
              onChange={handleBrushChange}
              renderBrushHandle={({ x, y, width, height: handleHeight, isBrushActive, className }) => (
                <g className={className}>
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={handleHeight}
                    rx={3}
                    fill={isBrushActive ? "#facc15" : "#facc15cc"}
                    stroke={C.surface}
                    strokeWidth={1}
                  />
                  <line
                    x1={x + width / 2}
                    x2={x + width / 2}
                    y1={y + 4}
                    y2={y + handleHeight - 4}
                    stroke={C.surface}
                    strokeWidth={1}
                  />
                </g>
              )}
            />
          </Group>

          <AxisBottom
            scale={xScale}
            left={margin.left}
            top={margin.top + yMax}
            numTicks={5}
            tickFormat={(value) => formatAbsoluteAxisTime(Number(value))}
            tickLabelProps={() => ({
              fill: axisLabelColor,
              fontSize: 9,
              textAnchor: "middle",
            })}
            stroke={C.border}
            tickStroke={C.border}
          />
        </svg>
      ) : null}
    </div>
  );
}

function TelemetryTrendChart({
  data,
  hoverPoints,
  series,
  gapSegmentsBySeries,
  yDomain,
  showLegend = false,
  gridColor,
  axisLabelColor,
  C,
  height = 150,
  onHoverTarget,
  onPinTarget,
  onLeave,
}: {
  data: TrendRow[];
  hoverPoints: Array<{ ts: number; telemetryUuid?: string }>;
  series: TrendSeriesConfig[];
  gapSegmentsBySeries?: Record<string, TrendGapSegment[]>;
  yDomain: [number, number];
  showLegend?: boolean;
  gridColor: string;
  axisLabelColor: string;
  C: {
    surface: string;
    border: string;
    textBright: string;
    textMuted: string;
  };
  height?: number;
  onHoverTarget?: (target: SpectrumHoverTarget) => void;
  onPinTarget?: (target: SpectrumHoverTarget) => void;
  onLeave?: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [hoverTarget, setHoverTarget] = useState<SpectrumHoverTarget | null>(null);

  const margin = useMemo(
    () => ({
      left: 58,
      right: 12,
      top: showLegend ? 24 : 10,
      bottom: 24,
    }),
    [showLegend],
  );

  const orderedHoverPoints = useMemo(() => {
    const source = hoverPoints.length > 0 ? hoverPoints : data.map((item) => ({ ts: item.ts, telemetryUuid: asNonEmptyString(item.telemetryUuid) }));
    return source
      .filter((item) => Number.isFinite(item.ts))
      .sort((left, right) => left.ts - right.ts);
  }, [data, hoverPoints]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const updateWidth = () => {
      const next = Math.max(0, Math.round(wrapper.getBoundingClientRect().width));
      setChartWidth(next);
    };
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(wrapper);
    window.addEventListener("resize", updateWidth);

    return () => {
      window.removeEventListener("resize", updateWidth);
      observer.disconnect();
    };
  }, []);

  const resolveNearestTarget = useCallback(
    (targetTs: number): SpectrumHoverTarget | null => {
      if (!Number.isFinite(targetTs) || orderedHoverPoints.length === 0) {
        return null;
      }

      let low = 0;
      let high = orderedHoverPoints.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((orderedHoverPoints[middle]?.ts ?? 0) < targetTs) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      const right = orderedHoverPoints[low] ?? null;
      const left = orderedHoverPoints[Math.max(0, low - 1)] ?? null;
      const best = !left ? right : !right ? left : Math.abs(left.ts - targetTs) <= Math.abs(right.ts - targetTs) ? left : right;
      if (!best) {
        return null;
      }
      return {
        timestampMs: best.ts,
        telemetryUuid: best.telemetryUuid,
      };
    },
    [orderedHoverPoints],
  );

  const gapBands = useMemo(() => {
    const mapped = Object.values(gapSegmentsBySeries ?? {})
      .flatMap((segments) => segments)
      .map((segment) => {
        const from = asFiniteNumber(segment.from);
        const to = asFiniteNumber(segment.to);
        if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to)) {
          return null;
        }
        const safeFrom = Math.min(from, to);
        const safeTo = Math.max(from, to);
        if (safeTo <= safeFrom) {
          return null;
        }
        return { from: safeFrom, to: safeTo };
      })
      .filter((segment): segment is { from: number; to: number } => Boolean(segment));
    return [...new Map(mapped.map((segment) => [`${segment.from}:${segment.to}`, segment])).values()].sort(
      (left, right) => left.from - right.from,
    );
  }, [gapSegmentsBySeries]);

  const renderData = useMemo(() => {
    if (data.length <= TREND_MIN_RENDER_POINTS) {
      return data;
    }
    const seriesKeys = series.map((seriesConfig) => seriesConfig.key);
    const targetPoints = Math.min(
      TREND_MAX_RENDER_POINTS,
      Math.max(TREND_MIN_RENDER_POINTS, Math.round(Math.max(320, chartWidth) * 1.8)),
    );
    const tileCount = Math.max(24, Math.round(Math.max(320, chartWidth) / TREND_TILE_PIXEL_WIDTH));
    return buildTiledTrendRows(data, seriesKeys, targetPoints, tileCount);
  }, [chartWidth, data, series]);

  const plottedSeries = useMemo(() => {
    return series.map((seriesConfig) => {
      const segments: Array<Array<{ ts: number; value: number }>> = [];
      let currentSegment: Array<{ ts: number; value: number }> = [];
      let latest: { ts: number; value: number } | null = null;

      for (const row of renderData) {
        const rawValue = row[seriesConfig.key];
        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
          const point = { ts: row.ts, value: rawValue };
          currentSegment.push(point);
          latest = point;
        } else if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      }
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }

      return {
        config: seriesConfig,
        segments,
        latest,
      };
    });
  }, [renderData, series]);

  const innerWidth = Math.max(1, chartWidth - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);

  const domainMin = data.length > 0 ? data[0]?.ts ?? Date.now() : Date.now() - 1000;
  const domainMaxRaw = data.length > 0 ? data[data.length - 1]?.ts ?? Date.now() : Date.now();
  const domainMax = domainMaxRaw > domainMin ? domainMaxRaw : domainMin + 1000;

  const xScale = useMemo(
    () =>
      scaleTime<number>({
        domain: [new Date(domainMin), new Date(domainMax)],
        range: [margin.left, margin.left + innerWidth],
      }),
    [domainMax, domainMin, innerWidth, margin.left],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [yDomain[0], yDomain[1]],
        range: [margin.top + innerHeight, margin.top],
      }),
    [innerHeight, margin.top, yDomain],
  );

  const findNearestDataRow = useCallback(
    (targetTs: number): TrendRow | null => {
      if (!Number.isFinite(targetTs) || data.length === 0) {
        return null;
      }
      let low = 0;
      let high = data.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((data[middle]?.ts ?? 0) < targetTs) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      const right = data[low] ?? null;
      const left = data[Math.max(0, low - 1)] ?? null;
      if (!left) {
        return right;
      }
      if (!right) {
        return left;
      }
      return Math.abs(left.ts - targetTs) <= Math.abs(right.ts - targetTs) ? left : right;
    },
    [data],
  );

  const hoverRow = useMemo(
    () => (hoverTarget ? findNearestDataRow(hoverTarget.timestampMs) : null),
    [findNearestDataRow, hoverTarget],
  );

  const hoverSeriesRows = useMemo(() => {
    if (!hoverRow) {
      return [];
    }
    return series
      .map((seriesConfig) => {
        const raw = hoverRow[seriesConfig.key];
        return {
          key: seriesConfig.key,
          name: seriesConfig.name,
          color: seriesConfig.color,
          value: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
        };
      })
      .filter((row) => row.value !== null);
  }, [hoverRow, series]);

  const handlePointerMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      if (data.length === 0) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const chartX = Math.max(margin.left, Math.min(margin.left + innerWidth, margin.left + localX));
      const ts = xScale.invert(chartX).getTime();
      const target = resolveNearestTarget(ts);
      if (!target) {
        return;
      }
      setHoverTarget(target);
      onHoverTarget?.(target);
    },
    [data.length, innerWidth, margin.left, onHoverTarget, resolveNearestTarget, xScale],
  );

  const handlePointerLeave = useCallback(() => {
    setHoverTarget(null);
    onLeave?.();
  }, [onLeave]);

  const handlePointerClick = useCallback(() => {
    if (!hoverTarget || !onPinTarget) {
      return;
    }
    onPinTarget(hoverTarget);
  }, [hoverTarget, onPinTarget]);

  return (
    <div ref={wrapperRef} style={{ width: "100%", height, position: "relative" }}>
      {chartWidth > 0 ? (
        <svg width={chartWidth} height={height}>
          <Group>
            {yScale.ticks(4).map((tick) => {
              const y = yScale(tick);
              return (
                <line
                  key={`grid-${tick}`}
                  x1={margin.left}
                  x2={margin.left + innerWidth}
                  y1={y}
                  y2={y}
                  stroke={gridColor}
                  strokeDasharray="4 4"
                />
              );
            })}

            {gapBands.map((segment, index) => {
              const x1 = xScale(new Date(segment.from));
              const x2 = xScale(new Date(segment.to));
              return (
                <rect
                  key={`gap-${index}`}
                  x={Math.min(x1, x2)}
                  y={margin.top}
                  width={Math.max(1, Math.abs(x2 - x1))}
                  height={innerHeight}
                  fill="rgba(148, 163, 184, 0.08)"
                />
              );
            })}

            {plottedSeries.map(({ config, segments }) =>
              segments.map((segment, index) => (
                <LinePath
                  key={`${config.key}-${index}`}
                  data={segment}
                  x={(point) => xScale(new Date(point.ts))}
                  y={(point) => yScale(point.value)}
                  stroke={config.color}
                  strokeWidth={config.strokeWidth ?? 1.8}
                />
              )),
            )}

            {plottedSeries.map(({ config, latest }) => {
              if (!latest) {
                return null;
              }
              const cx = xScale(new Date(latest.ts));
              const cy = yScale(latest.value);
              const latestLabel = config.latestLabelFormatter?.(latest.value);
              return (
                <g key={`latest-${config.key}`}>
                  <circle cx={cx} cy={cy} r={5} fill={config.color} stroke={C.surface} strokeWidth={2} />
                  {latestLabel ? (
                    <text
                      x={cx}
                      y={cy - 10}
                      textAnchor="middle"
                      fill={C.textBright}
                      fontSize={10}
                      fontWeight={700}
                    >
                      {latestLabel}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {hoverTarget ? (
              <line
                x1={xScale(new Date(hoverTarget.timestampMs))}
                x2={xScale(new Date(hoverTarget.timestampMs))}
                y1={margin.top}
                y2={margin.top + innerHeight}
                stroke="#94a3b8"
                strokeDasharray="4 4"
              />
            ) : null}
          </Group>

          <AxisLeft
            scale={yScale}
            left={margin.left}
            tickLabelProps={() => ({
              fill: axisLabelColor,
              fontSize: 10,
              textAnchor: "end",
              dy: "0.33em",
            })}
            stroke={gridColor}
            tickStroke={gridColor}
          />
          <AxisBottom
            scale={xScale}
            top={margin.top + innerHeight}
            numTicks={6}
            tickFormat={(value) => formatAbsoluteAxisTime(Number(value))}
            tickLabelProps={() => ({
              fill: axisLabelColor,
              fontSize: 9,
              textAnchor: "middle",
            })}
            stroke={gridColor}
            tickStroke={gridColor}
          />

          {showLegend ? (
            <Group top={6} left={margin.left + 6}>
              {series.map((seriesConfig, index) => (
                <g key={`legend-${seriesConfig.key}`} transform={`translate(${index * 74}, 0)`}>
                  <rect x={0} y={0} width={10} height={3} rx={2} fill={seriesConfig.color} />
                  <text x={14} y={4} fill={C.textMuted} fontSize={11} fontWeight={600}>
                    {seriesConfig.name}
                  </text>
                </g>
              ))}
            </Group>
          ) : null}

          <rect
            x={margin.left}
            y={margin.top}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={handlePointerMove}
            onMouseLeave={handlePointerLeave}
            onClick={handlePointerClick}
          />
        </svg>
      ) : null}

      {hoverTarget ? (
        <div
          style={{
            position: "absolute",
            left: Math.min(
              Math.max(8, xScale(new Date(hoverTarget.timestampMs)) + 10),
              Math.max(8, chartWidth - 210),
            ),
            top: 8,
            pointerEvents: "none",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "7px 9px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            color: C.textBright,
            fontSize: "0.68rem",
            lineHeight: 1.35,
            minWidth: 150,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {formatTooltipDateTime(hoverTarget.timestampMs)}
          </div>
          {hoverSeriesRows.length === 0 ? (
            <div style={{ color: C.textMuted, fontWeight: 600 }}>Mất dữ liệu tại mốc này</div>
          ) : (
            hoverSeriesRows.map((row) => (
              <div key={`hover-row-${row.key}`} style={{ color: row.color, fontWeight: 700 }}>
                {row.name}: {row.value?.toFixed(3)}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function SpectrumZoomChart({
  data,
  color,
  axisLabelColor,
  gridColor,
  maxHz,
  yMax,
  C,
}: {
  data: SpectrumChartDataPoint[];
  color: string;
  axisLabelColor: string;
  gridColor: string;
  maxHz: number;
  yMax: number;
  C: {
    surface: string;
    border: string;
    textBright: string;
    textMuted: string;
  };
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const chart = init(mount, undefined, { renderer: "canvas", useDirtyRect: true });
    chartRef.current = chart;

    const resize = () => {
      chart.resize();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    if (data.length === 0) {
      chart.clear();
      return;
    }

    const firstBin = data[0]?.bin ?? 0;
    const hzLabelByBin = new Map<number, string>();
    hzLabelByBin.set(firstBin, "0");
    if (maxHz >= 200) {
      const maxMarkedHz = Math.floor(maxHz / 200) * 200;
      for (let targetHz = 200; targetHz <= maxMarkedHz; targetHz += 200) {
        let nearest = data[0];
        let nearestDiff = Math.abs(data[0].freq - targetHz);
        for (let index = 1; index < data.length; index += 1) {
          const point = data[index];
          const diff = Math.abs(point.freq - targetHz);
          if (diff < nearestDiff) {
            nearest = point;
            nearestDiff = diff;
          }
        }
        hzLabelByBin.set(nearest.bin, `${targetHz}`);
      }
    }
    const peakPoint = data.reduce((best, point) => (point.amp > best.amp ? point : best), data[0]);
    const peakIndex = Math.max(0, data.findIndex((point) => point.bin === peakPoint.bin));

    const peakLabel = `Peak ${peakPoint.freq.toFixed(1)} Hz\n${peakPoint.amp.toFixed(3)} ${peakPoint.unit}`;
    const barData = data.map((point, index) => {
      const isPeak = index === peakIndex;
      return {
        value: point.amp,
        itemStyle: {
          color: isPeak ? "#f59e0b" : color,
        },
        label: isPeak
          ? {
              show: true,
              position: "top",
              distance: 8,
              color: C.textBright,
              backgroundColor: C.surface,
              borderColor: C.border,
              borderWidth: 1,
              borderRadius: 4,
              padding: [3, 5],
              fontSize: 10,
              fontWeight: 700,
              formatter: peakLabel,
            }
          : { show: false },
      };
    });

    const option: EChartsOption = {
      animation: false,
      grid: {
        left: 6,
        right: 8,
        top: 24,
        bottom: 24,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        backgroundColor: C.surface,
        borderColor: C.border,
        textStyle: {
          color: C.textBright,
          fontSize: 11,
        },
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          const first = list[0] as { dataIndex?: number } | undefined;
          const index = typeof first?.dataIndex === "number" ? first.dataIndex : -1;
          const point = index >= 0 && index < data.length ? data[index] : null;
          if (!point) {
            return "Không có dữ liệu";
          }

          return [
            `<div style="font-weight:700;margin-bottom:2px;">Bin ${point.bin}</div>`,
            `<div style="color:${C.textMuted};margin-bottom:3px;">f = ${formatFrequencyHz(point.freq)}</div>`,
            `<div style="color:${color};font-weight:700;">Biên độ: ${point.amp.toFixed(6)} ${point.unit}</div>`,
          ].join("");
        },
      },
      xAxis: {
        type: "category",
        data: data.map((point) => point.bin),
        axisLine: {
          lineStyle: {
            color: gridColor,
          },
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: axisLabelColor,
          fontSize: 9,
          interval: 0,
          formatter: (value: string | number) => {
            const parsed = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(parsed)) {
              return "";
            }
            return hzLabelByBin.get(parsed) ?? "";
          },
        },
      },
      yAxis: {
        type: "value",
        show: false,
        min: 0,
        max: yMax,
      },
      series: [
        {
          type: "bar",
          data: barData,
          barCategoryGap: "0%",
          animation: false,
          barMinHeight: 1,
          markPoint: {
            symbol: "circle",
            symbolSize: 14,
            z: 30,
            silent: true,
            itemStyle: {
              color: "#fde047",
              borderColor: "#1f2937",
              borderWidth: 2,
            },
            label: {
              show: true,
              position: "top",
              distance: 8,
              color: C.textBright,
              backgroundColor: C.surface,
              borderColor: C.border,
              borderWidth: 1,
              borderRadius: 4,
              padding: [3, 5],
              fontSize: 10,
              fontWeight: 700,
              formatter: peakLabel,
            },
            data: [
              {
                xAxis: peakPoint.bin,
                value: peakPoint.amp,
                yAxis: peakPoint.amp,
              },
            ],
          },
          markLine: {
            symbol: "none",
            silent: true,
            z: 25,
            lineStyle: {
              color,
              width: 1.2,
              type: "dashed",
              opacity: 0.85,
            },
            data: [
              {
                xAxis: peakPoint.bin,
              },
            ],
          },
        },
      ],
    };

    chart.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [C.border, C.surface, C.textBright, C.textMuted, axisLabelColor, color, data, gridColor, maxHz, yMax]);

  return <div ref={mountRef} style={{ width: "100%", height: 160 }} />;
}

/* ── 3D Canvas placeholder (Three.js) ── */
export type Accel3DPoint = {
  ts: number;
  ax: number;
  ay: number;
  az: number;
};

export function Accel3DCanvas({ C, accelPoints, height = 150 }: { C: any; accelPoints: Accel3DPoint[]; height?: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const trajectoryLineRef = useRef<THREE.Line | null>(null);
  const latestPointRef = useRef<THREE.Mesh | null>(null);
  const cubeRef = useRef<THREE.Mesh | null>(null);
  const cubeEdgesRef = useRef<THREE.LineSegments | null>(null);
  const [timeWindowSec, setTimeWindowSec] = useState(20);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1e42");

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(6, 4.8, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xb7d1ff, 0.95);
    directional.position.set(5, 8, 4);
    scene.add(directional);

    const world = new THREE.Group();
    scene.add(world);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({
        color: 0x163a78,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.42,
        roughness: 0.95,
        metalness: 0.05,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    world.add(plane);

    const grid = new THREE.GridHelper(12, 12, 0x66a3ff, 0x2f5eae);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.95;
    world.add(grid);

    const axes = new THREE.AxesHelper(9.6);
    const axesMaterials = Array.isArray(axes.material) ? axes.material : [axes.material];
    for (const material of axesMaterials) {
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = false;
      material.toneMapped = false;
    }
    axes.renderOrder = 999;
    axes.position.set(0, 0.03, 0);
    world.add(axes);

    const axisOverlay = new THREE.Group();
    axisOverlay.renderOrder = 1000;
    axisOverlay.position.set(0, 0.03, 0);
    world.add(axisOverlay);

    const axisLength = 3.4;
    const headLength = 0.55;
    const headWidth = 0.24;
    const xArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), axisLength, 0xef4444, headLength, headWidth);
    const yArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), axisLength, 0x22c55e, headLength, headWidth);
    const zArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), axisLength, 0x3b82f6, headLength, headWidth);
    const arrows = [xArrow, yArrow, zArrow];
    for (const arrow of arrows) {
      const lineMat = arrow.line.material as THREE.LineBasicMaterial;
      lineMat.depthTest = false;
      lineMat.depthWrite = false;
      lineMat.toneMapped = false;
      const coneMat = arrow.cone.material as THREE.MeshBasicMaterial;
      coneMat.depthTest = false;
      coneMat.depthWrite = false;
      coneMat.toneMapped = false;
      arrow.renderOrder = 1000;
      axisOverlay.add(arrow);
    }

    const makeAxisLabel = (text: "X" | "Y" | "Z", color: string) => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return new THREE.Object3D();
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "rgba(2,6,23,0.72)";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "700 64px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, size / 2, size / 2 + 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      material.toneMapped = false;
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.58, 0.58, 0.58);
      sprite.renderOrder = 1001;
      return sprite;
    };

    const xLabel = makeAxisLabel("X", "#ef4444");
    const yLabel = makeAxisLabel("Y", "#22c55e");
    const zLabel = makeAxisLabel("Z", "#3b82f6");
    xLabel.position.set(axisLength + 0.42, 0, 0);
    yLabel.position.set(0, axisLength + 0.42, 0);
    zLabel.position.set(0, 0, axisLength + 0.42);
    axisOverlay.add(xLabel);
    axisOverlay.add(yLabel);
    axisOverlay.add(zLabel);

    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    origin.position.set(0, 0.06, 0);
    world.add(origin);

    // Debug reference cube: centered exactly at world origin (0, 0, 0)
    const originCube = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 1.05, 1.05),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.35,
        roughness: 0.45,
        metalness: 0.12,
      }),
    );
    originCube.position.set(0, 0, 0);
    world.add(originCube);
    cubeRef.current = originCube;

    const originCubeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.05, 1.05, 1.05)),
      new THREE.LineBasicMaterial({ color: 0xfbbf24 }),
    );
    originCubeEdges.position.set(0, 0, 0);
    world.add(originCubeEdges);
    cubeEdgesRef.current = originCubeEdges;

    const trajectoryGeometry = new THREE.BufferGeometry();
    trajectoryGeometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    trajectoryGeometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
    const trajectoryLine = new THREE.Line(
      trajectoryGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
      }),
    );
    world.add(trajectoryLine);
    trajectoryLineRef.current = trajectoryLine;

    const latestPoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xfde047 }),
    );
    latestPoint.position.set(0, 0, 0);
    world.add(latestPoint);
    latestPointRef.current = latestPoint;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.minDistance = 4;
    controls.maxDistance = 22;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.screenSpacePanning = true;

    const gizmo = new ViewportGizmo(camera, renderer, {
      container: mount.parentElement ?? mount,
      type: "rounded-cube",
      size: 72,
      placement: "bottom-right",
      offset: { right: 10, bottom: 8 },
      animated: true,
      speed: 1.2,
      background: {
        color: 0xffffff,
        opacity: 1,
        hover: { color: 0xf8fafc, opacity: 1 },
      },
      corners: {
        color: 0xffffff,
        opacity: 1,
      },
      edges: {
        color: 0xf1f5f9,
        opacity: 1,
      },
      x: { color: 0xef4444, label: "X", labelColor: 0x111827 },
      y: { color: 0x22c55e, label: "Y", labelColor: 0x111827 },
      z: { color: 0x3b82f6, label: "Z", labelColor: 0x111827 },
      nx: { color: 0xfca5a5, label: "-X", labelColor: 0x111827 },
      ny: { color: 0x86efac, label: "-Y", labelColor: 0x111827 },
      nz: { color: 0x93c5fd, label: "-Z", labelColor: 0x111827 },
    });
    gizmo.attachControls(controls);
    const centerSceneView = () => {
      controls.target.set(0, 0, 0);
      camera.position.set(6, 4.8, 6);
      camera.lookAt(0, 0, 0);
      controls.update();
    };
    resetViewRef.current = centerSceneView;
    centerSceneView();

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      centerSceneView();
      gizmo.update();
    };
    resize();
    // Ensure stable centering after modal/layout transitions settle.
    const settleFrame1 = window.requestAnimationFrame(() => resize());
    const settleFrame2 = window.setTimeout(() => resize(), 80);
    const settleFrame3 = window.setTimeout(() => resize(), 240);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let raf = 0;
    const animate = () => {
      raf = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      gizmo.render();
    };
    animate();

    return () => {
      window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(settleFrame1);
      window.clearTimeout(settleFrame2);
      window.clearTimeout(settleFrame3);
      resizeObserver.disconnect();
      gizmo.detachControls();
      gizmo.dispose();
      controls.dispose();
      scene.clear();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      resetViewRef.current = null;
      trajectoryLineRef.current = null;
      latestPointRef.current = null;
      cubeRef.current = null;
      cubeEdgesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const line = trajectoryLineRef.current;
    const latestPoint = latestPointRef.current;
    const cube = cubeRef.current;
    const cubeEdges = cubeEdgesRef.current;
    if (!line || !latestPoint || !cube || !cubeEdges) {
      return;
    }

    const sortedPoints = accelPoints
      .filter((item) =>
        Number.isFinite(item.ts) &&
        Number.isFinite(item.ax) &&
        Number.isFinite(item.ay) &&
        Number.isFinite(item.az),
      )
      .sort((a, b) => a.ts - b.ts);

    if (sortedPoints.length === 0) {
      const geometry = line.geometry as THREE.BufferGeometry;
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
      geometry.computeBoundingSphere();
      latestPoint.visible = false;
      cube.position.set(0, 0, 0);
      cubeEdges.position.set(0, 0, 0);
      return;
    }

    const latestTs = sortedPoints[sortedPoints.length - 1].ts;
    const windowStart = latestTs - timeWindowSec * 1000;

    let points = sortedPoints.filter((item) => item.ts >= windowStart);
    if (points.length < 2) {
      points = sortedPoints.slice(-Math.min(20, sortedPoints.length));
    }

    const MAX_POINTS = 140;
    if (points.length > MAX_POINTS) {
      const sampled: Accel3DPoint[] = [];
      for (let i = 0; i < MAX_POINTS; i += 1) {
        const idx = Math.round((i / (MAX_POINTS - 1)) * (points.length - 1));
        sampled.push(points[idx]);
      }
      points = sampled;
    }

    if (points.length === 0) {
      const geometry = line.geometry as THREE.BufferGeometry;
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
      geometry.computeBoundingSphere();
      latestPoint.visible = false;
      cube.position.set(0, 0, 0);
      cubeEdges.position.set(0, 0, 0);
      return;
    }

    const smooth = points.map((item, index) => {
      const prev = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      return {
        ...item,
        ax: (prev.ax + item.ax + next.ax) / 3,
        ay: (prev.ay + item.ay + next.ay) / 3,
        az: (prev.az + item.az + next.az) / 3,
      };
    });

    const meanX = smooth.reduce((sum, item) => sum + item.ax, 0) / smooth.length;
    const meanY = smooth.reduce((sum, item) => sum + item.ay, 0) / smooth.length;
    const meanZ = smooth.reduce((sum, item) => sum + item.az, 0) / smooth.length;

    let maxAbs = 0;
    for (const item of smooth) {
      maxAbs = Math.max(
        maxAbs,
        Math.abs(item.ax - meanX),
        Math.abs(item.ay - meanY),
        Math.abs(item.az - meanZ),
      );
    }
    const scale = maxAbs > 0 ? 2.8 / maxAbs : 1;

    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    const mapPoint = (item: Accel3DPoint) => ({
      x: (item.ax - meanX) * scale,
      y: (item.az - meanZ) * scale,
      z: (item.ay - meanY) * scale,
    });

    smooth.forEach((item, index) => {
      const p = mapPoint(item);
      const offset = index * 3;
      positions[offset] = p.x;
      positions[offset + 1] = p.y;
      positions[offset + 2] = p.z;

      const t = smooth.length <= 1 ? 1 : index / (smooth.length - 1);
      const start = new THREE.Color("#22d3ee");
      const end = new THREE.Color("#facc15");
      const color = start.lerp(end, t);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    });

    // Highlight missing-data intervals in trajectory by painting those segments red.
    const diffsMs: number[] = [];
    for (let index = 1; index < smooth.length; index += 1) {
      const diff = smooth[index].ts - smooth[index - 1].ts;
      if (Number.isFinite(diff) && diff > 0) {
        diffsMs.push(diff);
      }
    }
    if (diffsMs.length > 0) {
      const sortedDiffs = [...diffsMs].sort((a, b) => a - b);
      const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)];
      const gapThresholdMs = Math.max(2000, medianDiff * 2.5);
      const gapColor = new THREE.Color("#fb7185");

      for (let index = 1; index < smooth.length; index += 1) {
        const diff = smooth[index].ts - smooth[index - 1].ts;
        if (diff > gapThresholdMs) {
          const currentOffset = index * 3;
          const previousOffset = (index - 1) * 3;
          colors[currentOffset] = gapColor.r;
          colors[currentOffset + 1] = gapColor.g;
          colors[currentOffset + 2] = gapColor.b;
          colors[previousOffset] = gapColor.r;
          colors[previousOffset + 1] = gapColor.g;
          colors[previousOffset + 2] = gapColor.b;
        }
      }
    }

    const geometry = line.geometry as THREE.BufferGeometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const latest = mapPoint(smooth[smooth.length - 1]);
    latestPoint.visible = true;
    latestPoint.position.set(latest.x, latest.y, latest.z);
    cube.position.copy(latestPoint.position);
    cubeEdges.position.copy(latestPoint.position);
  }, [accelPoints, timeWindowSec]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: 10,
        border: `1px solid ${C.cardBorder}`,
        overflow: "hidden",
      }}
    >
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      <button
        type="button"
        onClick={() => resetViewRef.current?.()}
        style={{
          position: "absolute",
          right: 10,
          top: 8,
          borderRadius: 6,
          border: `1px solid ${C.border}`,
          background: "rgba(2, 6, 23, 0.42)",
          color: C.textMuted,
          fontSize: "0.62rem",
          fontWeight: 600,
          padding: "2px 8px",
          cursor: "pointer",
        }}
      >
        Reset View
      </button>
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        {[10, 20, 40].map((sec) => {
          const active = sec === timeWindowSec;
          return (
            <button
              key={sec}
              type="button"
              onClick={() => setTimeWindowSec(sec)}
              style={{
                borderRadius: 999,
                border: `1px solid ${active ? C.primary : C.border}`,
                background: active ? "rgba(59,130,246,0.18)" : "rgba(2, 6, 23, 0.42)",
                color: active ? C.textBright : C.textMuted,
                fontSize: "0.62rem",
                fontWeight: 700,
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              {sec}s
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Section wrapper ── */
function ChartSection({ title, icon, children, C }: { title: string; icon: React.ReactNode; children: React.ReactNode; C: any }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ color: C.primary }}>{icon}</span>
        <span style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{
        background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
        padding: "12px 8px 8px",
      }}>
        {children}
      </div>
    </div>
  );
}

/* ── Main Modal ── */
type TelemetryHistoryRequestOptions = {
  limit?: number;
  from?: string;
  to?: string;
  force?: boolean;
  replace?: boolean;
};

interface Props {
  sensor: Sensor | null;
  telemetryPoints?: DeviceTelemetryPoint[];
  telemetryLoading?: boolean;
  spectrumPoints?: DeviceSpectrumPoint[];
  onRequestTelemetryHistory?: (deviceId: string, options?: TelemetryHistoryRequestOptions) => Promise<void>;
  onNotify?: (message: Omit<ToastItem, "id">) => void;
  onDeviceDataCleared?: (deviceId: string) => void;
  onClose: () => void;
}

export function SensorChartModal({
  sensor,
  telemetryPoints = [],
  telemetryLoading = false,
  spectrumPoints = [],
  onRequestTelemetryHistory,
  onNotify,
  onDeviceDataCleared,
  onClose,
}: Props) {
  const { C } = useTheme();
  const [visible, setVisible] = useState(false);
  const [tempHalfSpan, setTempHalfSpan] = useState(5);
  const [accelAmplitudeLimit, setAccelAmplitudeLimit] = useState(ACCEL_LIMIT_MS2);
  const [trendWindowOffset, setTrendWindowOffset] = useState(0);
  const [trendVisiblePoints, setTrendVisiblePoints] = useState(DEFAULT_VISIBLE_POINTS);
  const [activeHistoryPreset, setActiveHistoryPreset] = useState<HistoryPresetKey | null>(DEFAULT_HISTORY_PRESET_KEY);
  const [timePresetMenuOpen, setTimePresetMenuOpen] = useState(false);
  const [telemetryWindowAnchorMs, setTelemetryWindowAnchorMs] = useState<number>(() => Date.now());
  const [historyPresetLoading, setHistoryPresetLoading] = useState<HistoryPresetKey | null>(null);
  const [trendRenderReloading, setTrendRenderReloading] = useState(false);
  const [panningChart, setPanningChart] = useState<"temp" | "accel" | null>(null);
  const [hoverSpectrumPoints, setHoverSpectrumPoints] = useState<DeviceSpectrumPoint[] | null>(null);
  const [hoverSpectrumLoading, setHoverSpectrumLoading] = useState(false);
  const [hoverSpectrumDebouncing, setHoverSpectrumDebouncing] = useState(false);
  const [spectrumPinnedTarget, setSpectrumPinnedTarget] = useState<SpectrumHoverTarget | null>(null);
  const [hoverTelemetrySnapshot, setHoverTelemetrySnapshot] = useState<HoverTelemetrySnapshot | null>(null);
  const [settingsTooltipVisible, setSettingsTooltipVisible] = useState(false);
  const [dataSettingsOpen, setDataSettingsOpen] = useState(false);
  const [dataSettingsMounted, setDataSettingsMounted] = useState(false);
  const [dataSettingsClosing, setDataSettingsClosing] = useState(false);
  const [dataSummary, setDataSummary] = useState<DeviceDataSummary | null>(null);
  const [dataSummaryLoading, setDataSummaryLoading] = useState(false);
  const [dataSummaryError, setDataSummaryError] = useState("");
  const [clearDataConfirmMounted, setClearDataConfirmMounted] = useState(false);
  const [clearDataConfirmClosing, setClearDataConfirmClosing] = useState(false);
  const [clearingDeviceData, setClearingDeviceData] = useState(false);
  const panStateRef = useRef<ChartPanState | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const spectrumHoverTimerRef = useRef<number | null>(null);
  const lastSpectrumHoverTsRef = useRef<number | null>(null);
  const spectrumRequestSeqRef = useRef(0);
  const dataSettingsCloseTimerRef = useRef<number | null>(null);
  const dataSettingsSummaryFetchTimerRef = useRef<number | null>(null);
  const dataSummaryLoadedAtRef = useRef<number>(0);
  const clearDataConfirmCloseTimerRef = useRef<number | null>(null);
  const autoPresetLoadedSensorIdRef = useRef<string | null>(null);
  const timePresetMenuRef = useRef<HTMLDivElement | null>(null);
  const trendReloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (sensor) { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }
    else { setVisible(false); }
  }, [sensor]);

  const handleClose = useCallback(() => {
    if (clearingDeviceData) {
      return;
    }
    if (closeTimerRef.current !== null) {
      return;
    }
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 220);
  }, [clearingDeviceData, onClose]);

  const showTrendReloadSpinner = useCallback(() => {
    if (trendReloadTimerRef.current !== null) {
      window.clearTimeout(trendReloadTimerRef.current);
      trendReloadTimerRef.current = null;
    }
    setTrendRenderReloading(true);
  }, []);

  const hideTrendReloadSpinner = useCallback((delayMs = TREND_RELOAD_SPINNER_MIN_MS) => {
    if (trendReloadTimerRef.current !== null) {
      window.clearTimeout(trendReloadTimerRef.current);
    }
    trendReloadTimerRef.current = window.setTimeout(() => {
      trendReloadTimerRef.current = null;
      setTrendRenderReloading(false);
    }, delayMs);
  }, []);

  const pulseTrendReloadSpinner = useCallback((delayMs = TREND_RELOAD_SPINNER_MIN_MS) => {
    showTrendReloadSpinner();
    hideTrendReloadSpinner(delayMs);
  }, [hideTrendReloadSpinner, showTrendReloadSpinner]);

  useEffect(() => {
    return () => {
      if (trendReloadTimerRef.current !== null) {
        window.clearTimeout(trendReloadTimerRef.current);
        trendReloadTimerRef.current = null;
      }
    };
  }, []);

  const openDataSettings = useCallback(() => {
    if (clearingDeviceData) {
      return;
    }
    setSettingsTooltipVisible(false);
    if (dataSettingsCloseTimerRef.current !== null) {
      window.clearTimeout(dataSettingsCloseTimerRef.current);
      dataSettingsCloseTimerRef.current = null;
    }
    setDataSettingsClosing(false);
    setDataSettingsOpen(true);
    setDataSettingsMounted(true);
  }, [clearingDeviceData]);

  const closeDataSettings = useCallback(() => {
    if (clearingDeviceData) {
      return;
    }
    if (!dataSettingsMounted || dataSettingsClosing) {
      return;
    }
    setSettingsTooltipVisible(false);
    setDataSettingsClosing(true);
    setDataSettingsOpen(false);
    if (dataSettingsCloseTimerRef.current !== null) {
      window.clearTimeout(dataSettingsCloseTimerRef.current);
    }
    dataSettingsCloseTimerRef.current = window.setTimeout(() => {
      dataSettingsCloseTimerRef.current = null;
      setDataSettingsClosing(false);
      setDataSettingsMounted(false);
    }, DATA_SETTINGS_MODAL_CLOSE_MS);
  }, [clearingDeviceData, dataSettingsClosing, dataSettingsMounted]);

  const openClearDataConfirm = useCallback(() => {
    if (clearingDeviceData) {
      return;
    }
    if (clearDataConfirmCloseTimerRef.current !== null) {
      window.clearTimeout(clearDataConfirmCloseTimerRef.current);
      clearDataConfirmCloseTimerRef.current = null;
    }
    setClearDataConfirmClosing(false);
    setClearDataConfirmMounted(true);
  }, [clearingDeviceData]);

  const closeClearDataConfirm = useCallback(
    (options?: { force?: boolean; immediate?: boolean }) => {
      const forceClose = options?.force === true;
      const immediateClose = options?.immediate === true;
      if (clearingDeviceData && !forceClose) {
        return;
      }
      if (clearDataConfirmCloseTimerRef.current !== null) {
        window.clearTimeout(clearDataConfirmCloseTimerRef.current);
        clearDataConfirmCloseTimerRef.current = null;
      }
      if (immediateClose) {
        setClearDataConfirmClosing(false);
        setClearDataConfirmMounted(false);
        return;
      }
      if (!clearDataConfirmMounted || clearDataConfirmClosing) {
        return;
      }
      setClearDataConfirmClosing(true);
      clearDataConfirmCloseTimerRef.current = window.setTimeout(() => {
        clearDataConfirmCloseTimerRef.current = null;
        setClearDataConfirmClosing(false);
        setClearDataConfirmMounted(false);
      }, CLEAR_DATA_CONFIRM_MODAL_CLOSE_MS);
    },
    [clearDataConfirmClosing, clearDataConfirmMounted, clearingDeviceData],
  );

  const loadDeviceDataSummary = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!sensor) {
        return;
      }
      const useSilent = options?.silent === true;
      if (!useSilent) {
        setDataSummaryLoading(true);
      }
      setDataSummaryError("");

      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(sensor.id)}/data-summary`, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(safeString(asRecord(body).error || "device_data_summary_failed"));
        }
        const summary = parseDeviceDataSummaryPayload(body);
        if (!summary) {
          throw new Error("device_data_summary_invalid");
        }
        setDataSummary(summary);
        dataSummaryLoadedAtRef.current = Date.now();
      } catch (error) {
        setDataSummary(null);
        dataSummaryLoadedAtRef.current = 0;
        setDataSummaryError(safeString(error));
      } finally {
        if (!useSilent) {
          setDataSummaryLoading(false);
        }
      }
    },
    [sensor],
  );

  const clearDeviceData = useCallback(async () => {
    if (!sensor || clearingDeviceData) {
      return;
    }

    setClearingDeviceData(true);
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(sensor.id)}/data`, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "device_data_clear_failed"));
      }

      const payload = asRecord(asRecord(body).data);
      const telemetryDeleted = Math.max(0, Math.floor(asFiniteNumber(payload.telemetryDeleted) ?? 0));
      const spectrumFramesDeleted = Math.max(0, Math.floor(asFiniteNumber(payload.spectrumFramesDeleted) ?? 0));

      setHoverSpectrumPoints(null);
      setHoverSpectrumLoading(false);
      setHoverSpectrumDebouncing(false);
      setSpectrumPinnedTarget(null);
      setHoverTelemetrySnapshot(null);
      lastSpectrumHoverTsRef.current = null;
      if (spectrumHoverTimerRef.current !== null) {
        window.clearTimeout(spectrumHoverTimerRef.current);
        spectrumHoverTimerRef.current = null;
      }

      onDeviceDataCleared?.(sensor.id);
      onNotify?.({
        type: "success",
        title: "Đã xoá dữ liệu",
        text: `${sensor.name || sensor.id}: ${telemetryDeleted} bản ghi telemetry, ${spectrumFramesDeleted} frame phổ.`,
      });
      closeClearDataConfirm({ force: true });
      dataSummaryLoadedAtRef.current = 0;
      void loadDeviceDataSummary({ silent: true });
    } catch (error) {
      onNotify?.({
        type: "warning",
        title: "Xoá dữ liệu thất bại",
        text: safeString(error),
      });
    } finally {
      setClearingDeviceData(false);
    }
  }, [clearingDeviceData, closeClearDataConfirm, loadDeviceDataSummary, onDeviceDataCleared, onNotify, sensor]);

  useEffect(() => {
    if (!sensor || !dataSettingsOpen) {
      return;
    }

    const now = Date.now();
    const hasCachedSummary = dataSummary !== null;
    const cacheAgeMs = now - dataSummaryLoadedAtRef.current;
    const cacheFresh = hasCachedSummary && dataSummaryLoadedAtRef.current > 0 && cacheAgeMs < DATA_SETTINGS_SUMMARY_CACHE_TTL_MS;
    if (cacheFresh && !dataSummaryError) {
      return;
    }

    if (dataSettingsSummaryFetchTimerRef.current !== null) {
      window.clearTimeout(dataSettingsSummaryFetchTimerRef.current);
      dataSettingsSummaryFetchTimerRef.current = null;
    }
    dataSettingsSummaryFetchTimerRef.current = window.setTimeout(() => {
      dataSettingsSummaryFetchTimerRef.current = null;
      void loadDeviceDataSummary({ silent: hasCachedSummary });
    }, DATA_SETTINGS_SUMMARY_FETCH_DELAY_MS);

    return () => {
      if (dataSettingsSummaryFetchTimerRef.current !== null) {
        window.clearTimeout(dataSettingsSummaryFetchTimerRef.current);
        dataSettingsSummaryFetchTimerRef.current = null;
      }
    };
  }, [dataSettingsOpen, dataSummary, dataSummaryError, loadDeviceDataSummary, sensor]);

  useEffect(() => {
    if (!sensor) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (clearDataConfirmMounted || clearingDeviceData || dataSettingsMounted) {
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      handleClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [clearDataConfirmMounted, clearingDeviceData, dataSettingsMounted, sensor, handleClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (spectrumHoverTimerRef.current !== null) {
        window.clearTimeout(spectrumHoverTimerRef.current);
        spectrumHoverTimerRef.current = null;
      }
      if (dataSettingsCloseTimerRef.current !== null) {
        window.clearTimeout(dataSettingsCloseTimerRef.current);
        dataSettingsCloseTimerRef.current = null;
      }
      if (dataSettingsSummaryFetchTimerRef.current !== null) {
        window.clearTimeout(dataSettingsSummaryFetchTimerRef.current);
        dataSettingsSummaryFetchTimerRef.current = null;
      }
      if (clearDataConfirmCloseTimerRef.current !== null) {
        window.clearTimeout(clearDataConfirmCloseTimerRef.current);
        clearDataConfirmCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setHoverSpectrumPoints(null);
    setHoverSpectrumLoading(false);
    setHoverSpectrumDebouncing(false);
    setSpectrumPinnedTarget(null);
    setHoverTelemetrySnapshot(null);
    setSettingsTooltipVisible(false);
    setDataSettingsOpen(false);
    setDataSettingsMounted(false);
    setDataSettingsClosing(false);
    setDataSummary(null);
    setDataSummaryLoading(false);
    setDataSummaryError("");
    setClearDataConfirmMounted(false);
    setClearDataConfirmClosing(false);
    setClearingDeviceData(false);
    dataSummaryLoadedAtRef.current = 0;
    lastSpectrumHoverTsRef.current = null;
    if (spectrumHoverTimerRef.current !== null) {
      window.clearTimeout(spectrumHoverTimerRef.current);
      spectrumHoverTimerRef.current = null;
    }
    if (dataSettingsCloseTimerRef.current !== null) {
      window.clearTimeout(dataSettingsCloseTimerRef.current);
      dataSettingsCloseTimerRef.current = null;
    }
    if (dataSettingsSummaryFetchTimerRef.current !== null) {
      window.clearTimeout(dataSettingsSummaryFetchTimerRef.current);
      dataSettingsSummaryFetchTimerRef.current = null;
    }
    if (clearDataConfirmCloseTimerRef.current !== null) {
      window.clearTimeout(clearDataConfirmCloseTimerRef.current);
      clearDataConfirmCloseTimerRef.current = null;
    }
    setTimePresetMenuOpen(false);
  }, [sensor?.id]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!timePresetMenuOpen) {
        return;
      }
      const targetNode = event.target as Node | null;
      const menuNode = timePresetMenuRef.current;
      if (!menuNode || !targetNode || menuNode.contains(targetNode)) {
        return;
      }
      setTimePresetMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [timePresetMenuOpen]);

  const telemetryTimeline = useMemo<HoverTelemetrySnapshot[]>(() => {
    const points = telemetryPoints
      .map((point) => {
        const ts = Date.parse(point.receivedAt);
        if (!Number.isFinite(ts)) {
          return null;
        }

        return {
          ts,
          temp:
            typeof point.temperature === "number" && Number.isFinite(point.temperature)
              ? Number(point.temperature.toFixed(2))
              : undefined,
          ax:
            typeof point.ax === "number" && Number.isFinite(point.ax)
              ? Number((point.ax * GRAVITY_MS2).toFixed(3))
              : undefined,
          ay:
            typeof point.ay === "number" && Number.isFinite(point.ay)
              ? Number((point.ay * GRAVITY_MS2).toFixed(3))
              : undefined,
          az:
            typeof point.az === "number" && Number.isFinite(point.az)
              ? Number((point.az * GRAVITY_MS2).toFixed(3))
              : undefined,
        } satisfies HoverTelemetrySnapshot;
      })
      .filter((point): point is HoverTelemetrySnapshot => Boolean(point));

    return points.sort((left, right) => left.ts - right.ts);
  }, [telemetryPoints]);

  const findNearestTelemetrySnapshot = useCallback(
    (targetTs: number): HoverTelemetrySnapshot | null => {
      if (telemetryTimeline.length === 0) {
        return null;
      }

      let low = 0;
      let high = telemetryTimeline.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((telemetryTimeline[middle]?.ts ?? 0) < targetTs) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      const right = telemetryTimeline[low] ?? null;
      const left = telemetryTimeline[Math.max(0, low - 1)] ?? null;
      if (!left) {
        return right;
      }
      if (!right) {
        return left;
      }

      const leftDiff = Math.abs(left.ts - targetTs);
      const rightDiff = Math.abs(right.ts - targetTs);
      return leftDiff <= rightDiff ? left : right;
    },
    [telemetryTimeline],
  );

  const requestSpectrumFrameAt = useCallback(
    async (timestampMs: number, telemetryUuid?: string, options?: { force?: boolean }) => {
      if (!sensor) {
        return;
      }

      const requestAt = Math.floor(timestampMs);
      const previousRequestedAt = lastSpectrumHoverTsRef.current;
      if (
        !options?.force &&
        typeof previousRequestedAt === "number" &&
        Math.abs(previousRequestedAt - requestAt) < SPECTRUM_HOVER_FETCH_MIN_DELTA_MS
      ) {
        return;
      }

      lastSpectrumHoverTsRef.current = requestAt;
      const requestId = spectrumRequestSeqRef.current + 1;
      spectrumRequestSeqRef.current = requestId;
      setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
      setHoverSpectrumLoading(true);

      try {
        const query = new URLSearchParams({
          at: new Date(requestAt).toISOString(),
        });
        if (telemetryUuid) {
          query.set("telemetryUuid", telemetryUuid);
        }
        const response = await fetch(
          `/api/devices/${encodeURIComponent(sensor.id)}/spectrum-frame?${query.toString()}`,
          {
            headers: {
              Accept: "application/json",
            },
          },
        );
        const bodyText = await response.text();
        let payload: unknown = null;
        if (bodyText) {
          try {
            payload = JSON.parse(bodyText);
          } catch {
            payload = null;
          }
        }

        if (requestId !== spectrumRequestSeqRef.current) {
          return;
        }
        if (!response.ok || !payload) {
          setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
          return;
        }

        const points = parseSpectrumFramePayload(payload);
        setHoverSpectrumPoints(points);
      } catch {
        if (requestId === spectrumRequestSeqRef.current) {
          setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
        }
      } finally {
        if (requestId === spectrumRequestSeqRef.current) {
          setHoverSpectrumLoading(false);
        }
      }
    },
    [sensor],
  );

  const handleTelemetryChartHover = useCallback(
    (state: unknown) => {
      if (spectrumPinnedTarget) {
        return;
      }

      const target = parseSpectrumHoverTarget(state);
      if (!target) {
        return;
      }
      setHoverTelemetrySnapshot(findNearestTelemetrySnapshot(target.timestampMs));

      if (spectrumHoverTimerRef.current !== null) {
        window.clearTimeout(spectrumHoverTimerRef.current);
      }
      setHoverSpectrumDebouncing(true);
      spectrumHoverTimerRef.current = window.setTimeout(() => {
        spectrumHoverTimerRef.current = null;
        setHoverSpectrumDebouncing(false);
        void requestSpectrumFrameAt(target.timestampMs, target.telemetryUuid);
      }, SPECTRUM_HOVER_FETCH_DEBOUNCE_MS);
    },
    [findNearestTelemetrySnapshot, requestSpectrumFrameAt, spectrumPinnedTarget],
  );

  const handleTelemetryChartPin = useCallback(
    (state: unknown) => {
      const target = parseSpectrumHoverTarget(state);
      if (!target) {
        return;
      }

      if (spectrumHoverTimerRef.current !== null) {
        window.clearTimeout(spectrumHoverTimerRef.current);
        spectrumHoverTimerRef.current = null;
      }
      setHoverSpectrumDebouncing(false);
      setSpectrumPinnedTarget(target);
      setHoverTelemetrySnapshot(findNearestTelemetrySnapshot(target.timestampMs));
      setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
      void requestSpectrumFrameAt(target.timestampMs, target.telemetryUuid, { force: true });
    },
    [findNearestTelemetrySnapshot, requestSpectrumFrameAt],
  );

  const handleTelemetryChartLeave = useCallback(() => {
    if (spectrumPinnedTarget) {
      return;
    }
    if (spectrumHoverTimerRef.current !== null) {
      window.clearTimeout(spectrumHoverTimerRef.current);
      spectrumHoverTimerRef.current = null;
    }
    setHoverSpectrumDebouncing(false);
    setHoverSpectrumLoading(false);
    setHoverSpectrumPoints(null);
    setHoverTelemetrySnapshot(null);
    lastSpectrumHoverTsRef.current = null;
  }, [spectrumPinnedTarget]);

  const handleTelemetryChartUnpin = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!spectrumPinnedTarget) {
      return;
    }
    if (spectrumHoverTimerRef.current !== null) {
      window.clearTimeout(spectrumHoverTimerRef.current);
      spectrumHoverTimerRef.current = null;
    }
    setHoverSpectrumDebouncing(false);
    setSpectrumPinnedTarget(null);
    lastSpectrumHoverTsRef.current = null;
  }, [spectrumPinnedTarget]);

  const handleHistoryPresetSelect = useCallback(
    async (preset: HistoryPresetKey) => {
      if (!sensor || !onRequestTelemetryHistory) {
        return;
      }

      const matchedPreset = TELEMETRY_HISTORY_PRESETS.find((item) => item.key === preset);
      if (!matchedPreset) {
        return;
      }

      const now = Date.now();
      setTelemetryWindowAnchorMs(now);
      const options: TelemetryHistoryRequestOptions = {
        from: new Date(now - matchedPreset.windowMs).toISOString(),
        to: new Date(now).toISOString(),
        limit: matchedPreset.limit,
        force: true,
        replace: true,
      };

      showTrendReloadSpinner();
      setHistoryPresetLoading(preset);
      try {
        await onRequestTelemetryHistory(sensor.id, options);
        setActiveHistoryPreset(preset);
        // With long presets, default to showing all fetched points instead of a reduced viewport.
        setTrendVisiblePoints(clampTrendVisiblePoints(Math.max(DEFAULT_VISIBLE_POINTS, matchedPreset.limit)));
        setTrendWindowOffset(0);
      } finally {
        hideTrendReloadSpinner(220);
        setHistoryPresetLoading((current) => (current === preset ? null : current));
      }
    },
    [hideTrendReloadSpinner, onRequestTelemetryHistory, sensor, showTrendReloadSpinner],
  );

  const activePresetConfig = useMemo(
    () =>
      TELEMETRY_HISTORY_PRESETS.find((preset) => preset.key === activeHistoryPreset)
      ?? TELEMETRY_HISTORY_PRESETS.find((preset) => preset.key === DEFAULT_HISTORY_PRESET_KEY)
      ?? TELEMETRY_HISTORY_PRESETS[0],
    [activeHistoryPreset],
  );

  const telemetryWindowStartMs = useMemo(() => {
    if (!activePresetConfig) {
      return telemetryWindowAnchorMs - 60 * 60 * 1000;
    }
    return telemetryWindowAnchorMs - activePresetConfig.windowMs;
  }, [activePresetConfig, telemetryWindowAnchorMs]);

  const timelineTelemetryData = useMemo<DenseTelemetryRow[]>(() => {
    if (!sensor || !activePresetConfig) {
      return [];
    }

    const startMs = telemetryWindowStartMs;
    const endMs = telemetryWindowAnchorMs;
    const makeNullRow = (ts: number): DenseTelemetryRow => ({
      ts,
      temp: null,
      ax: null,
      ay: null,
      az: null,
    });

    const hasAnyValue = (row: DenseTelemetryRow): boolean =>
      row.temp !== null || row.ax !== null || row.ay !== null || row.az !== null;

    const rawRows = telemetryPoints
      .map((point) => {
        const sourceTs = Date.parse(point.receivedAt);
        if (!Number.isFinite(sourceTs) || sourceTs < startMs || sourceTs > endMs) {
          return null;
        }

        return {
          ts: sourceTs,
          telemetryUuid: point.telemetryUuid,
          temp:
            typeof point.temperature === "number" && Number.isFinite(point.temperature)
              ? Number(point.temperature.toFixed(2))
              : null,
          ax:
            typeof point.ax === "number" && Number.isFinite(point.ax)
              ? Number((point.ax * GRAVITY_MS2).toFixed(4))
              : null,
          ay:
            typeof point.ay === "number" && Number.isFinite(point.ay)
              ? Number((point.ay * GRAVITY_MS2).toFixed(4))
              : null,
          az:
            typeof point.az === "number" && Number.isFinite(point.az)
              ? Number((point.az * GRAVITY_MS2).toFixed(4))
              : null,
        };
      })
      .filter((row): row is DenseTelemetryRow => Boolean(row))
      .sort((left, right) => left.ts - right.ts);

    if (rawRows.length === 0) {
      const safeEnd = endMs > startMs ? endMs : startMs + 1;
      return [makeNullRow(startMs), makeNullRow(safeEnd)];
    }

    // De-duplicate by timestamp while keeping the latest payload for that instant.
    const byTs = new Map<number, DenseTelemetryRow>();
    for (const row of rawRows) {
      byTs.set(row.ts, row);
    }
    const uniqueRows = Array.from(byTs.values()).sort((left, right) => left.ts - right.ts);

    const diffs: number[] = [];
    for (let index = 1; index < uniqueRows.length; index += 1) {
      const diff = uniqueRows[index].ts - uniqueRows[index - 1].ts;
      if (Number.isFinite(diff) && diff > 0) {
        diffs.push(diff);
      }
    }
    const fallbackStepMs = Math.max(
      1000,
      Math.round((endMs - startMs) / Math.max(30, activePresetConfig.visiblePoints)),
    );
    const typicalStepMs = diffs.length > 0
      ? (() => {
          const sortedDiffs = [...diffs].sort((left, right) => left - right);
          return Math.max(1000, sortedDiffs[Math.floor(sortedDiffs.length / 2)]);
        })()
      : fallbackStepMs;
    const gapThresholdMs = Math.max(2000, Math.round(typicalStepMs * 2));

    const stagedRows: DenseTelemetryRow[] = [makeNullRow(startMs)];
    let previousTs = startMs;

    for (const row of uniqueRows) {
      const clampedTs = Math.max(startMs, Math.min(endMs, row.ts));
      if (clampedTs - previousTs > gapThresholdMs) {
        const gapStart = Math.min(endMs, previousTs + typicalStepMs);
        if (gapStart > previousTs && gapStart < clampedTs) {
          stagedRows.push(makeNullRow(gapStart));
        }

        const gapEnd = Math.max(startMs, clampedTs - typicalStepMs);
        const lastTs = stagedRows[stagedRows.length - 1]?.ts ?? Number.NEGATIVE_INFINITY;
        if (gapEnd > lastTs && gapEnd < clampedTs) {
          stagedRows.push(makeNullRow(gapEnd));
        }
      }

      stagedRows.push({ ...row, ts: clampedTs });
      previousTs = clampedTs;
    }

    if (endMs - previousTs > gapThresholdMs) {
      const tailGapStart = Math.min(endMs, previousTs + typicalStepMs);
      const lastTs = stagedRows[stagedRows.length - 1]?.ts ?? Number.NEGATIVE_INFINITY;
      if (tailGapStart > lastTs && tailGapStart < endMs) {
        stagedRows.push(makeNullRow(tailGapStart));
      }
    }
    stagedRows.push(makeNullRow(endMs));

    const deduped = new Map<number, DenseTelemetryRow>();
    for (const row of stagedRows.sort((left, right) => left.ts - right.ts)) {
      const existing = deduped.get(row.ts);
      if (!existing || (!hasAnyValue(existing) && hasAnyValue(row))) {
        deduped.set(row.ts, row);
      }
    }

    return Array.from(deduped.values()).sort((left, right) => left.ts - right.ts);
  }, [
    activePresetConfig,
    sensor,
    telemetryPoints,
    telemetryWindowAnchorMs,
    telemetryWindowStartMs,
  ]);
  const telemetryGapStepMs = useMemo(() => {
    if (timelineTelemetryData.length < 2) {
      return 1000;
    }
    const diffs: number[] = [];
    for (let index = 1; index < timelineTelemetryData.length; index += 1) {
      const diff = timelineTelemetryData[index].ts - timelineTelemetryData[index - 1].ts;
      if (Number.isFinite(diff) && diff > 0) {
        diffs.push(diff);
      }
    }
    if (diffs.length === 0) {
      return 1000;
    }
    const sortedDiffs = [...diffs].sort((left, right) => left - right);
    const median = sortedDiffs[Math.floor(sortedDiffs.length / 2)];
    return Math.max(1000, Math.round(median));
  }, [timelineTelemetryData]);

  const tempData = useMemo(
    () =>
      timelineTelemetryData.map((row) => ({
        ts: row.ts,
        temp: row.temp,
        telemetryUuid: row.telemetryUuid,
      })),
    [timelineTelemetryData],
  );

  const tempDomain = useMemo<[number, number]>(() => {
    const values = tempData
      .map((item) => item.temp)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (values.length === 0) {
      return [15, 35];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const center = (min + max) / 2;
    return [Number((center - tempHalfSpan).toFixed(2)), Number((center + tempHalfSpan).toFixed(2))];
  }, [tempData, tempHalfSpan]);

  const accelData = useMemo(
    () =>
      timelineTelemetryData.map((row) => ({
        ts: row.ts,
        ax: row.ax,
        ay: row.ay,
        az: row.az,
        telemetryUuid: row.telemetryUuid,
      })),
    [timelineTelemetryData],
  );
  const activeSpectrumPoints = hoverSpectrumPoints ?? spectrumPoints;

  const latestSpectrumByAxis = useMemo<Record<SpectrumAxis, DeviceSpectrumPoint | null>>(() => {
    const next: Record<SpectrumAxis, DeviceSpectrumPoint | null> = {
      x: null,
      y: null,
      z: null,
    };

    const ordered = [...activeSpectrumPoints].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
    for (const point of ordered) {
      next[point.axis] = point;
    }

    return next;
  }, [activeSpectrumPoints]);

  const missingSpectrumAxes = (["x", "y", "z"] as SpectrumAxis[]).filter((axis) => !latestSpectrumByAxis[axis]);
  const hasAnySpectrum = missingSpectrumAxes.length < 3;
  const showingHoveredSpectrum = hoverSpectrumPoints !== null;
  const hoverSpectrumBusy = hoverSpectrumDebouncing || hoverSpectrumLoading;
  const spectrumPinned = spectrumPinnedTarget !== null;

  const fftX = useMemo(() => {
    return toSpectrumChartData(latestSpectrumByAxis.x);
  }, [latestSpectrumByAxis.x]);

  const fftY = useMemo(() => {
    return toSpectrumChartData(latestSpectrumByAxis.y);
  }, [latestSpectrumByAxis.y]);

  const fftZ = useMemo(() => {
    return toSpectrumChartData(latestSpectrumByAxis.z);
  }, [latestSpectrumByAxis.z]);
  const fftRenderX = useMemo(() => downsampleSpectrumChartData(fftX), [fftX]);
  const fftRenderY = useMemo(() => downsampleSpectrumChartData(fftY), [fftY]);
  const fftRenderZ = useMemo(() => downsampleSpectrumChartData(fftZ), [fftZ]);
  const [spectrumFixedYMax, setSpectrumFixedYMax] = useState(SPECTRUM_FIXED_Y_MAX_FALLBACK);

  useEffect(() => {
    setSpectrumFixedYMax(SPECTRUM_FIXED_Y_MAX_FALLBACK);
  }, [sensor?.id]);

  useEffect(() => {
    const allAmplitudes = spectrumPoints.flatMap((point) => point.amplitudes);
    if (allAmplitudes.length === 0) {
      return;
    }

    const maxAmplitude = allAmplitudes.reduce((max, value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return max;
      }
      return value > max ? value : max;
    }, 0);
    if (!Number.isFinite(maxAmplitude) || maxAmplitude <= 0) {
      return;
    }

    const padded = maxAmplitude * 1.1;
    const rounded = Math.ceil(padded * 10) / 10;
    setSpectrumFixedYMax(Math.max(SPECTRUM_FIXED_Y_MAX_FALLBACK, Number(rounded.toFixed(3))));
  }, [spectrumPoints]);
  const spectrumUnitByAxis = useMemo<Record<SpectrumAxis, string>>(
    () => ({
      x: normalizeSpectrumUnit(latestSpectrumByAxis.x?.magnitudeUnit),
      y: normalizeSpectrumUnit(latestSpectrumByAxis.y?.magnitudeUnit),
      z: normalizeSpectrumUnit(latestSpectrumByAxis.z?.magnitudeUnit),
    }),
    [latestSpectrumByAxis.x, latestSpectrumByAxis.y, latestSpectrumByAxis.z],
  );
  const spectrumPeakByAxis = useMemo<
    Record<SpectrumAxis, { frequencyHz?: number; amplitude?: number }>
  >(
    () => ({
      x: {
        frequencyHz:
          latestSpectrumByAxis.x?.peakFrequencyHz ??
          (fftX.length > 0 ? fftX.reduce((peak, item) => (item.amp > peak.amp ? item : peak)).freq : undefined),
        amplitude:
          latestSpectrumByAxis.x?.peakAmplitude ??
          (fftX.length > 0 ? fftX.reduce((peak, item) => (item.amp > peak.amp ? item : peak)).amp : undefined),
      },
      y: {
        frequencyHz:
          latestSpectrumByAxis.y?.peakFrequencyHz ??
          (fftY.length > 0 ? fftY.reduce((peak, item) => (item.amp > peak.amp ? item : peak)).freq : undefined),
        amplitude:
          latestSpectrumByAxis.y?.peakAmplitude ??
          (fftY.length > 0 ? fftY.reduce((peak, item) => (item.amp > peak.amp ? item : peak)).amp : undefined),
      },
      z: {
        frequencyHz:
          latestSpectrumByAxis.z?.peakFrequencyHz ??
          (fftZ.length > 0 ? fftZ.reduce((peak, item) => (item.amp > peak.amp ? item : peak)).freq : undefined),
        amplitude:
          latestSpectrumByAxis.z?.peakAmplitude ??
          (fftZ.length > 0 ? fftZ.reduce((peak, item) => (item.amp > peak.amp ? item : peak)).amp : undefined),
      },
    }),
    [latestSpectrumByAxis.x, latestSpectrumByAxis.y, latestSpectrumByAxis.z, fftX, fftY, fftZ],
  );
  const spectrumMaxHzByAxis = useMemo<Record<SpectrumAxis, number>>(
    () => ({
      x: fftX.length > 0 ? fftX[fftX.length - 1].freq : 0,
      y: fftY.length > 0 ? fftY[fftY.length - 1].freq : 0,
      z: fftZ.length > 0 ? fftZ[fftZ.length - 1].freq : 0,
    }),
    [fftX, fftY, fftZ],
  );
  const timelinePointCount = timelineTelemetryData.length;
  const trendMaxOffset = Math.max(0, timelinePointCount - trendVisiblePoints);
  const trendEffectiveOffset = Math.min(trendWindowOffset, trendMaxOffset);
  const visibleWindow = useMemo(() => {
    if (timelinePointCount <= 0) {
      return {
        startIndex: 0,
        endExclusive: 0,
        visiblePoints: 0,
      };
    }

    const effectiveVisiblePoints = Math.max(1, Math.min(timelinePointCount, trendVisiblePoints));
    const endExclusive = Math.max(0, timelinePointCount - trendEffectiveOffset);
    const startIndex = Math.max(0, endExclusive - effectiveVisiblePoints);
    return {
      startIndex,
      endExclusive,
      visiblePoints: Math.max(0, endExclusive - startIndex),
    };
  }, [timelinePointCount, trendEffectiveOffset, trendVisiblePoints]);
  const tempVisible = useMemo(() => {
    return tempData.slice(visibleWindow.startIndex, visibleWindow.endExclusive);
  }, [tempData, visibleWindow.endExclusive, visibleWindow.startIndex]);
  const tempGapRanges = useMemo(() => {
    return buildNullGapRanges(
      tempVisible,
      (row) => typeof row.temp === "number" && Number.isFinite(row.temp),
      (row) => row.ts,
      telemetryGapStepMs,
    );
  }, [telemetryGapStepMs, tempVisible]);
  const tempDisplayData = tempVisible;
  const accelVisible = useMemo(() => {
    return accelData.slice(visibleWindow.startIndex, visibleWindow.endExclusive);
  }, [accelData, visibleWindow.endExclusive, visibleWindow.startIndex]);
  const accelGapRanges = useMemo(() => {
    return buildNullGapRanges(
      accelVisible,
      (row) =>
        (typeof row.ax === "number" && Number.isFinite(row.ax))
        || (typeof row.ay === "number" && Number.isFinite(row.ay))
        || (typeof row.az === "number" && Number.isFinite(row.az)),
      (row) => row.ts,
      telemetryGapStepMs,
    );
  }, [accelVisible, telemetryGapStepMs]);
  const accelDisplayData = accelVisible;
  const showInitialLoading = telemetryLoading && telemetryPoints.length === 0;
  const latestAccel = accelVisible.at(-1);
  const activePresetLabel =
    TELEMETRY_HISTORY_PRESETS.find((preset) => preset.key === activeHistoryPreset)?.label ?? DEFAULT_HISTORY_PRESET_KEY;
  const brushWindow = useMemo(() => {
    if (visibleWindow.visiblePoints <= 0) {
      return {
        startTs: undefined as number | undefined,
        endTs: undefined as number | undefined,
        visiblePoints: 0,
      };
    }

    const endIndex = Math.max(visibleWindow.startIndex, visibleWindow.endExclusive - 1);

    return {
      startTs: timelineTelemetryData[visibleWindow.startIndex]?.ts,
      endTs: timelineTelemetryData[endIndex]?.ts,
      visiblePoints: visibleWindow.visiblePoints,
    };
  }, [timelineTelemetryData, visibleWindow.endExclusive, visibleWindow.startIndex, visibleWindow.visiblePoints]);

  const applyBrushWindowByTimestamp = useCallback(
    (requestedStartTs: number, requestedEndTs: number) => {
      if (timelinePointCount <= 0) {
        return;
      }

      const firstTs = timelineTelemetryData[0]?.ts ?? 0;
      const lastTs = timelineTelemetryData[timelinePointCount - 1]?.ts ?? firstTs;
      const safeStartTs = Math.max(firstTs, Math.min(lastTs, Math.min(requestedStartTs, requestedEndTs)));
      const safeEndTs = Math.max(firstTs, Math.min(lastTs, Math.max(requestedStartTs, requestedEndTs)));

      const findNearestTimelineIndex = (targetTs: number): number => {
        let low = 0;
        let high = timelinePointCount - 1;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const value = timelineTelemetryData[mid]?.ts ?? firstTs;
          if (value < targetTs) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }

        const rightIndex = low;
        const leftIndex = Math.max(0, rightIndex - 1);
        const leftDistance = Math.abs((timelineTelemetryData[leftIndex]?.ts ?? firstTs) - targetTs);
        const rightDistance = Math.abs((timelineTelemetryData[rightIndex]?.ts ?? firstTs) - targetTs);
        return rightDistance < leftDistance ? rightIndex : leftIndex;
      };

      let startIndex = findNearestTimelineIndex(safeStartTs);
      let endIndex = findNearestTimelineIndex(safeEndTs);
      if (startIndex > endIndex) {
        const temp = startIndex;
        startIndex = endIndex;
        endIndex = temp;
      }
      if (endIndex < startIndex) {
        endIndex = startIndex;
      }
      if (startIndex === endIndex && timelinePointCount > 1) {
        if (endIndex < timelinePointCount - 1) {
          endIndex += 1;
        } else if (startIndex > 0) {
          startIndex -= 1;
        }
      }

      const nextVisiblePoints = Math.max(1, endIndex - startIndex + 1);
      const nextOffset = Math.max(0, timelinePointCount - (endIndex + 1));
      if (nextVisiblePoints === trendVisiblePoints && nextOffset === trendWindowOffset) {
        return;
      }
      setTrendVisiblePoints(nextVisiblePoints);
      setTrendWindowOffset(nextOffset);
      pulseTrendReloadSpinner(130);
    },
    [pulseTrendReloadSpinner, timelinePointCount, timelineTelemetryData, trendVisiblePoints, trendWindowOffset],
  );

  const timeBrushResetKey = useMemo(
    () =>
      `${sensor?.id ?? "no-sensor"}:${activeHistoryPreset ?? "none"}:${timelinePointCount}:${Math.floor(telemetryWindowAnchorMs / 1000)}`,
    [activeHistoryPreset, sensor?.id, telemetryWindowAnchorMs, timelinePointCount],
  );
  useEffect(() => {
    if (trendWindowOffset !== trendEffectiveOffset) {
      setTrendWindowOffset(trendEffectiveOffset);
    }
  }, [trendEffectiveOffset, trendWindowOffset]);

  useEffect(() => {
    if (!sensor) {
      autoPresetLoadedSensorIdRef.current = null;
      return;
    }
    setTelemetryWindowAnchorMs(Date.now());
    setTempHalfSpan(5);
    setAccelAmplitudeLimit(ACCEL_LIMIT_MS2);
    setTrendWindowOffset(0);
    setTrendVisiblePoints(DEFAULT_VISIBLE_POINTS);
    setActiveHistoryPreset(DEFAULT_HISTORY_PRESET_KEY);
    setHistoryPresetLoading(null);
    if (trendReloadTimerRef.current !== null) {
      window.clearTimeout(trendReloadTimerRef.current);
      trendReloadTimerRef.current = null;
    }
    setTrendRenderReloading(false);
    panStateRef.current = null;
    setPanningChart(null);
  }, [sensor?.id]);

  useEffect(() => {
    if (!sensor || !onRequestTelemetryHistory) {
      return;
    }
    if (autoPresetLoadedSensorIdRef.current === sensor.id) {
      return;
    }
    autoPresetLoadedSensorIdRef.current = sensor.id;
    void handleHistoryPresetSelect(DEFAULT_HISTORY_PRESET_KEY);
  }, [handleHistoryPresetSelect, onRequestTelemetryHistory, sensor]);

  const handleTempWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomOut = event.deltaY > 0;
    setTempHalfSpan((previous) => {
      const next = zoomOut ? previous * 1.1 : previous / 1.1;
      return clampTempHalfSpan(next);
    });
  };

  const handleAccelWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomOut = event.deltaY > 0;
    setAccelAmplitudeLimit((previous) => {
      const next = zoomOut ? previous * 1.1 : previous / 1.1;
      return clampAccelAmplitudeLimit(next);
    });
  };

  const startPanDrag = (
    chart: "temp" | "accel",
    event: React.MouseEvent<HTMLDivElement>,
    currentOffset: number,
    maxOffset: number,
  ) => {
    if (maxOffset <= 0) {
      return;
    }

    panStateRef.current = {
      startX: event.clientX,
      startOffset: currentOffset,
      width: event.currentTarget.clientWidth || 1,
      maxOffset,
    };
    showTrendReloadSpinner();
    setPanningChart(chart);
  };

  const handleTempWrapperMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      event.preventDefault();
      startPanDrag("temp", event, trendEffectiveOffset, trendMaxOffset);
    }
  };

  const handleAccelWrapperMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      event.preventDefault();
      startPanDrag("accel", event, trendEffectiveOffset, trendMaxOffset);
    }
  };

  useEffect(() => {
    if (!panningChart) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const panState = panStateRef.current;
      if (!panState) {
        return;
      }
      const pointsRange = Math.max(1, panState.maxOffset);
      const pointsPerPixel = pointsRange / Math.max(1, panState.width);
      const deltaX = event.clientX - panState.startX;
      const rawOffset = panState.startOffset + Math.round(deltaX * pointsPerPixel);
      const nextOffset = Math.max(0, Math.min(panState.maxOffset, rawOffset));
      setTrendWindowOffset(nextOffset);
    };

    const handleUp = () => {
      panStateRef.current = null;
      setPanningChart(null);
      hideTrendReloadSpinner(130);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [hideTrendReloadSpinner, panningChart]);

  if (!sensor) return null;

  const chartTextStyle = { fill: C.textMuted, fontSize: 10 };
  const gridColor = C.border + "44";

  return (
    <>
      <div onClick={handleClose} style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        opacity: visible ? 1 : 0, transition: "opacity 0.22s ease",
      }} />

      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 61,
        transform: visible ? "translate(-50%,-53%) scale(1)" : "translate(-50%,-51%) scale(0.97)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.22s cubic-bezier(0.32,0.72,0,1), opacity 0.22s ease",
        width: "min(97vw, 1300px)", maxHeight: "95vh",
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: "14px 18px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
	          <div>
	            <div style={{ color: C.textMuted, fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 3 }}>
	              Phân tích dữ liệu cảm biến
	            </div>
	            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
	              <div style={{ color: C.textBright, fontSize: "0.93rem", fontWeight: 700 }}>
	                {sensor.name} <span style={{ color: C.textMuted, fontWeight: 400, fontSize: "0.75rem" }}>({sensor.id})</span>
	              </div>
              <div style={{ position: "relative", display: "inline-flex" }}>
                <button
                  type="button"
                  aria-label="Tùy chọn"
                  onClick={openDataSettings}
                  disabled={clearingDeviceData}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.surface,
                    color: C.textMuted,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: clearingDeviceData ? "not-allowed" : "pointer",
                    opacity: clearingDeviceData ? 0.55 : 1,
                    transition: "all 0.14s ease",
                  }}
                  onMouseEnter={(event) => {
                    if (clearingDeviceData) {
                      return;
                    }
                    setSettingsTooltipVisible(true);
                    event.currentTarget.style.borderColor = C.primary;
                    event.currentTarget.style.background = C.primaryBg;
                    event.currentTarget.style.color = C.primary;
                  }}
                  onMouseLeave={(event) => {
                    setSettingsTooltipVisible(false);
                    event.currentTarget.style.borderColor = C.border;
                    event.currentTarget.style.background = C.surface;
                    event.currentTarget.style.color = C.textMuted;
                  }}
                  onFocus={() => {
                    if (!clearingDeviceData) {
                      setSettingsTooltipVisible(true);
                    }
                  }}
                  onBlur={() => setSettingsTooltipVisible(false)}
                >
                  <Settings size={14} strokeWidth={2.1} />
                </button>
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "calc(100% + 9px)",
                    transform: settingsTooltipVisible ? "translate(-50%, 0)" : "translate(-50%, 3px)",
                    opacity: settingsTooltipVisible && !clearingDeviceData ? 1 : 0,
                    pointerEvents: "none",
                    padding: "2px 7px",
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: C.surface,
                    color: C.textBase,
                    fontSize: "0.62rem",
                    fontWeight: 600,
                    lineHeight: 1.35,
                    whiteSpace: "nowrap",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                    zIndex: 30,
                    transition: "opacity 0.14s ease, transform 0.14s ease",
                  }}
                >
                  Tùy chọn
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* X close button – prominent */}
            <button
              onClick={handleClose}
              title="Đóng"
              disabled={clearingDeviceData}
              style={{
                width: 34, height: 34, borderRadius: 8,
                background: "transparent",
                border: `1px solid ${C.border}`,
                cursor: clearingDeviceData ? "not-allowed" : "pointer",
                opacity: clearingDeviceData ? 0.5 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                transition: "background 0.15s, border-color 0.15s",
              }}
              onMouseEnter={e => {
                if (clearingDeviceData) {
                  return;
                }
                (e.currentTarget as HTMLButtonElement).style.background = "#ef444422";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#ef4444";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
              }}
            >
              <X size={16} color={C.textMuted} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          <style>{`
            @keyframes chartSpin { to { transform: rotate(360deg); } }
            @keyframes dataSettingsBackdropIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes dataSettingsBackdropOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
            @keyframes dataSettingsModalIn {
              from {
                opacity: 0;
                transform: translate(-50%, -48.5%) scale(0.972);
              }
              to {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
              }
            }
            @keyframes dataSettingsModalOut {
              from {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
              }
              to {
                opacity: 0;
                transform: translate(-50%, -49.1%) scale(0.986);
              }
            }
            .data-settings-modal-backdrop.modal-open {
              animation: dataSettingsBackdropIn 185ms ease-out forwards;
            }
            .data-settings-modal-backdrop.modal-closing {
              animation: dataSettingsBackdropOut ${DATA_SETTINGS_MODAL_CLOSE_MS}ms ease-in forwards;
            }
            .data-settings-modal-card.modal-open {
              animation: dataSettingsModalIn 195ms cubic-bezier(0.22, 0.8, 0.2, 1) forwards;
              will-change: transform, opacity;
            }
            .data-settings-modal-card.modal-closing {
              animation: dataSettingsModalOut ${DATA_SETTINGS_MODAL_CLOSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
              pointer-events: none;
              will-change: transform, opacity;
            }
            @keyframes clearDataConfirmBackdropIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes clearDataConfirmBackdropOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
            @keyframes clearDataConfirmCardIn {
              from {
                opacity: 0;
                transform: translate(-50%, -48.4%) scale(0.975);
              }
              to {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
              }
            }
            @keyframes clearDataConfirmCardOut {
              from {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
              }
              to {
                opacity: 0;
                transform: translate(-50%, -49%) scale(0.987);
              }
            }
            .data-clear-confirm-backdrop.modal-open {
              animation: clearDataConfirmBackdropIn 160ms ease-out forwards;
            }
            .data-clear-confirm-backdrop.modal-closing {
              animation: clearDataConfirmBackdropOut ${CLEAR_DATA_CONFIRM_MODAL_CLOSE_MS}ms ease-in forwards;
            }
            .data-clear-confirm-card.modal-open {
              animation: clearDataConfirmCardIn 175ms cubic-bezier(0.22, 0.8, 0.2, 1) forwards;
              will-change: transform, opacity;
            }
            .data-clear-confirm-card.modal-closing {
              animation: clearDataConfirmCardOut ${CLEAR_DATA_CONFIRM_MODAL_CLOSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
              pointer-events: none;
              will-change: transform, opacity;
            }
            .chart-pan-area, .chart-pan-area * {
              cursor: grab !important;
              user-select: none !important;
              -webkit-user-select: none !important;
            }
            .chart-pan-area.panning, .chart-pan-area.panning * {
              cursor: grabbing !important;
            }
            @media (prefers-reduced-motion: reduce) {
              .data-settings-modal-backdrop,
              .data-settings-modal-card,
              .data-clear-confirm-backdrop,
              .data-clear-confirm-card {
                animation: none !important;
              }
            }
          `}</style>

          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px 12px",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.card,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    color: C.textMuted,
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Khung thời gian
                </span>
                <div ref={timePresetMenuRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    disabled={!onRequestTelemetryHistory || Boolean(historyPresetLoading)}
                    onClick={() => {
                      setTimePresetMenuOpen((open) => !open);
                    }}
                    style={{
                      height: 30,
                      borderRadius: 999,
                      border: `1px solid ${C.border}`,
                      padding: "0 10px",
                      background: C.surface,
                      color: C.textBase,
                      fontSize: "0.66rem",
                      fontWeight: 700,
                      cursor: !onRequestTelemetryHistory || Boolean(historyPresetLoading) ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      minWidth: 120,
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Clock3 size={14} strokeWidth={2.1} />
                      {activePresetLabel}
                    </span>
                    <ChevronDown
                      size={13}
                      strokeWidth={2.2}
                      style={{
                        transform: timePresetMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.14s ease",
                      }}
                    />
                  </button>

                  {timePresetMenuOpen ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        left: 0,
                        minWidth: 170,
                        borderRadius: 10,
                        border: `1px solid ${C.border}`,
                        background: C.surface,
                        boxShadow: "0 14px 28px rgba(0, 0, 0, 0.28)",
                        padding: 6,
                        zIndex: 40,
                      }}
                    >
                      {TELEMETRY_HISTORY_PRESETS.map((preset) => {
                        const active = activeHistoryPreset === preset.key;
                        const loading = historyPresetLoading === preset.key;
                        return (
                          <button
                            key={preset.key}
                            type="button"
                            disabled={Boolean(historyPresetLoading)}
                            onClick={() => {
                              setTimePresetMenuOpen(false);
                              void handleHistoryPresetSelect(preset.key);
                            }}
                            style={{
                              width: "100%",
                              height: 30,
                              border: "none",
                              borderRadius: 8,
                              background: active ? C.primaryBg : "transparent",
                              color: active ? C.primary : C.textBase,
                              fontSize: "0.67rem",
                              fontWeight: 700,
                              cursor: Boolean(historyPresetLoading) ? "not-allowed" : "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "0 9px",
                            }}
                          >
                            <span>{preset.label}</span>
                            {loading ? (
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: "50%",
                                  border: `2px solid ${C.border}`,
                                  borderTopColor: C.primary,
                                  animation: "chartSpin 0.8s linear infinite",
                                }}
                              />
                            ) : active ? (
                              <span
                                style={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: "50%",
                                  background: C.primary,
                                }}
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                style={{
                  color: C.textMuted,
                  fontSize: "0.66rem",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {historyPresetLoading || trendRenderReloading ? (
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      border: `2px solid ${C.border}`,
                      borderTopColor: C.primary,
                      animation: "chartSpin 0.8s linear infinite",
                    }}
                  />
                ) : null}
                <span>
                  {historyPresetLoading
                    ? "Đang tải thêm dữ liệu lịch sử..."
                    : trendRenderReloading
                      ? "Đang tải lại biểu đồ..."
                      : `${brushWindow.visiblePoints.toLocaleString("vi-VN")} / ${timelinePointCount.toLocaleString("vi-VN")} điểm`}
                </span>
              </div>
            </div>

            <TimeWindowBrush
              rows={timelineTelemetryData}
              selectedStartTs={brushWindow.startTs}
              selectedEndTs={brushWindow.endTs}
              resetKey={timeBrushResetKey}
              axisLabelColor={chartTextStyle.fill}
              C={C}
              onRangeCommit={(startTs, endTs) => {
                applyBrushWindowByTimestamp(startTs, endTs);
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
                color: C.textMuted,
                fontSize: "0.66rem",
                fontWeight: 600,
              }}
            >
              <span>
                Từ:{" "}
                {typeof brushWindow.startTs === "number"
                  ? formatAbsoluteAxisTime(brushWindow.startTs)
                  : "--:-- --/--"}
              </span>
              <span>
                Đến:{" "}
                {typeof brushWindow.endTs === "number"
                  ? formatAbsoluteAxisTime(brushWindow.endTs)
                  : "--:-- --/--"}
              </span>
            </div>
          </div>

          {/* Top row: Temperature + Acceleration side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 14 }}>

            {/* 1. Temperature trend */}
            <ChartSection title="Xu hướng nhiệt độ (°C)" icon={<Thermometer size={13} strokeWidth={2} />} C={C}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingLeft: 4 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    background: C.primaryBg,
                    color: C.primary,
                    border: `1px solid ${C.primary + "30"}`,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: C.primary,
                      boxShadow: `0 0 0 2px ${C.primary}22`,
                    }}
                  />
                  Nhiệt độ
                </div>
              </div>
              {showInitialLoading ? (
                <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: C.textMuted, fontSize: "0.74rem" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                  <div>Đang tải dữ liệu lịch sử...</div>
                </div>
              ) : tempData.length === 0 ? (
                <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.72rem" }}>
                  Không có dữ liệu nhiệt độ trong khung {activePresetLabel}.
                </div>
              ) : (
                <div
                  onMouseDown={handleTempWrapperMouseDown}
                  onContextMenu={handleTelemetryChartUnpin}
                  onWheel={handleTempWheel}
                  className={`chart-pan-area${panningChart === "temp" ? " panning" : ""}`}
                  style={{ touchAction: "none" }}
                >
                  <div style={{ position: "relative" }}>
                    <TelemetryTrendChart
                      data={tempDisplayData}
                      hoverPoints={tempVisible.map((point) => ({ ts: point.ts, telemetryUuid: point.telemetryUuid }))}
                      series={[
                        {
                          key: "temp",
                          name: "Nhiệt độ",
                          color: C.primary,
                          strokeWidth: 2,
                          latestLabelFormatter: (value) => `${value.toFixed(2)}°C`,
                        },
                      ]}
                      gapSegmentsBySeries={{
                        temp: tempGapRanges.map((gap) => ({
                          from: gap.from,
                          to: gap.to,
                        })),
                      }}
                      yDomain={tempDomain}
                      gridColor={gridColor}
                      axisLabelColor={chartTextStyle.fill}
                      C={C}
                      onHoverTarget={handleTelemetryChartHover}
                      onPinTarget={handleTelemetryChartPin}
                      onLeave={handleTelemetryChartLeave}
                    />
                  </div>
                </div>
              )}
            </ChartSection>

            {/* 2. Acceleration trend */}
            <ChartSection
              title="Xu hướng gia tốc (m/s²)"
              icon={<Activity size={13} strokeWidth={2} />}
              C={C}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 8,
                  paddingLeft: 4,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ color: C.textMuted, fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Chế độ 2D
                </div>

                {latestAccel ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    <div
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid #f8717144",
                        background: "#f8717112",
                        color: "#f87171",
                        fontWeight: 700,
                        fontSize: "0.68rem",
                      }}
                    >
                      Ax: {typeof latestAccel.ax === "number" ? latestAccel.ax.toFixed(2) : "--"}
                    </div>
                    <div
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid #60a5fa44",
                        background: "#60a5fa12",
                        color: "#60a5fa",
                        fontWeight: 700,
                        fontSize: "0.68rem",
                      }}
                    >
                      Ay: {typeof latestAccel.ay === "number" ? latestAccel.ay.toFixed(2) : "--"}
                    </div>
                    <div
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: "1px solid #a78bfa44",
                        background: "#a78bfa12",
                        color: "#a78bfa",
                        fontWeight: 700,
                        fontSize: "0.68rem",
                      }}
                    >
                      Az: {typeof latestAccel.az === "number" ? latestAccel.az.toFixed(2) : "--"}
                    </div>
                  </div>
                ) : null}
              </div>

              {showInitialLoading ? (
                <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: C.textMuted, fontSize: "0.74rem" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                  <div>Đang tải dữ liệu lịch sử...</div>
                </div>
              ) : accelData.length === 0 ? (
                <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.72rem" }}>
                  Không có dữ liệu gia tốc trong khung {activePresetLabel}.
                </div>
              ) : (
                <div
                  onMouseDown={handleAccelWrapperMouseDown}
                  onContextMenu={handleTelemetryChartUnpin}
                  onWheel={handleAccelWheel}
                  className={`chart-pan-area${panningChart === "accel" ? " panning" : ""}`}
                  style={{ touchAction: "none" }}
                >
                  <TelemetryTrendChart
                    data={accelDisplayData}
                    hoverPoints={accelVisible.map((point) => ({ ts: point.ts, telemetryUuid: point.telemetryUuid }))}
                    series={[
                      { key: "ax", name: "Ax", color: "#f87171", strokeWidth: 1.8 },
                      { key: "ay", name: "Ay", color: "#60a5fa", strokeWidth: 1.8 },
                      { key: "az", name: "Az", color: "#a78bfa", strokeWidth: 1.8 },
                    ]}
                    gapSegmentsBySeries={{
                      ax: accelGapRanges.map((gap) => ({
                        from: gap.from,
                        to: gap.to,
                      })),
                      ay: accelGapRanges.map((gap) => ({
                        from: gap.from,
                        to: gap.to,
                      })),
                      az: accelGapRanges.map((gap) => ({
                        from: gap.from,
                        to: gap.to,
                      })),
                    }}
                    yDomain={[-accelAmplitudeLimit, accelAmplitudeLimit]}
                    gridColor={gridColor}
                    axisLabelColor={chartTextStyle.fill}
                    C={C}
                    showLegend
                    onHoverTarget={handleTelemetryChartHover}
                    onPinTarget={handleTelemetryChartPin}
                    onLeave={handleTelemetryChartLeave}
                  />
                </div>
              )}
	            </ChartSection>
	          </div>

	          {/* Bottom row: FFT X / Y / Z in one row */}
	          <div style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.primary }}><BarChart3 size={13} strokeWidth={2} /></span>
              <span style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 700 }}>Phổ tần số FFT</span>
              <span style={{ color: C.textMuted, fontSize: "0.68rem" }}>(Ax / Ay / Az)</span>
              <span
                style={{
                  color: hasAnySpectrum ? C.success : C.textMuted,
                  fontSize: "0.62rem",
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 999,
                  border: `1px solid ${hasAnySpectrum ? `${C.success}44` : C.border}`,
                  background: hasAnySpectrum ? `${C.success}14` : C.surface,
                }}
              >
                {hoverSpectrumBusy
                  ? hoverSpectrumDebouncing
                    ? "Đang đồng bộ mốc..."
                    : "Đang tải theo mốc..."
                  : spectrumPinned
                    ? "Đã ghim mốc (chuột phải để bỏ)"
                  : hasAnySpectrum
                    ? missingSpectrumAxes.length === 0
                      ? showingHoveredSpectrum
                        ? "Theo mốc hover"
                        : "Realtime"
                      : `Thiếu: ${missingSpectrumAxes.map((axis) => axis.toUpperCase()).join(", ")}`
                    : "Chưa có dữ liệu"}
              </span>
              {hoverTelemetrySnapshot ? (
                <span
                  style={{
                    color: C.textMuted,
                    fontSize: "0.62rem",
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: 999,
                    border: `1px solid ${C.border}`,
                    background: C.card,
                  }}
                >
                  {`Mốc: ${formatTooltipDateTime(hoverTelemetrySnapshot.ts)} · Temp ${formatOptionalValue(
                    hoverTelemetrySnapshot.temp,
                    2,
                    "°C",
                  )} · Ax ${formatOptionalValue(hoverTelemetrySnapshot.ax, 2)} · Ay ${formatOptionalValue(
                    hoverTelemetrySnapshot.ay,
                    2,
                  )} · Az ${formatOptionalValue(hoverTelemetrySnapshot.az, 2)} m/s²`}
                </span>
              ) : null}
            </div>

            <div style={{ position: "relative" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                }}
              >

                {/* FFT X */}
                <div style={{
                  position: "relative",
                  background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                  padding: "10px 6px 6px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, padding: "0 4px" }}>
                    <div style={{ color: "#f87171", fontSize: "0.68rem", fontWeight: 700 }}>
                      ■ Ax
                    </div>
                    <div style={{ color: C.textMuted, fontSize: "0.62rem", fontWeight: 600 }}>
                      {formatPeakSummary(
                        spectrumPeakByAxis.x.frequencyHz,
                        spectrumPeakByAxis.x.amplitude,
                        spectrumUnitByAxis.x,
                      )}
                    </div>
                  </div>
                  {fftRenderX.length > 0 ? (
                    <SpectrumZoomChart
                      data={fftRenderX}
                      color="#f87171"
                      axisLabelColor={chartTextStyle.fill}
                      gridColor={gridColor}
                      maxHz={spectrumMaxHzByAxis.x}
                      yMax={spectrumFixedYMax}
                      C={C}
                    />
                  ) : hoverSpectrumBusy ? (
                    <div style={{ height: 160 }} />
                  ) : (
                    <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.72rem" }}>
                      Chưa có dữ liệu phổ Ax.
                    </div>
                  )}
                  <div style={{ textAlign: "right", color: C.textMuted, fontSize: "0.58rem", paddingRight: 6, marginTop: -2 }}>Hz</div>
                  {hoverSpectrumBusy ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 9px",
                          borderRadius: 999,
                          border: `1px solid ${C.border}`,
                          background: `${C.surface}EE`,
                          color: C.textMuted,
                          fontSize: "0.62rem",
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            border: `2px solid ${C.border}`,
                            borderTopColor: "#f87171",
                            animation: "chartSpin 0.8s linear infinite",
                          }}
                        />
                        {hoverSpectrumDebouncing ? "Chờ debounce..." : "Đang tải..."}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* FFT Y */}
                <div style={{
                  position: "relative",
                  background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                  padding: "10px 6px 6px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, padding: "0 4px" }}>
                    <div style={{ color: "#60a5fa", fontSize: "0.68rem", fontWeight: 700 }}>
                      ■ Ay
                    </div>
                    <div style={{ color: C.textMuted, fontSize: "0.62rem", fontWeight: 600 }}>
                      {formatPeakSummary(
                        spectrumPeakByAxis.y.frequencyHz,
                        spectrumPeakByAxis.y.amplitude,
                        spectrumUnitByAxis.y,
                      )}
                    </div>
                  </div>
                  {fftRenderY.length > 0 ? (
                    <SpectrumZoomChart
                      data={fftRenderY}
                      color="#60a5fa"
                      axisLabelColor={chartTextStyle.fill}
                      gridColor={gridColor}
                      maxHz={spectrumMaxHzByAxis.y}
                      yMax={spectrumFixedYMax}
                      C={C}
                    />
                  ) : hoverSpectrumBusy ? (
                    <div style={{ height: 160 }} />
                  ) : (
                    <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.72rem" }}>
                      Chưa có dữ liệu phổ Ay.
                    </div>
                  )}
                  <div style={{ textAlign: "right", color: C.textMuted, fontSize: "0.58rem", paddingRight: 6, marginTop: -2 }}>Hz</div>
                  {hoverSpectrumBusy ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 9px",
                          borderRadius: 999,
                          border: `1px solid ${C.border}`,
                          background: `${C.surface}EE`,
                          color: C.textMuted,
                          fontSize: "0.62rem",
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            border: `2px solid ${C.border}`,
                            borderTopColor: "#60a5fa",
                            animation: "chartSpin 0.8s linear infinite",
                          }}
                        />
                        {hoverSpectrumDebouncing ? "Chờ debounce..." : "Đang tải..."}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* FFT Z */}
                <div style={{
                  position: "relative",
                  background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                  padding: "10px 6px 6px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, padding: "0 4px" }}>
                    <div style={{ color: "#a78bfa", fontSize: "0.68rem", fontWeight: 700 }}>
                      ■ Az
                    </div>
                    <div style={{ color: C.textMuted, fontSize: "0.62rem", fontWeight: 600 }}>
                      {formatPeakSummary(
                        spectrumPeakByAxis.z.frequencyHz,
                        spectrumPeakByAxis.z.amplitude,
                        spectrumUnitByAxis.z,
                      )}
                    </div>
                  </div>
                  {fftRenderZ.length > 0 ? (
                    <SpectrumZoomChart
                      data={fftRenderZ}
                      color="#a78bfa"
                      axisLabelColor={chartTextStyle.fill}
                      gridColor={gridColor}
                      maxHz={spectrumMaxHzByAxis.z}
                      yMax={spectrumFixedYMax}
                      C={C}
                    />
                  ) : hoverSpectrumBusy ? (
                    <div style={{ height: 160 }} />
                  ) : (
                    <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.72rem" }}>
                      Chưa có dữ liệu phổ Az.
                    </div>
                  )}
                  <div style={{ textAlign: "right", color: C.textMuted, fontSize: "0.58rem", paddingRight: 6, marginTop: -2 }}>Hz</div>
                  {hoverSpectrumBusy ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 9px",
                          borderRadius: 999,
                          border: `1px solid ${C.border}`,
                          background: `${C.surface}EE`,
                          color: C.textMuted,
                          fontSize: "0.62rem",
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            border: `2px solid ${C.border}`,
                            borderTopColor: "#a78bfa",
                            animation: "chartSpin 0.8s linear infinite",
                          }}
                        />
                        {hoverSpectrumDebouncing ? "Chờ debounce..." : "Đang tải..."}
                      </div>
                    </div>
                  ) : null}
                </div>

              </div>

            </div>
          </div>
        </div>
	      </div>

      <Modal
        open={dataSettingsMounted}
        onClose={closeDataSettings}
        title="Tùy chọn dữ liệu"
        description={`Thiết bị ${sensor?.name || sensor?.id}`}
        width={520}
        zIndex={94}
        disableClose={clearingDeviceData}
        backdropClassName={`data-settings-modal-backdrop ${dataSettingsClosing ? "modal-closing" : "modal-open"}`}
        cardClassName={`data-settings-modal-card ${dataSettingsClosing ? "modal-closing" : "modal-open"}`}
        footer={
	          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
	            <ConsoleButton
	              variant="neutral"
	              size="sm"
	              onClick={() => {
	                void loadDeviceDataSummary();
	              }}
	              disabled={dataSummaryLoading || clearingDeviceData}
	            >
	              {dataSummaryLoading ? "Đang tải..." : "Làm mới"}
	            </ConsoleButton>
		            <ConsoleButton
		              variant="danger"
		              size="sm"
		              onClick={openClearDataConfirm}
		              disabled={clearingDeviceData}
		            >
	              <Trash2 size={14} strokeWidth={2.1} />
	              {clearingDeviceData ? "Đang xoá..." : "Xoá dữ liệu"}
	            </ConsoleButton>
	          </div>
	        }
	      >
	        {dataSummaryLoading ? (
	          <div
	            style={{
	              minHeight: 150,
	              display: "flex",
	              alignItems: "center",
	              justifyContent: "center",
	              flexDirection: "column",
	              gap: 10,
	              color: C.textMuted,
	              fontSize: "0.74rem",
	            }}
	          >
	            <div
	              style={{
	                width: 20,
	                height: 20,
	                borderRadius: "50%",
	                border: `2px solid ${C.border}`,
	                borderTopColor: C.primary,
	                animation: "chartSpin 0.8s linear infinite",
	              }}
	            />
	            <div>Đang tải thống kê dữ liệu...</div>
	          </div>
	        ) : dataSummaryError ? (
	          <div
	            style={{
	              display: "grid",
	              gap: 12,
	              border: `1px solid ${C.warning}55`,
	              background: `${C.warning}1A`,
	              borderRadius: 10,
	              padding: "10px 12px",
	            }}
	          >
	            <div style={{ color: C.warning, fontSize: "0.74rem", fontWeight: 700 }}>
	              Không tải được thống kê dữ liệu
	            </div>
	            <div style={{ color: C.textMuted, fontSize: "0.72rem" }}>{dataSummaryError}</div>
	          </div>
	        ) : dataSummary ? (
	          <div style={{ display: "grid", gap: 10 }}>
	            <div
	              style={{
	                display: "grid",
	                gap: 8,
	                border: `1px solid ${C.border}`,
	                background: C.surface,
	                borderRadius: 10,
	                padding: "10px 12px",
	              }}
	            >
	              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.72rem" }}>
	                <span style={{ color: C.textMuted }}>Dữ liệu cập nhật tới</span>
	                <span style={{ color: C.textBright, fontWeight: 700 }}>
	                  {dataSummary.updatedAt ? formatTooltipDateTime(dataSummary.updatedAt) : "--"}
	                </span>
	              </div>
	              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.72rem" }}>
	                <span style={{ color: C.textMuted }}>Tổng số dữ liệu</span>
	                <span style={{ color: C.textBright, fontWeight: 700 }}>
	                  {dataSummary.totalRecords.toLocaleString("vi-VN")} bản ghi
	                </span>
	              </div>
	              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.72rem" }}>
	                <span style={{ color: C.textMuted }}>Tổng dung lượng dữ liệu</span>
	                <span style={{ color: C.textBright, fontWeight: 700 }}>{formatByteSize(dataSummary.totalBytes)}</span>
	              </div>
	            </div>

	            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
	              <div
	                style={{
	                  border: `1px solid ${C.border}`,
	                  borderRadius: 10,
	                  background: C.card,
	                  padding: "10px 12px",
	                  display: "grid",
	                  gap: 6,
	                }}
	              >
	                <div style={{ color: C.textBright, fontSize: "0.72rem", fontWeight: 700 }}>Telemetry</div>
	                <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>
	                  Tổng bản ghi: <strong style={{ color: C.textBright }}>{dataSummary.telemetry.records.toLocaleString("vi-VN")}</strong>
	                </div>
	                <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>
	                  Cập nhật tới:{" "}
	                  <strong style={{ color: C.textBright }}>
	                    {dataSummary.telemetry.latestAt ? formatTooltipDateTime(dataSummary.telemetry.latestAt) : "--"}
	                  </strong>
	                </div>
	                <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>
	                  Dung lượng ước tính:{" "}
	                  <strong style={{ color: C.textBright }}>{formatByteSize(dataSummary.telemetry.estimatedBytes)}</strong>
	                </div>
	              </div>

	              <div
	                style={{
	                  border: `1px solid ${C.border}`,
	                  borderRadius: 10,
	                  background: C.card,
	                  padding: "10px 12px",
	                  display: "grid",
	                  gap: 6,
	                }}
	              >
	                <div style={{ color: C.textBright, fontSize: "0.72rem", fontWeight: 700 }}>Spectrum</div>
	                <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>
	                  Tổng frame: <strong style={{ color: C.textBright }}>{dataSummary.spectrum.frames.toLocaleString("vi-VN")}</strong>
	                </div>
	                <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>
	                  Cập nhật tới:{" "}
	                  <strong style={{ color: C.textBright }}>
	                    {dataSummary.spectrum.latestAt ? formatTooltipDateTime(dataSummary.spectrum.latestAt) : "--"}
	                  </strong>
	                </div>
	                <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>
	                  Dung lượng phổ:{" "}
	                  <strong style={{ color: C.textBright }}>{formatByteSize(dataSummary.spectrum.totalBytes)}</strong>
	                </div>
	              </div>
	            </div>
	          </div>
	        ) : (
	          <div style={{ color: C.textMuted, fontSize: "0.72rem" }}>Chưa có dữ liệu thống kê.</div>
	        )}
	      </Modal>

      <Modal
        open={clearDataConfirmMounted}
        onClose={() => closeClearDataConfirm()}
        title="Xoá dữ liệu thiết bị?"
        width={440}
        zIndex={95}
        disableClose={clearingDeviceData}
        backdropClassName={`data-clear-confirm-backdrop ${clearDataConfirmClosing ? "modal-closing" : "modal-open"}`}
        cardClassName={`data-clear-confirm-card ${clearDataConfirmClosing ? "modal-closing" : "modal-open"}`}
        footer={
          <>
            <ConsoleButton variant="neutral" size="sm" onClick={() => closeClearDataConfirm()} disabled={clearingDeviceData}>
              Huỷ
            </ConsoleButton>
            <ConsoleButton variant="danger" size="sm" onClick={() => void clearDeviceData()} disabled={clearingDeviceData}>
              {clearingDeviceData ? "Đang xoá..." : "Xoá dữ liệu"}
            </ConsoleButton>
          </>
        }
      >
        <div style={{ display: "grid", gap: 8, fontSize: "0.75rem", lineHeight: 1.5 }}>
          <div>
            Bạn sắp xoá toàn bộ dữ liệu biểu đồ của{" "}
            <strong style={{ color: C.textBright }}>{sensor?.name || sensor?.id}</strong>.
          </div>
          <div style={{ color: C.textMuted, fontSize: "0.72rem" }}>
            Hành động này sẽ xoá telemetry và phổ đã lưu, không thể hoàn tác.
          </div>
        </div>
      </Modal>
    </>
  );
}
