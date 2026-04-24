import React, { startTransition, useState, useMemo, useRef, useEffect, useCallback, useId } from "react";
import { X, Thermometer, BarChart3, Activity, Trash2, Settings, Clock3, CalendarDays, ChevronDown, ArrowLeft, ArrowRight } from "lucide-react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Brush } from "@visx/brush";
import type BaseBrush from "@visx/brush/lib/BaseBrush";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor, SpectrumAxis } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";
import type { ToastItem } from "./ui";
import { ConsoleButton, Modal } from "./ui";

const GRAVITY_MS2 = 9.80665;
const ACCEL_LIMIT_MS2 = 8 * GRAVITY_MS2;
const ACCEL_LIMIT_MIN_MS2 = 0.1 * GRAVITY_MS2;
const ACCEL_LIMIT_MAX_MS2 = 16 * GRAVITY_MS2;
const TEMP_HALF_SPAN_MIN = 0.25;
const TEMP_HALF_SPAN_MAX = 80;
const TREND_MIN_RENDER_POINTS = 240;
const TREND_MAX_RENDER_POINTS = 2200;
const TREND_TILE_PIXEL_WIDTH = 12;
const TREND_ZOOM_STEP = 1.18;
const TREND_MIN_VIEW_WINDOW_MS = 60 * 1000;
const TREND_PAN_CLICK_SUPPRESS_MS = 120;
const TREND_LATEST_EPSILON_MS = 5_000;
const TREND_OVERVIEW_MAX_POINTS = 260;
const TREND_MAX_GAP_STEP_RATIO = 1 / 120;
const TREND_BUTTON_PAN_CLICK_RATIO = 0.12;
const TREND_BUTTON_PAN_FRAME_MS = 34;
const TREND_BUTTON_PAN_BASE_WINDOWS_PER_SECOND = 0.16;
const TREND_BUTTON_PAN_MAX_WINDOWS_PER_SECOND = 1.05;
const TREND_BUTTON_PAN_ACCELERATION_MS = 2_400;
const ACCEL_RMS_MIN_WINDOW_MS = 10 * 1000;
const ACCEL_RMS_TARGET_SAMPLES = 12;
const ACCEL_RMS_MAX_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_SPECTRUM_SAMPLE_RATE_HZ = 1000;
const DEFAULT_SPECTRUM_SOURCE_SAMPLES = 1024;
const SPECTRUM_RENDER_BARS = 512;
const SPECTRUM_HOVER_FETCH_DEBOUNCE_MS = 500;
const SPECTRUM_HOVER_FETCH_MIN_DELTA_MS = 500;
const SPECTRUM_FIXED_Y_MAX_FALLBACK = 1;
const SPECTRUM_LOADING_LABEL = "Đang tải dữ liệu";
const EMPTY_SPECTRUM_POINTS: DeviceSpectrumPoint[] = [];
const DATA_SETTINGS_MODAL_CLOSE_MS = 190;
const DATA_SETTINGS_SUMMARY_FETCH_DELAY_MS = 220;
const DATA_SETTINGS_SUMMARY_CACHE_TTL_MS = 12_000;
const CLEAR_DATA_CONFIRM_MODAL_CLOSE_MS = 170;
const CHART_MODAL_TRANSITION_MS = 140;
const TOP_TREND_CHART_HEIGHT = 220;
const TREND_OVERVIEW_HEIGHT = 108;
const SPECTRUM_CHART_HEIGHT = 160;
const CHART_MODAL_EXPANDED_CHART_PX = 50;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const CALENDAR_WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;
const VIBRATION_AXIS_LABELS = {
  ax: "Radial H",
  ay: "Axial",
  az: "Radial V",
} as const;

type ChartModalLayout = {
  viewportWidth: number;
  viewportHeight: number;
  chartHeight: number;
  overviewHeight: number;
  spectrumHeight: number;
  topGridGap: number;
  sectionGap: number;
  chartTitleGap: number;
  chartCardPadding: string;
  overviewCardPadding: string;
  fftHeaderGap: number;
  fftGridGap: number;
  fftCardPadding: string;
  fftAxisFooterHeight: number;
  topGridColumns: string;
  spectrumGridColumns: string;
  headerPadding: string;
  contentPadding: string;
  modalWidth: string;
  modalMaxHeight: string;
};

function getChartModalLayout(): ChartModalLayout {
  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const scaledDesktopHeight = viewportHeight < 1120;
  const midHeight = viewportHeight < 960;
  const compactHeight = viewportHeight < 820;
  const tightHeight = viewportHeight < 720;
  const narrowWidth = viewportWidth < 1500;
  const compactWidth = viewportWidth < 1280;

  return {
    viewportWidth,
    viewportHeight,
    chartHeight: tightHeight
      ? 112 + CHART_MODAL_EXPANDED_CHART_PX
      : compactHeight
        ? 132 + CHART_MODAL_EXPANDED_CHART_PX
        : midHeight
          ? 154 + CHART_MODAL_EXPANDED_CHART_PX
          : scaledDesktopHeight
            ? 172 + CHART_MODAL_EXPANDED_CHART_PX
            : TOP_TREND_CHART_HEIGHT + CHART_MODAL_EXPANDED_CHART_PX,
    overviewHeight: tightHeight
      ? 48
      : compactHeight
        ? 56
        : midHeight
          ? 66
          : scaledDesktopHeight
            ? 78
            : TREND_OVERVIEW_HEIGHT,
    spectrumHeight: tightHeight
      ? 78 + CHART_MODAL_EXPANDED_CHART_PX
      : compactHeight
        ? 96 + CHART_MODAL_EXPANDED_CHART_PX
        : midHeight
          ? 112 + CHART_MODAL_EXPANDED_CHART_PX
          : scaledDesktopHeight
            ? 124 + CHART_MODAL_EXPANDED_CHART_PX
            : SPECTRUM_CHART_HEIGHT + CHART_MODAL_EXPANDED_CHART_PX,
    topGridGap: tightHeight ? 8 : compactHeight ? 9 : 10,
    sectionGap: tightHeight ? 7 : compactHeight ? 8 : scaledDesktopHeight ? 9 : 12,
    chartTitleGap: tightHeight ? 4 : scaledDesktopHeight ? 5 : 8,
    chartCardPadding: tightHeight
      ? "6px 6px 5px"
      : compactHeight
        ? "7px 6px 5px"
        : scaledDesktopHeight
          ? "8px 7px 6px"
          : "12px 8px 8px",
    overviewCardPadding: tightHeight
      ? "6px 7px 5px"
      : compactHeight
        ? "7px 8px 6px"
        : scaledDesktopHeight
          ? "8px 9px 6px"
          : "10px 10px 8px",
    fftHeaderGap: tightHeight ? 5 : compactHeight ? 6 : 7,
    fftGridGap: tightHeight ? 7 : compactHeight ? 8 : 10,
    fftCardPadding: tightHeight
      ? "7px 5px 5px"
      : compactHeight
        ? "8px 5px 5px"
        : scaledDesktopHeight
          ? "8px 6px 5px"
          : "10px 6px 6px",
    fftAxisFooterHeight: tightHeight ? 8 : 10,
    topGridColumns: viewportWidth < 980 ? "1fr" : "repeat(2, minmax(0, 1fr))",
    spectrumGridColumns:
      viewportWidth < 900
        ? "1fr"
        : compactWidth
          ? "repeat(2, minmax(0, 1fr))"
          : "repeat(3, minmax(0, 1fr))",
    headerPadding: tightHeight
      ? "8px 11px 7px"
      : compactHeight
        ? "9px 12px 8px"
        : scaledDesktopHeight
          ? "10px 14px 9px"
          : "14px 18px 12px",
    contentPadding: tightHeight
      ? "8px 10px 10px"
      : compactHeight
        ? "10px 12px 12px"
        : scaledDesktopHeight
          ? "12px 14px 14px"
          : "16px 20px",
    modalWidth: narrowWidth ? "calc(100vw - 24px)" : "min(94vw, 1440px)",
    modalMaxHeight: tightHeight
      ? "calc(100dvh - 16px)"
      : compactHeight
        ? "calc(100dvh - 24px)"
        : scaledDesktopHeight
          ? "min(calc(100dvh - 48px), 900px)"
          : "min(90dvh, 880px)",
  };
}

function stopWheelScroll(event: React.WheelEvent<HTMLElement | SVGElement>) {
  event.stopPropagation();
}

function getPrimaryWheelDelta(event: React.WheelEvent<HTMLElement | SVGElement>): number {
  const { deltaX, deltaY } = event;
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX;
  }
  return deltaY;
}

function useNonPassiveWheelBlock(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const blockWheelDefault = (event: WheelEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    node.addEventListener("wheel", blockWheelDefault, { passive: false });
    return () => {
      node.removeEventListener("wheel", blockWheelDefault);
    };
  }, [ref]);
}

type HistoryPresetKey = "1h" | "6h" | "12h" | "1d" | "3d" | "1w" | "1m";
const DEFAULT_HISTORY_PRESET_KEY: HistoryPresetKey = "12h";

const TELEMETRY_HISTORY_PRESETS: Array<{
  key: HistoryPresetKey;
  label: string;
  windowMs: number;
  limit: number;
}> = [
  { key: "1h", label: "1 giờ", windowMs: 60 * 60 * 1000, limit: 800 },
  { key: "6h", label: "6 giờ", windowMs: 6 * 60 * 60 * 1000, limit: 1000 },
  { key: "12h", label: "12 giờ", windowMs: 12 * 60 * 60 * 1000, limit: 1400 },
  { key: "1d", label: "1 ngày", windowMs: 24 * 60 * 60 * 1000, limit: 1800 },
  { key: "3d", label: "3 ngày", windowMs: 3 * 24 * 60 * 60 * 1000, limit: 2400 },
  { key: "1w", label: "1 tuần", windowMs: 7 * 24 * 60 * 60 * 1000, limit: 3000 },
  { key: "1m", label: "1 tháng", windowMs: 30 * 24 * 60 * 60 * 1000, limit: 3600 },
];

function getDefaultTrendViewWindowMs(
  _presetKey: HistoryPresetKey | null | undefined,
  loadedWindowMs: number,
): number {
  return Math.max(1, loadedWindowMs);
}

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

function formatTrendAxisTime(input: number, domainStartMs: number, domainEndMs: number): string {
  if (!Number.isFinite(input)) {
    return "";
  }
  const value = new Date(input);
  const start = new Date(domainStartMs);
  const end = new Date(domainEndMs);
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");
  const ss = String(value.getSeconds()).padStart(2, "0");
  const sameDay =
    start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  if (sameDay) {
    return domainEndMs - domainStartMs <= 2 * 60 * 1000 ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  }
  return formatAbsoluteAxisTime(input);
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

function clampTempHalfSpan(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(TEMP_HALF_SPAN_MIN, Math.min(TEMP_HALF_SPAN_MAX, Number(value.toFixed(3))));
}

function clampAccelAmplitudeLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return ACCEL_LIMIT_MS2;
  }
  return Math.max(ACCEL_LIMIT_MIN_MS2, Math.min(ACCEL_LIMIT_MAX_MS2, Number(value.toFixed(4))));
}

function formatDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateInputLabel(value: string): string {
  if (!value) {
    return "Chọn ngày";
  }
  const parsed = Date.parse(`${value}T00:00:00`);
  if (!Number.isFinite(parsed)) {
    return "Chọn ngày";
  }
  return new Date(parsed).toLocaleDateString("vi-VN");
}

function parseDateInputValue(value: string): Date | null {
  const parsed = Date.parse(`${value}T00:00:00`);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function startOfMonthLocal(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1, 0, 0, 0, 0);
}

function addMonthsLocal(value: Date, delta: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + delta, 1, 0, 0, 0, 0);
}

function formatMonthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(value: Date): string {
  const month = value.toLocaleDateString("vi-VN", { month: "long" });
  return `${month} ${value.getFullYear()}`;
}

type CalendarDayCell = {
  dateValue: string;
  dayNumber: number;
  monthOffset: -1 | 0 | 1;
  isFuture: boolean;
  isToday: boolean;
};

function buildCalendarDayCells(monthAnchor: Date, now = new Date()): CalendarDayCell[] {
  const monthStart = startOfMonthLocal(monthAnchor);
  const monthIndex = monthStart.getFullYear() * 12 + monthStart.getMonth();
  const weekdayIndex = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - weekdayIndex);
  gridStart.setHours(0, 0, 0, 0);

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const cells: CalendarDayCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + index);
    cellDate.setHours(0, 0, 0, 0);
    const cellMonthIndex = cellDate.getFullYear() * 12 + cellDate.getMonth();
    const monthOffset = cellMonthIndex === monthIndex ? 0 : cellMonthIndex < monthIndex ? -1 : 1;
    const cellTimestamp = cellDate.getTime();
    cells.push({
      dateValue: formatDateInputValue(cellDate),
      dayNumber: cellDate.getDate(),
      monthOffset,
      isFuture: cellTimestamp > todayStart,
      isToday: cellTimestamp === todayStart,
    });
  }
  return cells;
}

type TelemetryAvailabilityDay = {
  date: string;
  count: number;
};

function parseTelemetryAvailabilityPayload(payload: unknown): TelemetryAvailabilityDay[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const source = Array.isArray(data.days) ? data.days : Array.isArray(root.days) ? root.days : [];
  const mapped = source
    .map((item) => {
      const row = asRecord(item);
      const date = asNonEmptyString(row.date) ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return null;
      }
      const count = Math.max(0, Math.floor(asFiniteNumber(row.count) ?? 0));
      return { date, count };
    })
    .filter((item): item is TelemetryAvailabilityDay => Boolean(item));
  return mapped.sort((left, right) => left.date.localeCompare(right.date));
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

function clipGapRangesToWindow(
  ranges: TrendGapSegment[],
  windowStartTs: number,
  windowEndTs: number,
): TrendGapSegment[] {
  const safeStartTs = Math.min(windowStartTs, windowEndTs);
  const safeEndTs = Math.max(windowStartTs, windowEndTs);
  return ranges
    .map((range) => {
      const from = Math.max(safeStartTs, range.from);
      const to = Math.min(safeEndTs, range.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return null;
      }
      return { from, to };
    })
    .filter((range): range is TrendGapSegment => Boolean(range));
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
  startClientX: number;
  startDomainStartMs: number;
  startDomainEndMs: number;
  plotWidth: number;
  moved: boolean;
};

type ButtonPanState = {
  direction: -1 | 1;
  startedAt: number;
  lastTickAt: number;
};

type TrendViewport = {
  startMs: number;
  endMs: number;
};

type AccelTrendMode = "instant" | "rms";

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

function buildRollingRmsAccelRows(
  rows: DenseTelemetryRow[],
  windowMs: number,
): Array<{ ts: number; telemetryUuid?: string; ax: number | null; ay: number | null; az: number | null }> {
  const safeWindowMs = Math.max(1, windowMs);
  const axes = ["ax", "ay", "az"] as const;
  const state: Record<
    (typeof axes)[number],
    { samples: Array<{ ts: number; value: number }>; sumSquares: number }
  > = {
    ax: { samples: [], sumSquares: 0 },
    ay: { samples: [], sumSquares: 0 },
    az: { samples: [], sumSquares: 0 },
  };

  return rows.map((row) => {
    const next: { ts: number; telemetryUuid?: string; ax: number | null; ay: number | null; az: number | null } = {
      ts: row.ts,
      telemetryUuid: row.telemetryUuid,
      ax: null,
      ay: null,
      az: null,
    };

    for (const axis of axes) {
      const axisState = state[axis];
      const rawValue = row[axis];
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
        axisState.samples = [];
        axisState.sumSquares = 0;
        next[axis] = null;
        continue;
      }

      axisState.samples.push({ ts: row.ts, value: rawValue });
      axisState.sumSquares += rawValue * rawValue;

      const cutoffTs = row.ts - safeWindowMs;
      while (axisState.samples.length > 0 && (axisState.samples[0]?.ts ?? row.ts) < cutoffTs) {
        const removed = axisState.samples.shift();
        if (removed) {
          axisState.sumSquares -= removed.value * removed.value;
        }
      }

      const sampleCount = axisState.samples.length;
      next[axis] = sampleCount > 0
        ? Number(Math.sqrt(Math.max(0, axisState.sumSquares) / sampleCount).toFixed(4))
        : null;
    }

    return next;
  });
}

function clampTrendViewport(
  requestedViewport: TrendViewport,
  boundsStartMs: number,
  boundsEndMs: number,
  minDurationMs: number,
): TrendViewport {
  const safeBoundsEndMs = boundsEndMs > boundsStartMs ? boundsEndMs : boundsStartMs + 1;
  const boundsDurationMs = safeBoundsEndMs - boundsStartMs;
  const safeMinDurationMs = Math.max(1, Math.min(boundsDurationMs, minDurationMs));
  const requestedStartMs = Math.min(requestedViewport.startMs, requestedViewport.endMs);
  const requestedEndMs = Math.max(requestedViewport.startMs, requestedViewport.endMs);
  let durationMs = Math.max(safeMinDurationMs, requestedEndMs - requestedStartMs);
  durationMs = Math.min(boundsDurationMs, durationMs);

  let startMs = requestedStartMs;
  let endMs = startMs + durationMs;
  if (endMs > safeBoundsEndMs) {
    endMs = safeBoundsEndMs;
    startMs = endMs - durationMs;
  }
  if (startMs < boundsStartMs) {
    startMs = boundsStartMs;
    endMs = startMs + durationMs;
  }

  return {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
  };
}

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

function buildOverviewTelemetryRows(rows: DenseTelemetryRow[], maxPoints = TREND_OVERVIEW_MAX_POINTS): DenseTelemetryRow[] {
  if (rows.length <= maxPoints) {
    return rows;
  }
  return buildTiledTrendRows(rows, ["temp", "ax", "ay", "az"], maxPoints, Math.max(24, Math.round(maxPoints / 3)))
    .map((row) => ({
      ts: row.ts,
      telemetryUuid: typeof row.telemetryUuid === "string" ? row.telemetryUuid : undefined,
      temp: typeof row.temp === "number" ? row.temp : null,
      ax: typeof row.ax === "number" ? row.ax : null,
      ay: typeof row.ay === "number" ? row.ay : null,
      az: typeof row.az === "number" ? row.az : null,
    }));
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

function TrendOverviewBrush({
  rows,
  gapSegments,
  selectedStartTs,
  selectedEndTs,
  resetKey,
  axisLabelColor,
  C,
  height = TREND_OVERVIEW_HEIGHT,
  minWindowMs = TREND_MIN_VIEW_WINDOW_MS,
  onRangeCommit,
}: {
  rows: DenseTelemetryRow[];
  gapSegments: TrendGapSegment[];
  selectedStartTs: number;
  selectedEndTs: number;
  resetKey: string;
  axisLabelColor: string;
  C: {
    surface: string;
    border: string;
    textBright: string;
    textMuted: string;
    primary: string;
  };
  height?: number;
  minWindowMs?: number;
  onRangeCommit?: (startTs: number, endTs: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useNonPassiveWheelBlock(wrapperRef);
  const brushRef = useRef<BaseBrush | null>(null);
  const brushFrameRef = useRef<number | null>(null);
  const pendingBrushRangeRef = useRef<{ startTs: number; endTs: number } | null>(null);
  const lastBrushRangeRef = useRef<{ startTs: number; endTs: number } | null>(null);
  const suppressBrushChangeRef = useRef(false);
  const [chartWidth, setChartWidth] = useState(0);
  const margin = useMemo(() => ({ top: 10, right: 12, bottom: 24, left: 12 }), []);
  const handleOverviewContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);
  const handleOverviewMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    return () => {
      if (brushFrameRef.current !== null) {
        window.cancelAnimationFrame(brushFrameRef.current);
        brushFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const updateWidth = () => {
      const measuredWidth = wrapper.clientWidth || wrapper.offsetWidth || wrapper.getBoundingClientRect().width;
      const next = Math.max(0, Math.round(measuredWidth));
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
  const xMax = Math.max(1, chartWidth - margin.left - margin.right);
  const yMax = Math.max(1, height - margin.top - margin.bottom);
  const overviewTickCount = Math.max(2, Math.min(6, Math.floor(xMax / 150)));
  const overviewRows = useMemo(() => buildOverviewTelemetryRows(rows), [rows]);

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
      overviewRows
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
    [overviewRows],
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
    const padding = (max - min) * 0.14;
    return [Math.max(0, min - padding), max + padding] as const;
  }, [lineData]);
  const hasOverviewLineData = lineData.length > 1;
  const canRenderOverviewBrush = rows.length > 0;

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [yMin, yMaxValue],
        range: [yMax, 0],
      }),
    [yMax, yMaxValue, yMin],
  );

  const initialBrushPosition = useMemo(() => {
    const startX = Math.max(0, Math.min(xMax, xScale(new Date(selectedStartTs))));
    const endX = Math.max(0, Math.min(xMax, xScale(new Date(selectedEndTs))));
    return {
      start: { x: Math.min(startX, endX), y: 0 },
      end: { x: Math.max(startX, endX), y: yMax },
    };
  }, [selectedEndTs, selectedStartTs, xMax, xScale, yMax]);

  const emitRange = useCallback(
    (nextStartTs: number, nextEndTs: number, immediate = false) => {
      const normalizedRange = {
        startTs: Math.round(Math.min(nextStartTs, nextEndTs)),
        endTs: Math.round(Math.max(nextStartTs, nextEndTs)),
      };
      const lastRange = lastBrushRangeRef.current;
      if (
        lastRange
        && Math.abs(lastRange.startTs - normalizedRange.startTs) <= 1
        && Math.abs(lastRange.endTs - normalizedRange.endTs) <= 1
      ) {
        return;
      }

      pendingBrushRangeRef.current = normalizedRange;
      const flush = () => {
        brushFrameRef.current = null;
        const range = pendingBrushRangeRef.current;
        if (!range) {
          return;
        }
        pendingBrushRangeRef.current = null;
        lastBrushRangeRef.current = range;
        onRangeCommit?.(range.startTs, range.endTs);
      };

      if (immediate) {
        if (brushFrameRef.current !== null) {
          window.cancelAnimationFrame(brushFrameRef.current);
          brushFrameRef.current = null;
        }
        flush();
        return;
      }

      if (brushFrameRef.current === null) {
        brushFrameRef.current = window.requestAnimationFrame(flush);
      }
    },
    [onRangeCommit],
  );

  const toBrushRange = useCallback(
    (bounds: unknown) => {
      const record = asRecord(bounds);
      const x0 = asTimestampMs(record.x0);
      const x1 = asTimestampMs(record.x1);
      if (typeof x0 !== "number" || typeof x1 !== "number") {
        return null;
      }
      const nextStartTs = Math.max(firstTs, Math.min(lastTs, Math.min(x0, x1)));
      const nextEndTs = Math.max(firstTs, Math.min(lastTs, Math.max(x0, x1)));
      if (Math.abs(nextEndTs - nextStartTs) < 1) {
        return null;
      }
      return { startTs: nextStartTs, endTs: nextEndTs };
    },
    [firstTs, lastTs],
  );

  const handleBrushChange = useCallback(
    (bounds: unknown) => {
      if (suppressBrushChangeRef.current) {
        suppressBrushChangeRef.current = false;
        return;
      }
      const nextRange = toBrushRange(bounds);
      if (!nextRange) {
        return;
      }
      emitRange(nextRange.startTs, nextRange.endTs);
    },
    [emitRange, toBrushRange],
  );

  const handleBrushEnd = useCallback(
    (bounds: unknown) => {
      if (suppressBrushChangeRef.current) {
        suppressBrushChangeRef.current = false;
        return;
      }
      const nextRange = toBrushRange(bounds);
      if (!nextRange) {
        return;
      }
      emitRange(nextRange.startTs, nextRange.endTs, true);
    },
    [emitRange, toBrushRange],
  );

  const handleOverviewWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!onRangeCommit) {
        stopWheelScroll(event);
        return;
      }
      stopWheelScroll(event);

      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left - margin.left;
      const chartX = Math.max(0, Math.min(xMax, localX));
      const pointerTs = xScale.invert(chartX).getTime();
      const currentStartTs = Math.min(selectedStartTs, selectedEndTs);
      const currentEndTs = Math.max(selectedStartTs, selectedEndTs);
      const currentDurationMs = Math.max(1, currentEndTs - currentStartTs);
      const boundsDurationMs = Math.max(1, lastTs - firstTs);
      const zoomOut = event.deltaY > 0;
      const nextDurationMs = Math.max(
        Math.min(boundsDurationMs, Math.max(1, minWindowMs)),
        Math.min(boundsDurationMs, currentDurationMs * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP)),
      );

      if (Math.abs(nextDurationMs - currentDurationMs) < 1) {
        return;
      }

      const anchorTs = Math.max(currentStartTs, Math.min(currentEndTs, pointerTs));
      const anchorRatio = currentDurationMs > 0 ? (anchorTs - currentStartTs) / currentDurationMs : 0.5;
      const proposedStartTs = anchorTs - anchorRatio * nextDurationMs;
      const nextViewport = clampTrendViewport(
        {
          startMs: proposedStartTs,
          endMs: proposedStartTs + nextDurationMs,
        },
        firstTs,
        lastTs,
        minWindowMs,
      );
      emitRange(nextViewport.startMs, nextViewport.endMs, true);
    },
    [
      emitRange,
      firstTs,
      lastTs,
      margin.left,
      minWindowMs,
      onRangeCommit,
      selectedEndTs,
      selectedStartTs,
      xMax,
      xScale,
    ],
  );

  useEffect(() => {
    const brush = brushRef.current;
    if (!brush || xMax <= 0 || yMax <= 0 || brush.state.isBrushing) {
      return;
    }

    const startX = Math.max(0, Math.min(xMax, xScale(new Date(selectedStartTs))));
    const endX = Math.max(0, Math.min(xMax, xScale(new Date(selectedEndTs))));
    const nextStartX = Math.min(startX, endX);
    const nextEndX = Math.max(startX, endX);
    const currentExtent = brush.state.extent;
    if (
      Math.abs((currentExtent.x0 ?? 0) - nextStartX) <= 0.75
      && Math.abs((currentExtent.x1 ?? 0) - nextEndX) <= 0.75
    ) {
      return;
    }

    const nextExtent = brush.getExtent({ x: nextStartX, y: 0 }, { x: nextEndX, y: yMax });
    suppressBrushChangeRef.current = true;
    brush.updateBrush((prevBrush) => ({
      ...prevBrush,
      start: { x: nextStartX, y: 0 },
      end: { x: nextEndX, y: yMax },
      extent: nextExtent,
      bounds: {
        x0: 0,
        x1: xMax,
        y0: 0,
        y1: yMax,
      },
    }));
  }, [selectedEndTs, selectedStartTs, xMax, xScale, yMax]);

  return (
    <div
      ref={wrapperRef}
      onContextMenu={handleOverviewContextMenu}
      onMouseDownCapture={handleOverviewMouseDownCapture}
      onWheel={handleOverviewWheel}
      style={{
        width: "100%",
        height,
        userSelect: "none",
        WebkitUserSelect: "none",
        overscrollBehavior: "contain",
      }}
    >
      {chartWidth > 0 ? (
        <svg width={chartWidth} height={height}>
          <Group left={margin.left} top={margin.top}>
            <rect
              x={0}
              y={0}
              width={xMax}
              height={yMax}
              rx={8}
              fill={C.surface}
              stroke={C.border}
            />

            {gapSegments.map((segment, index) => {
              const rawX1 = xScale(new Date(segment.from));
              const rawX2 = xScale(new Date(segment.to));
              const x1 = Math.max(0, Math.min(xMax, rawX1));
              const x2 = Math.max(0, Math.min(xMax, rawX2));
              if (Math.abs(x2 - x1) < 0.5) {
                return null;
              }
              return (
                <rect
                  key={`overview-gap-${index}`}
                  x={Math.min(x1, x2)}
                  y={0}
                  width={Math.max(1, Math.abs(x2 - x1))}
                  height={yMax}
                  fill="rgba(254, 240, 138, 0.42)"
                  stroke="rgba(245, 158, 11, 0.22)"
                  strokeWidth={0.6}
                />
              );
            })}

            {hasOverviewLineData ? (
              <>
                <LinePath
                  data={lineData}
                  x={(point) => xScale(new Date(point.ts))}
                  y={(point) => yScale(point.value)}
                  stroke={C.primary}
                  strokeWidth={4.2}
                  strokeOpacity={0.12}
                />
                <LinePath
                  data={lineData}
                  x={(point) => xScale(new Date(point.ts))}
                  y={(point) => yScale(point.value)}
                  stroke={C.primary}
                  strokeWidth={1.7}
                  strokeOpacity={0.88}
                />
              </>
            ) : null}

            {canRenderOverviewBrush ? (
              <Brush
                key={resetKey}
                innerRef={brushRef}
                xScale={xScale}
                yScale={yScale}
                width={xMax}
                height={yMax}
                initialBrushPosition={initialBrushPosition}
                handleSize={10}
                brushDirection="horizontal"
                resizeTriggerAreas={["left", "right"]}
                useWindowMoveEvents
                selectedBoxStyle={{
                  fill: "rgba(59, 130, 246, 0.16)",
                  stroke: "transparent",
                  strokeWidth: 0,
                }}
                onChange={handleBrushChange}
                onBrushEnd={handleBrushEnd}
                renderBrushHandle={({ x, y, width, height: handleHeight, isBrushActive, className }) => {
                  const visualY = Math.max(0, y + 1);
                  const visualHeight = Math.max(14, Math.min(yMax - visualY, handleHeight - 2));
                  const hitWidth = Math.max(22, width + 12);
                  const hitX = x - (hitWidth - width) / 2;
                  return (
                    <g className={className} data-ux="overview-brush-handle" style={{ cursor: "ew-resize" }}>
                      <rect
                        x={hitX}
                        y={0}
                        width={hitWidth}
                        height={yMax}
                        fill="transparent"
                        pointerEvents="all"
                        style={{ cursor: "ew-resize" }}
                      />
                      <rect
                        x={x}
                        y={visualY}
                        width={width}
                        height={visualHeight}
                        rx={Math.min(5, width / 2)}
                        fill={isBrushActive ? "#93c5fd" : "#60a5fae0"}
                        stroke="rgba(191, 219, 254, 0.96)"
                        strokeWidth={0.9}
                        pointerEvents="none"
                      />
                    </g>
                  );
                }}
              />
            ) : null}

          </Group>

          <AxisBottom
            scale={xScale}
            left={margin.left}
            top={margin.top + yMax}
            numTicks={overviewTickCount}
            tickFormat={(value) => formatTrendAxisTime(Number(value), firstTs, lastTs)}
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
  timeDomain,
  yDomain,
  pinnedTarget,
  showLegend = false,
  gridColor,
  axisLabelColor,
  C,
  height = 150,
  panActive = false,
  canPanOlder = false,
  canPanNewer = false,
  onHoverTarget,
  onPinTarget,
  onViewportZoom,
  onYAxisZoom,
  onViewportPanChange,
  onViewportPanStateChange,
  onLeave,
}: {
  data: TrendRow[];
  hoverPoints: Array<{ ts: number; telemetryUuid?: string }>;
  series: TrendSeriesConfig[];
  gapSegmentsBySeries?: Record<string, TrendGapSegment[]>;
  timeDomain?: [number, number];
  yDomain: [number, number];
  pinnedTarget?: SpectrumHoverTarget | null;
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
  panActive?: boolean;
  canPanOlder?: boolean;
  canPanNewer?: boolean;
  onHoverTarget?: (target: SpectrumHoverTarget) => void;
  onPinTarget?: (target: SpectrumHoverTarget) => void;
  onViewportZoom?: (next: { anchorTs: number; deltaY: number }) => void;
  onYAxisZoom?: (next: { deltaY: number }) => void;
  onViewportPanChange?: (next: TrendViewport) => void;
  onViewportPanStateChange?: (active: boolean) => void;
  onLeave?: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useNonPassiveWheelBlock(wrapperRef);
  const rawPlotClipId = useId();
  const plotClipId = useMemo(
    () => `trend-plot-${rawPlotClipId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawPlotClipId],
  );
  const panStateRef = useRef<ChartPanState | null>(null);
  const buttonPanStateRef = useRef<ButtonPanState | null>(null);
  const buttonPanTimerRef = useRef<number | null>(null);
  const buttonPanDomainRef = useRef<TrendViewport>({ startMs: 0, endMs: 1 });
  const buttonPanAvailabilityRef = useRef({ older: false, newer: false });
  const suppressNextClickRef = useRef(false);
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
      const measuredWidth = wrapper.clientWidth || wrapper.offsetWidth || wrapper.getBoundingClientRect().width;
      const next = Math.max(0, Math.round(measuredWidth));
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

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const panState = panStateRef.current;
      if (!panState || !onViewportPanChange) {
        return;
      }
      const deltaX = event.clientX - panState.startClientX;
      if (!panState.moved && Math.abs(deltaX) >= 2) {
        panState.moved = true;
      }
      const msPerPixel =
        (panState.startDomainEndMs - panState.startDomainStartMs) / Math.max(1, panState.plotWidth);
      const deltaMs = -deltaX * msPerPixel;
      onViewportPanChange({
        startMs: panState.startDomainStartMs + deltaMs,
        endMs: panState.startDomainEndMs + deltaMs,
      });
    };

    const handleUp = () => {
      const panState = panStateRef.current;
      if (!panState) {
        return;
      }
      panStateRef.current = null;
      onViewportPanStateChange?.(false);
      if (panState.moved) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, TREND_PAN_CLICK_SUPPRESS_MS);
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [onViewportPanChange, onViewportPanStateChange]);

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
  const timeAxisTickCount = Math.max(2, Math.min(6, Math.floor(innerWidth / 150)));
  const legendItemWidth = showLegend && series.length > 0
    ? Math.max(96, Math.min(176, Math.floor((innerWidth - 12) / series.length)))
    : 78;

  const domainMin = timeDomain?.[0] ?? (data.length > 0 ? data[0]?.ts ?? Date.now() : Date.now() - 1000);
  const domainMaxRaw = timeDomain?.[1] ?? (data.length > 0 ? data[data.length - 1]?.ts ?? Date.now() : Date.now());
  const domainMax = domainMaxRaw > domainMin ? domainMaxRaw : domainMin + 1000;

  useEffect(() => {
    buttonPanDomainRef.current = { startMs: domainMin, endMs: domainMax };
  }, [domainMax, domainMin]);

  useEffect(() => {
    buttonPanAvailabilityRef.current = { older: canPanOlder, newer: canPanNewer };
  }, [canPanNewer, canPanOlder]);

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

  const handleViewportWheel = useCallback(
    (event: React.WheelEvent<SVGRectElement>) => {
      if (event.shiftKey) {
        stopWheelScroll(event);
        const scaleDelta = getPrimaryWheelDelta(event);
        if (scaleDelta !== 0) {
          onYAxisZoom?.({ deltaY: scaleDelta });
        }
        return;
      }

      if (!onViewportZoom) {
        return;
      }
      stopWheelScroll(event);
      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const chartX = Math.max(margin.left, Math.min(margin.left + innerWidth, margin.left + localX));
      const anchorTs = xScale.invert(chartX).getTime();
      onViewportZoom({ anchorTs, deltaY: event.deltaY });
    },
    [innerWidth, margin.left, onViewportZoom, onYAxisZoom, xScale],
  );

  const handleViewportMouseDown = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      if (event.button !== 0 || !onViewportPanChange) {
        return;
      }
      event.preventDefault();
      panStateRef.current = {
        startClientX: event.clientX,
        startDomainStartMs: domainMin,
        startDomainEndMs: domainMax,
        plotWidth: innerWidth,
        moved: false,
      };
      onViewportPanStateChange?.(true);
    },
    [domainMax, domainMin, innerWidth, onViewportPanChange, onViewportPanStateChange],
  );

  const handlePointerLeave = useCallback(() => {
    setHoverTarget(null);
    onLeave?.();
  }, [onLeave]);

  const handlePointerClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (!hoverTarget || !onPinTarget) {
      return;
    }
    onPinTarget(hoverTarget);
  }, [hoverTarget, onPinTarget]);

  const stopButtonPan = useCallback(() => {
    if (buttonPanTimerRef.current !== null) {
      window.clearTimeout(buttonPanTimerRef.current);
      buttonPanTimerRef.current = null;
    }
    if (buttonPanStateRef.current) {
      buttonPanStateRef.current = null;
      onViewportPanStateChange?.(false);
    }
  }, [onViewportPanStateChange]);

  const panButtonViewportBy = useCallback(
    (deltaMs: number) => {
      if (!onViewportPanChange || !Number.isFinite(deltaMs) || Math.abs(deltaMs) < 1) {
        return;
      }
      const current = buttonPanDomainRef.current;
      const nextWindow = {
        startMs: current.startMs + deltaMs,
        endMs: current.endMs + deltaMs,
      };
      buttonPanDomainRef.current = nextWindow;
      onViewportPanChange(nextWindow);
    },
    [onViewportPanChange],
  );

  const runButtonPanTick = useCallback(() => {
    const state = buttonPanStateRef.current;
    if (!state) {
      return;
    }
    const availability = buttonPanAvailabilityRef.current;
    if ((state.direction < 0 && !availability.older) || (state.direction > 0 && !availability.newer)) {
      stopButtonPan();
      return;
    }

    const now = performance.now();
    const elapsedMs = Math.max(0, now - state.startedAt);
    const deltaTimeMs = Math.min(140, Math.max(0, now - state.lastTickAt));
    state.lastTickAt = now;

    const accelerationRatio = Math.min(1, elapsedMs / TREND_BUTTON_PAN_ACCELERATION_MS);
    const windowsPerSecond =
      TREND_BUTTON_PAN_BASE_WINDOWS_PER_SECOND
      + (TREND_BUTTON_PAN_MAX_WINDOWS_PER_SECOND - TREND_BUTTON_PAN_BASE_WINDOWS_PER_SECOND) * accelerationRatio;
    const currentWindowMs = Math.max(
      1,
      buttonPanDomainRef.current.endMs - buttonPanDomainRef.current.startMs,
    );
    panButtonViewportBy(state.direction * currentWindowMs * windowsPerSecond * (deltaTimeMs / 1000));

    buttonPanTimerRef.current = window.setTimeout(runButtonPanTick, TREND_BUTTON_PAN_FRAME_MS);
  }, [panButtonViewportBy, stopButtonPan]);

  const startButtonPan = useCallback(
    (direction: -1 | 1, event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!onViewportPanChange) {
        return;
      }
      const availability = buttonPanAvailabilityRef.current;
      if ((direction < 0 && !availability.older) || (direction > 0 && !availability.newer)) {
        return;
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; the window-level timer still stops on blur/unmount.
      }

      if (buttonPanTimerRef.current !== null) {
        window.clearTimeout(buttonPanTimerRef.current);
        buttonPanTimerRef.current = null;
      }

      const now = performance.now();
      buttonPanDomainRef.current = { startMs: domainMin, endMs: domainMax };
      buttonPanStateRef.current = { direction, startedAt: now, lastTickAt: now };
      onViewportPanStateChange?.(true);

      const currentWindowMs = Math.max(1, domainMax - domainMin);
      panButtonViewportBy(direction * currentWindowMs * TREND_BUTTON_PAN_CLICK_RATIO);
      buttonPanTimerRef.current = window.setTimeout(runButtonPanTick, TREND_BUTTON_PAN_FRAME_MS);
    },
    [
      domainMax,
      domainMin,
      onViewportPanChange,
      onViewportPanStateChange,
      panButtonViewportBy,
      runButtonPanTick,
    ],
  );

  useEffect(() => {
    window.addEventListener("blur", stopButtonPan);
    return () => {
      window.removeEventListener("blur", stopButtonPan);
      stopButtonPan();
    };
  }, [stopButtonPan]);

  return (
    <div
      ref={wrapperRef}
      onWheel={stopWheelScroll}
      style={{
        width: "100%",
        height,
        position: "relative",
        cursor: onViewportPanChange ? (panActive ? "grabbing" : "grab") : "default",
        userSelect: "none",
        WebkitUserSelect: "none",
        overscrollBehavior: "contain",
      }}
    >
      {chartWidth > 0 ? (
        <svg width={chartWidth} height={height}>
          <defs>
            <clipPath id={plotClipId}>
              <rect x={margin.left} y={margin.top} width={innerWidth} height={innerHeight} />
            </clipPath>
          </defs>
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

            <g clipPath={`url(#${plotClipId})`}>
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
                    fill="rgba(254, 240, 138, 0.36)"
                    stroke="rgba(245, 158, 11, 0.18)"
                    strokeWidth={0.8}
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

              {pinnedTarget ? (
                <g>
                  <line
                    x1={xScale(new Date(pinnedTarget.timestampMs))}
                    x2={xScale(new Date(pinnedTarget.timestampMs))}
                    y1={margin.top}
                    y2={margin.top + innerHeight}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                  <circle
                    cx={xScale(new Date(pinnedTarget.timestampMs))}
                    cy={margin.top + 7}
                    r={4}
                    fill="#f59e0b"
                    stroke={C.surface}
                    strokeWidth={1.5}
                  />
                </g>
              ) : null}

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
            </g>
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
            numTicks={timeAxisTickCount}
            tickFormat={(value) => formatTrendAxisTime(Number(value), domainMin, domainMax)}
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
                <g key={`legend-${seriesConfig.key}`} transform={`translate(${index * legendItemWidth}, 0)`}>
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
            onWheel={handleViewportWheel}
            onMouseDown={handleViewportMouseDown}
            onMouseMove={handlePointerMove}
            onMouseLeave={handlePointerLeave}
            onClick={handlePointerClick}
          />
        </svg>
      ) : null}

      {onViewportPanChange && canPanOlder ? (
        <button
          type="button"
          data-ux="trend-pan-older"
          aria-label="Dịch vùng thời gian về trước"
          title="Dịch vùng thời gian về trước"
          onPointerDown={(event) => startButtonPan(-1, event)}
          onPointerUp={stopButtonPan}
          onPointerCancel={stopButtonPan}
          onLostPointerCapture={stopButtonPan}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            position: "absolute",
            left: margin.left + 10,
            top: margin.top + innerHeight / 2 - 15,
            width: 30,
            height: 30,
            padding: 0,
            appearance: "none",
            borderRadius: 999,
            border: `1px solid ${C.border}cc`,
            background: `${C.surface}f0`,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
            color: C.textBright,
            opacity: 0.96,
            transform: panActive ? "translateX(-2px)" : "translateX(0)",
            transition: "opacity 0.14s ease, transform 0.14s ease, color 0.14s ease, border-color 0.14s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",
            cursor: "ew-resize",
            zIndex: 3,
            touchAction: "none",
            backdropFilter: "blur(4px)",
          }}
        >
          <ArrowLeft size={15} strokeWidth={2.4} />
        </button>
      ) : null}

      {onViewportPanChange && canPanNewer ? (
        <button
          type="button"
          data-ux="trend-pan-newer"
          aria-label="Dịch vùng thời gian về sau"
          title="Dịch vùng thời gian về sau"
          onPointerDown={(event) => startButtonPan(1, event)}
          onPointerUp={stopButtonPan}
          onPointerCancel={stopButtonPan}
          onLostPointerCapture={stopButtonPan}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            position: "absolute",
            left: chartWidth - margin.right - 40,
            top: margin.top + innerHeight / 2 - 15,
            width: 30,
            height: 30,
            padding: 0,
            appearance: "none",
            borderRadius: 999,
            border: `1px solid ${C.border}cc`,
            background: `${C.surface}f0`,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
            color: C.textBright,
            opacity: 0.96,
            transform: panActive ? "translateX(2px)" : "translateX(0)",
            transition: "opacity 0.14s ease, transform 0.14s ease, color 0.14s ease, border-color 0.14s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",
            cursor: "ew-resize",
            zIndex: 3,
            touchAction: "none",
            backdropFilter: "blur(4px)",
          }}
        >
          <ArrowRight size={15} strokeWidth={2.4} />
        </button>
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
  height = SPECTRUM_CHART_HEIGHT,
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
  height?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useNonPassiveWheelBlock(wrapperRef);
  const [chartWidth, setChartWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const margin = useMemo(
    () => ({
      left: 6,
      right: 8,
      top: 24,
      bottom: 24,
    }),
    [],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const updateWidth = () => {
      const measuredWidth = wrapper.clientWidth || wrapper.offsetWidth || wrapper.getBoundingClientRect().width;
      const next = Math.max(0, Math.round(measuredWidth));
      setChartWidth(next);
    };
    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(wrapper);
    window.addEventListener("resize", updateWidth);

    return () => {
      window.removeEventListener("resize", updateWidth);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!data[hoverIndex ?? -1]) {
      setHoverIndex(null);
    }
  }, [data, hoverIndex]);

  const innerWidth = Math.max(1, chartWidth - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const safeYMax = yMax > 0 ? yMax : 1;
  const barCount = Math.max(1, data.length);
  const barSlotWidth = innerWidth / barCount;
  const barWidth = Math.max(1, barSlotWidth - 1);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, safeYMax],
        range: [margin.top + innerHeight, margin.top],
      }),
    [innerHeight, margin.top, safeYMax],
  );

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, Math.max(1, barCount - 1)],
        range: [margin.left + barSlotWidth / 2, margin.left + innerWidth - barSlotWidth / 2],
      }),
    [barCount, barSlotWidth, innerWidth, margin.left],
  );

  const peakIndex = useMemo(() => {
    if (data.length === 0) {
      return -1;
    }
    let bestIndex = 0;
    for (let index = 1; index < data.length; index += 1) {
      if (data[index].amp > data[bestIndex].amp) {
        bestIndex = index;
      }
    }
    return bestIndex;
  }, [data]);

  const peakPoint = peakIndex >= 0 ? data[peakIndex] : null;
  const peakX = peakIndex >= 0 ? xScale(peakIndex) : margin.left;
  const peakY = peakPoint ? yScale(Math.max(0, Math.min(safeYMax, peakPoint.amp))) : margin.top + innerHeight;

  const peakAnnotation = useMemo(() => {
    if (!peakPoint || peakIndex < 0) {
      return null;
    }

    const titleText = "Peak";
    const freqText = `${peakPoint.freq.toFixed(1)} Hz`;
    const ampText = `${peakPoint.amp.toFixed(3)} ${peakPoint.unit}`;

    const measureText = (text: string, font: string, fallbackWidth = 7) => {
      if (typeof document === "undefined") {
        return text.length * fallbackWidth;
      }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        return text.length * fallbackWidth;
      }
      context.font = font;
      return context.measureText(text).width;
    };

    const titleFontSize = 11;
    const metaFontSize = 9;
    const titleLineHeight = 14;
    const metaLineHeight = 12;
    const padX = 8;
    const padTop = 7;
    const padBottom = 6;

    const contentWidth = Math.max(
      measureText(titleText, `800 ${titleFontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`, 7.2),
      measureText(freqText, `600 ${metaFontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`, 6.2),
      measureText(ampText, `600 ${metaFontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`, 6.2),
    );
    const boxWidth = Math.ceil(contentWidth + padX * 2);
    const boxHeight = padTop + titleLineHeight + metaLineHeight * 2 + padBottom;
    const minX = margin.left + 6;
    const maxX = Math.max(minX, margin.left + innerWidth - boxWidth - 6);
    const prefersLeft = peakX > margin.left + innerWidth * 0.55;
    const preferredX = prefersLeft ? peakX - boxWidth - 28 : peakX + 28;
    const boxX = Math.max(minX, Math.min(maxX, preferredX));

    const minY = margin.top + 4;
    const maxY = Math.max(minY, margin.top + innerHeight - boxHeight - 4);
    const preferredY = peakY - boxHeight - 12;
    const boxY = Math.max(minY, Math.min(maxY, preferredY));

    const startsFromRight = boxX + boxWidth / 2 < peakX;
    const lineStartX = startsFromRight ? boxX + boxWidth : boxX;
    const lineStartY = boxY + boxHeight * 0.58;
    const elbowX = lineStartX + (startsFromRight ? 12 : -12);
    const elbowY = lineStartY;
    const circleRadius = 11;
    const titleY = boxY + padTop + titleFontSize;
    const freqY = titleY + metaLineHeight;
    const ampY = freqY + metaLineHeight;
    const textX = boxX + padX;

    return {
      boxX,
      boxY,
      boxWidth,
      boxHeight,
      lineStartX,
      lineStartY,
      elbowX,
      elbowY,
      circleRadius,
      titleText,
      freqText,
      ampText,
      titleY,
      freqY,
      ampY,
      textX,
    };
  }, [innerHeight, innerWidth, margin.left, margin.top, peakIndex, peakPoint, peakX, peakY]);

  const axisLabelMap = useMemo(() => {
    const labels = new Map<number, string>();
    if (data.length === 0) {
      return labels;
    }
    labels.set(0, "0");
    if (maxHz < 200) {
      return labels;
    }

    const maxMarkedHz = Math.floor(maxHz / 200) * 200;
    for (let targetHz = 200; targetHz <= maxMarkedHz; targetHz += 200) {
      let nearestIndex = 0;
      let nearestDiff = Math.abs(data[0].freq - targetHz);
      for (let index = 1; index < data.length; index += 1) {
        const diff = Math.abs(data[index].freq - targetHz);
        if (diff < nearestDiff) {
          nearestIndex = index;
          nearestDiff = diff;
        }
      }
      labels.set(nearestIndex, `${targetHz}`);
    }
    return labels;
  }, [data, maxHz]);

  const axisTicks = useMemo(
    () => [...axisLabelMap.keys()].sort((left, right) => left - right),
    [axisLabelMap],
  );

  const hoverPoint = hoverIndex !== null ? data[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? xScale(hoverIndex) : 0;

  const resolveHoverIndex = useCallback(
    (clientX: number, rectLeft: number) => {
      if (data.length === 0) {
        return null;
      }
      const localX = clientX - rectLeft;
      const clampedX = Math.max(0, Math.min(innerWidth, localX));
      const ratio = innerWidth > 0 ? clampedX / innerWidth : 0;
      const index = Math.round(ratio * (data.length - 1));
      return Math.max(0, Math.min(data.length - 1, index));
    },
    [data.length, innerWidth],
  );

  return (
    <div
      ref={wrapperRef}
      onWheel={stopWheelScroll}
      style={{
        width: "100%",
        height,
        position: "relative",
        overscrollBehavior: "contain",
      }}
    >
      {chartWidth > 0 ? (
        <svg width={chartWidth} height={height}>
          <Group>
            {yScale.ticks(4).map((tick) => {
              const y = yScale(tick);
              return (
                <line
                  key={`fft-grid-${tick}`}
                  x1={margin.left}
                  x2={margin.left + innerWidth}
                  y1={y}
                  y2={y}
                  stroke={gridColor}
                  strokeDasharray="4 4"
                />
              );
            })}

            {data.map((point, index) => {
              const barX = margin.left + index * barSlotWidth + (barSlotWidth - barWidth) / 2;
              const topY = yScale(Math.max(0, Math.min(safeYMax, point.amp)));
              const height = Math.max(1, margin.top + innerHeight - topY);
              const isPeak = index === peakIndex;
              return (
                <rect
                  key={`fft-bar-${point.bin}-${index}`}
                  x={barX}
                  y={topY}
                  width={barWidth}
                  height={height}
                  rx={Math.min(2, barWidth / 2)}
                  fill={isPeak ? "#f59e0b" : color}
                />
              );
            })}

            {peakAnnotation ? (
              <>
                <circle
                  cx={peakX}
                  cy={peakY}
                  r={peakAnnotation.circleRadius}
                  fill="none"
                  stroke="#f77f6a"
                  strokeWidth={1.8}
                />
                <polyline
                  points={`${peakAnnotation.lineStartX},${peakAnnotation.lineStartY} ${peakAnnotation.elbowX},${peakAnnotation.elbowY} ${peakX},${peakY}`}
                  fill="none"
                  stroke="#f77f6a"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect
                  x={peakAnnotation.boxX}
                  y={peakAnnotation.boxY}
                  width={peakAnnotation.boxWidth}
                  height={peakAnnotation.boxHeight}
                  rx={0}
                  fill={C.surface}
                  stroke={color}
                  strokeWidth={1.2}
                />
                <text
                  x={peakAnnotation.textX}
                  y={peakAnnotation.titleY}
                  fill={C.textBright}
                  fontSize={11}
                  fontWeight={800}
                >
                  {peakAnnotation.titleText}
                </text>
                <text
                  x={peakAnnotation.textX}
                  y={peakAnnotation.freqY}
                  fill={axisLabelColor}
                  fontSize={9}
                  fontWeight={600}
                >
                  {peakAnnotation.freqText}
                </text>
                <text
                  x={peakAnnotation.textX}
                  y={peakAnnotation.ampY}
                  fill={axisLabelColor}
                  fontSize={9}
                  fontWeight={600}
                >
                  {peakAnnotation.ampText}
                </text>
              </>
            ) : null}

            {hoverPoint ? (
              <line
                x1={hoverX}
                x2={hoverX}
                y1={margin.top}
                y2={margin.top + innerHeight}
                stroke="#94a3b8"
                strokeDasharray="3 3"
              />
            ) : null}
          </Group>

          <AxisBottom
            scale={xScale}
            top={margin.top + innerHeight}
            tickValues={axisTicks}
            tickFormat={(value) => {
              const index = typeof value === "number" ? Math.round(value) : Number(value);
              if (!Number.isFinite(index)) {
                return "";
              }
              return axisLabelMap.get(index) ?? "";
            }}
            tickLabelProps={() => ({
              fill: axisLabelColor,
              fontSize: 9,
              textAnchor: "middle",
            })}
            stroke={gridColor}
            tickStroke={gridColor}
          />

          <rect
            x={margin.left}
            y={margin.top}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const nextIndex = resolveHoverIndex(event.clientX, rect.left);
              setHoverIndex(nextIndex);
            }}
            onMouseLeave={() => setHoverIndex(null)}
          />
        </svg>
      ) : null}

      {hoverPoint ? (
        <div
          style={{
            position: "absolute",
            left: Math.min(Math.max(8, hoverX + 10), Math.max(8, chartWidth - 190)),
            top: 34,
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
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Bin {hoverPoint.bin}</div>
          <div style={{ color: C.textMuted, marginBottom: 3 }}>f = {formatFrequencyHz(hoverPoint.freq)}</div>
          <div style={{ color, fontWeight: 700 }}>
            Biên độ: {hoverPoint.amp.toFixed(6)} {hoverPoint.unit}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Section wrapper ── */
function ChartSection({
  title,
  icon,
  children,
  C,
  headerAction,
  titleGap = 8,
  cardPadding = "12px 8px 8px",
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  C: any;
  headerAction?: React.ReactNode;
  titleGap?: number;
  cardPadding?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: titleGap, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ color: C.primary, display: "inline-flex", flexShrink: 0 }}>{icon}</span>
          <span style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 700, minWidth: 0 }}>{title}</span>
        </div>
        {headerAction ? <div style={{ flexShrink: 0 }}>{headerAction}</div> : null}
      </div>
      <div style={{
        background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
        padding: cardPadding,
      }}>
        {children}
      </div>
    </div>
  );
}

function SpectrumLoadingState({
  C,
  accentColor,
  overlay = false,
}: {
  C: {
    surface: string;
    border: string;
    textBright: string;
    textMuted: string;
  };
  accentColor: string;
  overlay?: boolean;
}) {
  return (
    <div
      style={{
        height: overlay ? "100%" : 160,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 10px",
        borderRadius: overlay ? 8 : 0,
        background: overlay ? "rgba(255, 255, 255, 0.88)" : "transparent",
        backdropFilter: overlay ? "blur(1px)" : "none",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          borderRadius: 999,
          border: overlay ? "1px solid rgba(15, 23, 42, 0.16)" : `1px solid ${C.border}`,
          background: overlay ? "rgba(255, 255, 255, 0.96)" : `${C.surface}EE`,
          color: overlay ? "#0f172a" : C.textBright,
          fontSize: "0.68rem",
          fontWeight: 700,
          boxShadow: overlay ? "0 8px 20px rgba(15, 23, 42, 0.12)" : "0 10px 22px rgba(15, 23, 42, 0.14)",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: overlay ? "2px solid rgba(15, 23, 42, 0.18)" : `2px solid ${C.border}`,
            borderTopColor: accentColor,
            animation: "chartSpin 0.8s linear infinite",
          }}
        />
        {SPECTRUM_LOADING_LABEL}
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
  const [accelTrendMode, setAccelTrendMode] = useState<AccelTrendMode>("instant");
  const [trendViewWindow, setTrendViewWindow] = useState<TrendViewport | null>(null);
  const [trendPanning, setTrendPanning] = useState(false);
  const [activeHistoryPreset, setActiveHistoryPreset] = useState<HistoryPresetKey | null>(DEFAULT_HISTORY_PRESET_KEY);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState("");
  const [calendarPopoverOpen, setCalendarPopoverOpen] = useState(false);
  const [calendarHoverDate, setCalendarHoverDate] = useState<string | null>(null);
  const [calendarMonthCursor, setCalendarMonthCursor] = useState<Date>(() => startOfMonthLocal(new Date()));
  const [calendarAvailabilityByMonth, setCalendarAvailabilityByMonth] = useState<Record<string, Record<string, number>>>({});
  const [calendarAvailabilityLoadingKey, setCalendarAvailabilityLoadingKey] = useState<string | null>(null);
  const [calendarAvailabilityError, setCalendarAvailabilityError] = useState("");
  const [timePresetMenuOpen, setTimePresetMenuOpen] = useState(false);
  const [telemetryWindowAnchorMs, setTelemetryWindowAnchorMs] = useState<number>(() => Date.now());
  const [historyPresetLoading, setHistoryPresetLoading] = useState<HistoryPresetKey | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
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
  const [modalLayout, setModalLayout] = useState<ChartModalLayout>(() => getChartModalLayout());
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
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);
  const controlsBusy = Boolean(historyPresetLoading) || calendarLoading;
  const selectedCalendarDateLabel = useMemo(
    () => formatDateInputLabel(selectedCalendarDate),
    [selectedCalendarDate],
  );
  const calendarMonthKey = useMemo(() => formatMonthKey(calendarMonthCursor), [calendarMonthCursor]);
  const calendarMonthLabel = useMemo(() => formatMonthLabel(calendarMonthCursor), [calendarMonthCursor]);
  const calendarMonthAvailability = calendarAvailabilityByMonth[calendarMonthKey] ?? {};
  const calendarMonthLoading = calendarAvailabilityLoadingKey === calendarMonthKey;
  const calendarDayCells = useMemo(() => buildCalendarDayCells(calendarMonthCursor), [calendarMonthCursor]);
  const calendarDaysWithDataCount = useMemo(
    () => Object.values(calendarMonthAvailability).filter((count) => count > 0).length,
    [calendarMonthAvailability],
  );

  useEffect(() => {
    const handleResize = () => {
      setModalLayout(getChartModalLayout());
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

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
    }, CHART_MODAL_TRANSITION_MS);
  }, [clearingDeviceData, onClose]);

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
    setCalendarPopoverOpen(false);
    setCalendarMonthCursor(startOfMonthLocal(new Date()));
    setCalendarAvailabilityByMonth({});
    setCalendarAvailabilityLoadingKey(null);
    setCalendarAvailabilityError("");
  }, [sensor?.id]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) {
        return;
      }

      if (timePresetMenuOpen) {
        const menuNode = timePresetMenuRef.current;
        if (menuNode && !menuNode.contains(targetNode)) {
          setTimePresetMenuOpen(false);
        }
      }

      if (calendarPopoverOpen) {
        const calendarNode = calendarPopoverRef.current;
        if (calendarNode && !calendarNode.contains(targetNode)) {
          setCalendarPopoverOpen(false);
        }
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [calendarPopoverOpen, timePresetMenuOpen]);

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
      spectrumRequestSeqRef.current += 1;
      setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
      setHoverSpectrumLoading(false);
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
      spectrumRequestSeqRef.current += 1;
      setHoverSpectrumDebouncing(false);
      setSpectrumPinnedTarget(target);
      setHoverTelemetrySnapshot(findNearestTelemetrySnapshot(target.timestampMs));
      setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
      setHoverSpectrumLoading(false);
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
    spectrumRequestSeqRef.current += 1;
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
    spectrumRequestSeqRef.current += 1;
    setHoverSpectrumDebouncing(false);
    setHoverSpectrumLoading(false);
    setHoverSpectrumPoints(null);
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

      setHistoryPresetLoading(preset);
      try {
        await onRequestTelemetryHistory(sensor.id, options);
        setActiveHistoryPreset(preset);
        setSelectedCalendarDate("");
        setCalendarPopoverOpen(false);
        const initialViewWindowMs = getDefaultTrendViewWindowMs(preset, matchedPreset.windowMs);
        setTrendViewWindow({
          startMs: now - initialViewWindowMs,
          endMs: now,
        });
      } finally {
        setHistoryPresetLoading((current) => (current === preset ? null : current));
      }
    },
    [onRequestTelemetryHistory, sensor],
  );

  const loadCalendarMonthAvailability = useCallback(
    async (targetMonth: Date) => {
      if (!sensor) {
        return;
      }
      const monthStart = startOfMonthLocal(targetMonth);
      const monthKey = formatMonthKey(monthStart);
      if (calendarAvailabilityByMonth[monthKey]) {
        return;
      }

      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);
      const timezoneOffsetMinutes = new Date().getTimezoneOffset();
      setCalendarAvailabilityLoadingKey(monthKey);
      setCalendarAvailabilityError("");
      try {
        const query = new URLSearchParams({
          from: monthStart.toISOString(),
          to: monthEnd.toISOString(),
          timezoneOffsetMinutes: String(timezoneOffsetMinutes),
          limitDays: "62",
        });
        const response = await fetch(
          `/api/devices/${encodeURIComponent(sensor.id)}/telemetry-availability?${query.toString()}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(safeString(asRecord(body).error || "telemetry_availability_failed"));
        }
        const days = parseTelemetryAvailabilityPayload(body);
        const nextAvailability: Record<string, number> = {};
        for (const day of days) {
          nextAvailability[day.date] = day.count;
        }
        setCalendarAvailabilityByMonth((current) => ({
          ...current,
          [monthKey]: nextAvailability,
        }));
      } catch (error) {
        setCalendarAvailabilityError(safeString(error));
      } finally {
        setCalendarAvailabilityLoadingKey((current) => (current === monthKey ? null : current));
      }
    },
    [calendarAvailabilityByMonth, sensor],
  );

  const handleCalendarDaySelect = useCallback(
    async (dateValue: string) => {
      if (!dateValue || !sensor || !onRequestTelemetryHistory || controlsBusy) {
        return;
      }
      const localDay = parseDateInputValue(dateValue);
      if (!localDay) {
        return;
      }

      const dayStartMs = localDay.getTime();
      const dayEndExclusiveMs = dayStartMs + DAY_IN_MS;
      const dayEndRequestMs = dayEndExclusiveMs - 1;
      const oneDayPreset = TELEMETRY_HISTORY_PRESETS.find((preset) => preset.key === "1d");
      const defaultPreset = TELEMETRY_HISTORY_PRESETS.find((preset) => preset.key === DEFAULT_HISTORY_PRESET_KEY);

      setTimePresetMenuOpen(false);
      setCalendarLoading(true);
      try {
        await onRequestTelemetryHistory(sensor.id, {
          from: new Date(dayStartMs).toISOString(),
          to: new Date(dayEndRequestMs).toISOString(),
          limit: oneDayPreset?.limit ?? defaultPreset?.limit ?? 1000,
          force: true,
          replace: true,
        });
        setActiveHistoryPreset("1d");
        setSelectedCalendarDate(dateValue);
        setCalendarMonthCursor(startOfMonthLocal(localDay));
        setCalendarPopoverOpen(false);
        setTelemetryWindowAnchorMs(dayEndExclusiveMs);
        setTrendViewWindow({
          startMs: dayStartMs,
          endMs: dayEndExclusiveMs,
        });
      } finally {
        setCalendarLoading(false);
      }
    },
    [controlsBusy, onRequestTelemetryHistory, sensor],
  );

  const handleToggleCalendarPopover = useCallback(() => {
    if (!onRequestTelemetryHistory || controlsBusy) {
      return;
    }
    setTimePresetMenuOpen(false);
    setCalendarAvailabilityError("");
    setCalendarPopoverOpen((open) => {
      const next = !open;
      if (next) {
        const anchor = parseDateInputValue(selectedCalendarDate) ?? new Date(telemetryWindowAnchorMs);
        setCalendarMonthCursor(startOfMonthLocal(anchor));
      }
      return next;
    });
  }, [controlsBusy, onRequestTelemetryHistory, selectedCalendarDate, telemetryWindowAnchorMs]);

  const handleCalendarMonthShift = useCallback((delta: -1 | 1) => {
    setCalendarMonthCursor((current) => addMonthsLocal(current, delta));
    setCalendarAvailabilityError("");
  }, []);

  useEffect(() => {
    if (!calendarPopoverOpen || !sensor) {
      return;
    }
    void loadCalendarMonthAvailability(calendarMonthCursor);
  }, [calendarMonthCursor, calendarPopoverOpen, loadCalendarMonthAvailability, sensor]);

  useEffect(() => {
    if (!calendarPopoverOpen) {
      setCalendarHoverDate(null);
    }
  }, [calendarPopoverOpen]);

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
    const fallbackStepMs = Math.max(1000, Math.round((endMs - startMs) / 240));
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
    const loadedWindowMs = Math.max(1, telemetryWindowAnchorMs - telemetryWindowStartMs);
    const maxAllowedStepMs = Math.max(1000, Math.round(loadedWindowMs * TREND_MAX_GAP_STEP_RATIO));
    const valuedRows = timelineTelemetryData.filter(
      (row) =>
        (typeof row.temp === "number" && Number.isFinite(row.temp))
        || (typeof row.ax === "number" && Number.isFinite(row.ax))
        || (typeof row.ay === "number" && Number.isFinite(row.ay))
        || (typeof row.az === "number" && Number.isFinite(row.az)),
    );

    if (valuedRows.length < 2) {
      return maxAllowedStepMs;
    }

    const diffs: number[] = [];
    for (let index = 1; index < valuedRows.length; index += 1) {
      const diff = valuedRows[index].ts - valuedRows[index - 1].ts;
      if (Number.isFinite(diff) && diff > 0) {
        diffs.push(diff);
      }
    }
    if (diffs.length === 0) {
      return maxAllowedStepMs;
    }
    const sortedDiffs = [...diffs].sort((left, right) => left - right);
    const median = sortedDiffs[Math.floor(sortedDiffs.length / 2)];
    return Math.max(1000, Math.min(maxAllowedStepMs, Math.round(median)));
  }, [telemetryWindowAnchorMs, telemetryWindowStartMs, timelineTelemetryData]);

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
    () => {
      const rawRows = timelineTelemetryData.map((row) => ({
        ts: row.ts,
        ax: row.ax,
        ay: row.ay,
        az: row.az,
        telemetryUuid: row.telemetryUuid,
      }));
      if (accelTrendMode === "instant") {
        return rawRows;
      }
      const rmsWindowMs = Math.min(
        ACCEL_RMS_MAX_WINDOW_MS,
        Math.max(ACCEL_RMS_MIN_WINDOW_MS, telemetryGapStepMs * ACCEL_RMS_TARGET_SAMPLES),
      );
      return buildRollingRmsAccelRows(timelineTelemetryData, rmsWindowMs);
    },
    [accelTrendMode, telemetryGapStepMs, timelineTelemetryData],
  );
  const hoverSpectrumBusy = hoverSpectrumDebouncing || hoverSpectrumLoading;
  const hoverTelemetrySummaryLabel = useMemo(() => {
    if (!hoverTelemetrySnapshot) {
      return "";
    }
    return `Mốc: ${formatTooltipDateTime(hoverTelemetrySnapshot.ts)} · Temp ${formatOptionalValue(
      hoverTelemetrySnapshot.temp,
      2,
      "°C",
    )} · ${VIBRATION_AXIS_LABELS.ax} ${formatOptionalValue(
      hoverTelemetrySnapshot.ax,
      2,
    )} · ${VIBRATION_AXIS_LABELS.ay} ${formatOptionalValue(
      hoverTelemetrySnapshot.ay,
      2,
    )} · ${VIBRATION_AXIS_LABELS.az} ${formatOptionalValue(hoverTelemetrySnapshot.az, 2)} m/s²`;
  }, [hoverTelemetrySnapshot]);
  const spectrumPinned = spectrumPinnedTarget !== null;
  const shouldUseHoverSpectrumState =
    hoverSpectrumBusy || spectrumPinned || hoverTelemetrySnapshot !== null || hoverSpectrumPoints !== null;
  const activeSpectrumPoints = shouldUseHoverSpectrumState
    ? (hoverSpectrumPoints ?? EMPTY_SPECTRUM_POINTS)
    : spectrumPoints;

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
  const loadedTrendWindowMs = useMemo(
    () => Math.max(1, telemetryWindowAnchorMs - telemetryWindowStartMs),
    [telemetryWindowAnchorMs, telemetryWindowStartMs],
  );
  const trendMinViewWindowMs = useMemo(
    () => Math.min(loadedTrendWindowMs, Math.max(TREND_MIN_VIEW_WINDOW_MS, telemetryGapStepMs * 8)),
    [loadedTrendWindowMs, telemetryGapStepMs],
  );
  const trendVisibleWindow = useMemo(() => {
    const fallbackViewWindowMs = getDefaultTrendViewWindowMs(
      activePresetConfig?.key ?? DEFAULT_HISTORY_PRESET_KEY,
      loadedTrendWindowMs,
    );
    const requestedWindow = trendViewWindow ?? {
      startMs: telemetryWindowAnchorMs - fallbackViewWindowMs,
      endMs: telemetryWindowAnchorMs,
    };
    return clampTrendViewport(
      requestedWindow,
      telemetryWindowStartMs,
      telemetryWindowAnchorMs,
      trendMinViewWindowMs,
    );
  }, [
    activePresetConfig?.key,
    loadedTrendWindowMs,
    telemetryWindowAnchorMs,
    telemetryWindowStartMs,
    trendMinViewWindowMs,
    trendViewWindow,
  ]);
  const trendAtLatest = Math.abs(telemetryWindowAnchorMs - trendVisibleWindow.endMs) <= Math.max(
    TREND_LATEST_EPSILON_MS,
    telemetryGapStepMs * 2,
  );
  const trendCanPanOlder = trendVisibleWindow.startMs > telemetryWindowStartMs + Math.max(1_000, telemetryGapStepMs);
  const trendCanPanNewer = trendVisibleWindow.endMs < telemetryWindowAnchorMs - Math.max(1_000, telemetryGapStepMs);

  const handleResetTrendViewToLatest = useCallback(() => {
    const nextDurationMs = Math.max(
      trendMinViewWindowMs,
      Math.min(loadedTrendWindowMs, trendVisibleWindow.endMs - trendVisibleWindow.startMs),
    );
    setTrendViewWindow({
      startMs: telemetryWindowAnchorMs - nextDurationMs,
      endMs: telemetryWindowAnchorMs,
    });
  }, [
    loadedTrendWindowMs,
    telemetryWindowAnchorMs,
    trendMinViewWindowMs,
    trendVisibleWindow.endMs,
    trendVisibleWindow.startMs,
  ]);

  const handleTrendViewportZoom = useCallback(
    ({ anchorTs, deltaY }: { anchorTs: number; deltaY: number }) => {
      const currentDurationMs = Math.max(1, trendVisibleWindow.endMs - trendVisibleWindow.startMs);
      const zoomOut = deltaY > 0;
      const nextDurationMs = Math.max(
        trendMinViewWindowMs,
        Math.min(
          loadedTrendWindowMs,
          currentDurationMs * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP),
        ),
      );
      if (Math.abs(nextDurationMs - currentDurationMs) < 1) {
        return;
      }

      const safeAnchorTs = Math.max(
        trendVisibleWindow.startMs,
        Math.min(trendVisibleWindow.endMs, anchorTs),
      );
      const anchorRatio =
        currentDurationMs > 0
          ? (safeAnchorTs - trendVisibleWindow.startMs) / currentDurationMs
          : 0.5;
      const proposedStartMs = safeAnchorTs - anchorRatio * nextDurationMs;
      const nextWindow = clampTrendViewport(
        {
          startMs: proposedStartMs,
          endMs: proposedStartMs + nextDurationMs,
        },
        telemetryWindowStartMs,
        telemetryWindowAnchorMs,
        trendMinViewWindowMs,
      );
      if (
        nextWindow.startMs === trendVisibleWindow.startMs
        && nextWindow.endMs === trendVisibleWindow.endMs
      ) {
        return;
      }
      startTransition(() => {
        setTrendViewWindow(nextWindow);
      });
    },
    [
      loadedTrendWindowMs,
      telemetryWindowAnchorMs,
      telemetryWindowStartMs,
      trendMinViewWindowMs,
      trendVisibleWindow.endMs,
      trendVisibleWindow.startMs,
    ],
  );

  const handleTempYAxisZoom = useCallback(({ deltaY }: { deltaY: number }) => {
    const zoomOut = deltaY > 0;
    setTempHalfSpan((current) => clampTempHalfSpan(current * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP)));
  }, []);

  const handleAccelYAxisZoom = useCallback(({ deltaY }: { deltaY: number }) => {
    const zoomOut = deltaY > 0;
    setAccelAmplitudeLimit((current) => clampAccelAmplitudeLimit(current * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP)));
  }, []);

  const handleTrendViewportPanChange = useCallback(
    (nextWindow: TrendViewport) => {
      const clampedWindow = clampTrendViewport(
        nextWindow,
        telemetryWindowStartMs,
        telemetryWindowAnchorMs,
        trendMinViewWindowMs,
      );
      if (
        clampedWindow.startMs === trendVisibleWindow.startMs
        && clampedWindow.endMs === trendVisibleWindow.endMs
      ) {
        return;
      }
      startTransition(() => {
        setTrendViewWindow(clampedWindow);
      });
    },
    [
      telemetryWindowAnchorMs,
      telemetryWindowStartMs,
      trendMinViewWindowMs,
      trendVisibleWindow.endMs,
      trendVisibleWindow.startMs,
    ],
  );

  const handleTrendPanStateChange = useCallback((active: boolean) => {
    setTrendPanning(active);
  }, []);

  const tempVisible = useMemo(
    () =>
      tempData.filter(
        (row) => row.ts >= trendVisibleWindow.startMs && row.ts <= trendVisibleWindow.endMs,
      ),
    [tempData, trendVisibleWindow.endMs, trendVisibleWindow.startMs],
  );
  const tempGapRangesAll = useMemo(() => {
    return buildNullGapRanges(
      tempData,
      (row) => typeof row.temp === "number" && Number.isFinite(row.temp),
      (row) => row.ts,
      telemetryGapStepMs,
    );
  }, [telemetryGapStepMs, tempData]);
  const tempGapRanges = useMemo(
    () => clipGapRangesToWindow(tempGapRangesAll, trendVisibleWindow.startMs, trendVisibleWindow.endMs),
    [tempGapRangesAll, trendVisibleWindow.endMs, trendVisibleWindow.startMs],
  );
  const tempDisplayData = tempVisible;
  const accelVisible = useMemo(
    () =>
      accelData.filter(
        (row) => row.ts >= trendVisibleWindow.startMs && row.ts <= trendVisibleWindow.endMs,
      ),
    [accelData, trendVisibleWindow.endMs, trendVisibleWindow.startMs],
  );
  const accelGapRangesAll = useMemo(() => {
    return buildNullGapRanges(
      accelData,
      (row) =>
        (typeof row.ax === "number" && Number.isFinite(row.ax))
        || (typeof row.ay === "number" && Number.isFinite(row.ay))
        || (typeof row.az === "number" && Number.isFinite(row.az)),
      (row) => row.ts,
      telemetryGapStepMs,
    );
  }, [accelData, telemetryGapStepMs]);
  const accelGapRanges = useMemo(
    () => clipGapRangesToWindow(accelGapRangesAll, trendVisibleWindow.startMs, trendVisibleWindow.endMs),
    [accelGapRangesAll, trendVisibleWindow.endMs, trendVisibleWindow.startMs],
  );
  const accelDisplayData = accelVisible;
  const accelTrendYDomain = useMemo<[number, number]>(() => {
    if (accelTrendMode !== "rms") {
      return [-accelAmplitudeLimit, accelAmplitudeLimit];
    }

    const values = accelVisible
      .flatMap((row) => [row.ax, row.ay, row.az])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    if (values.length === 0) {
      return [0, Math.min(accelAmplitudeLimit, 1)];
    }

    const maxValue = Math.max(...values);
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
      return [0, Math.min(accelAmplitudeLimit, 1)];
    }

    const padded = maxValue * 1.25;
    const rounded = padded < 1
      ? Math.ceil(padded * 100) / 100
      : padded < 10
        ? Math.ceil(padded * 10) / 10
        : Math.ceil(padded);
    return [0, Math.min(accelAmplitudeLimit, Math.max(0.1, rounded))];
  }, [accelAmplitudeLimit, accelTrendMode, accelVisible]);
  const showInitialLoading = telemetryLoading && telemetryPoints.length === 0;
  const trendOverviewGapRanges = useMemo(() => {
    return buildNullGapRanges(
      timelineTelemetryData,
      (row) =>
        (typeof row.temp === "number" && Number.isFinite(row.temp))
        || (typeof row.ax === "number" && Number.isFinite(row.ax))
        || (typeof row.ay === "number" && Number.isFinite(row.ay))
        || (typeof row.az === "number" && Number.isFinite(row.az)),
      (row) => row.ts,
      telemetryGapStepMs,
    );
  }, [telemetryGapStepMs, timelineTelemetryData]);
  const trendOverviewResetKey = useMemo(
    () =>
      `${sensor?.id ?? "no-sensor"}:${activeHistoryPreset ?? "none"}:${Math.round(telemetryWindowStartMs / 1000)}:${Math.round(telemetryWindowAnchorMs / 1000)}`,
    [activeHistoryPreset, sensor?.id, telemetryWindowAnchorMs, telemetryWindowStartMs],
  );
  const trendOverviewDisplayWindow = useMemo(() => {
    return clampTrendViewport(
      {
        startMs: trendVisibleWindow.startMs,
        endMs: trendVisibleWindow.endMs,
      },
      telemetryWindowStartMs,
      telemetryWindowAnchorMs,
      trendMinViewWindowMs,
    );
  }, [
    telemetryWindowAnchorMs,
    telemetryWindowStartMs,
    trendMinViewWindowMs,
    trendVisibleWindow.endMs,
    trendVisibleWindow.startMs,
  ]);
  const activePresetLabel = activePresetConfig?.label ?? DEFAULT_HISTORY_PRESET_KEY;

  useEffect(() => {
    if (!sensor) {
      autoPresetLoadedSensorIdRef.current = null;
      return;
    }
    setTelemetryWindowAnchorMs(Date.now());
    setTempHalfSpan(5);
    setAccelAmplitudeLimit(ACCEL_LIMIT_MS2);
    setAccelTrendMode("instant");
    setTrendViewWindow(null);
    setTrendPanning(false);
    setActiveHistoryPreset(DEFAULT_HISTORY_PRESET_KEY);
    setSelectedCalendarDate("");
    setCalendarPopoverOpen(false);
    setCalendarHoverDate(null);
    setCalendarMonthCursor(startOfMonthLocal(new Date()));
    setCalendarAvailabilityByMonth({});
    setCalendarAvailabilityLoadingKey(null);
    setCalendarAvailabilityError("");
    setHistoryPresetLoading(null);
    setCalendarLoading(false);
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

  if (!sensor) return null;

  const chartTextStyle = { fill: C.textMuted, fontSize: 10 };
  const gridColor = C.border + "44";

  return (
    <>
      <div onClick={handleClose} style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        opacity: visible ? 1 : 0, transition: `opacity ${CHART_MODAL_TRANSITION_MS}ms ease`,
      }} />

      <div
        data-ux="chart-modal"
        data-ux-chart-ready={showInitialLoading ? "false" : "true"}
        data-ux-telemetry-points={telemetryPoints.length}
        style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 61,
        transform: visible ? "translate(-50%,-50%) scale(1)" : "translate(-50%,-49%) scale(0.97)",
        opacity: visible ? 1 : 0,
        transition: `transform ${CHART_MODAL_TRANSITION_MS}ms cubic-bezier(0.32,0.72,0,1), opacity ${CHART_MODAL_TRANSITION_MS}ms ease`,
        width: modalLayout.modalWidth,
        height: "auto",
        maxWidth: "1500px",
        maxHeight: modalLayout.modalMaxHeight,
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
      >
        {/* Header */}
        <div style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: modalLayout.headerPadding,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          flexShrink: 0,
        }}>
	          <div style={{ minWidth: 0 }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
            <div ref={calendarPopoverRef} style={{ position: "relative" }}>
              <button
                type="button"
                disabled={!onRequestTelemetryHistory || controlsBusy}
                onClick={handleToggleCalendarPopover}
                style={{
                  height: 32,
                  borderRadius: 999,
                  border: `1px solid ${calendarPopoverOpen ? C.primary : C.border}`,
                  padding: "0 10px",
                  background: calendarPopoverOpen ? C.primaryBg : C.surface,
                  color: calendarPopoverOpen ? C.primary : C.textBase,
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  cursor: !onRequestTelemetryHistory || controlsBusy ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 128,
                  justifyContent: "space-between",
                  opacity: !onRequestTelemetryHistory || controlsBusy ? 0.68 : 1,
                  transition: "all 0.14s ease",
                }}
                title="Chọn ngày dữ liệu"
                aria-label="Chọn ngày dữ liệu"
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <CalendarDays size={13} strokeWidth={2.1} />
                  <span>{selectedCalendarDateLabel}</span>
                </span>
                <ChevronDown
                  size={13}
                  strokeWidth={2.2}
                  style={{
                    transform: calendarPopoverOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.14s ease",
                  }}
                />
              </button>

              {calendarPopoverOpen ? (
                <div
                  className="calendar-popover-anim"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    width: 296,
                    borderRadius: 14,
                    border: `1px solid ${C.border}`,
                    background: `linear-gradient(180deg, ${C.surface} 0%, ${C.card} 100%)`,
                    boxShadow: "0 18px 36px rgba(0, 0, 0, 0.35)",
                    padding: "10px 10px 9px",
                    zIndex: 42,
                    display: "grid",
                    gap: 8,
                    transformOrigin: "top right",
                    animation: "calendarPopoverIn 190ms cubic-bezier(0.2, 0.85, 0.25, 1)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleCalendarMonthShift(-1)}
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
                        cursor: "pointer",
                      }}
                    >
                      <ArrowLeft size={13} strokeWidth={2.4} />
                    </button>
                    <div style={{ minWidth: 0, textAlign: "center" }}>
                      <div style={{ color: C.textBright, fontSize: "0.73rem", fontWeight: 800, letterSpacing: "0.01em" }}>
                        {calendarMonthLabel}
                      </div>
                      <div style={{ color: C.textMuted, fontSize: "0.62rem" }}>
                        {calendarDaysWithDataCount > 0
                          ? `${calendarDaysWithDataCount} ngày có dữ liệu`
                          : "Chưa có dữ liệu trong tháng"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCalendarMonthShift(1)}
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
                        cursor: "pointer",
                      }}
                    >
                      <ArrowRight size={13} strokeWidth={2.4} />
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                      gap: 4,
                      padding: "0 2px",
                    }}
                  >
                    {CALENDAR_WEEKDAY_LABELS.map((label) => (
                      <div
                        key={label}
                        style={{
                          textAlign: "center",
                          color: C.textMuted,
                          fontSize: "0.58rem",
                          fontWeight: 700,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                        }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>

                  <div
                    key={calendarMonthKey}
                    className="calendar-month-anim"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                      gap: 4,
                      animation: "calendarMonthIn 180ms ease-out",
                    }}
                  >
                    {calendarDayCells.map((cell) => {
                      const hasData = Number(calendarMonthAvailability[cell.dateValue] ?? 0) > 0;
                      const selected = selectedCalendarDate === cell.dateValue;
                      const inCurrentMonth = cell.monthOffset === 0;
                      const disabled = cell.isFuture || controlsBusy;
                      const hovered = calendarHoverDate === cell.dateValue && !disabled;
                      return (
                        <button
                          key={cell.dateValue}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            void handleCalendarDaySelect(cell.dateValue);
                          }}
                          onMouseEnter={() => {
                            if (!disabled) {
                              setCalendarHoverDate(cell.dateValue);
                            }
                          }}
                          onMouseLeave={() => {
                            setCalendarHoverDate(null);
                          }}
                          onFocus={() => {
                            if (!disabled) {
                              setCalendarHoverDate(cell.dateValue);
                            }
                          }}
                          onBlur={() => {
                            setCalendarHoverDate(null);
                          }}
                          style={{
                            position: "relative",
                            height: 34,
                            borderRadius: 10,
                            border: selected
                              ? `1px solid ${C.primary}`
                              : hovered
                                ? `1px solid ${C.primary}`
                              : hasData
                                ? `1px solid ${C.success}66`
                                : `1px solid ${C.border}`,
                            background: selected
                              ? C.primaryBg
                              : hovered
                                ? "rgba(59, 130, 246, 0.18)"
                              : hasData
                                ? `${C.success}14`
                                : inCurrentMonth
                                  ? C.surface
                                  : `${C.surface}99`,
                            color: selected
                              ? C.primary
                              : hovered
                                ? C.primary
                              : inCurrentMonth
                                ? C.textBase
                                : C.textDim,
                            fontSize: "0.68rem",
                            fontWeight: selected || hovered ? 800 : 700,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: disabled ? "not-allowed" : "pointer",
                            opacity: disabled ? 0.45 : inCurrentMonth ? 1 : 0.72,
                            transform: hovered ? "translateY(-1px) scale(1.06)" : "translateY(0) scale(1)",
                            boxShadow: hovered ? `0 10px 18px ${C.primary}33` : "none",
                            zIndex: hovered ? 2 : 1,
                            transition: "transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.16s ease, background 0.16s ease, border-color 0.16s ease, color 0.16s ease, opacity 0.16s ease",
                          }}
                          title={hasData ? `${cell.dateValue}: có dữ liệu` : `${cell.dateValue}: chưa có dữ liệu`}
                        >
                          {cell.dayNumber}
                          {hasData ? (
                            <span
                              className="calendar-dot-anim"
                              style={{
                                position: "absolute",
                                bottom: 5,
                                width: 5,
                                height: 5,
                                borderRadius: "50%",
                                background: selected ? C.primary : C.success,
                                boxShadow: selected ? "none" : `0 0 6px ${C.success}AA`,
                                transform: hovered ? "scale(1.25)" : "scale(1)",
                                animation: "calendarDataDotPulse 2.2s ease-in-out infinite",
                              }}
                            />
                          ) : null}
                          {cell.isToday && !selected ? (
                            <span
                              style={{
                                position: "absolute",
                                inset: 2,
                                borderRadius: 8,
                                border: `1px dashed ${C.primary}66`,
                                pointerEvents: "none",
                              }}
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "2px 2px 0",
                      minHeight: 18,
                    }}
                  >
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: "0.6rem" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.success, display: "inline-block" }} />
                      Có dữ liệu
                    </div>
                    <div style={{ color: C.textMuted, fontSize: "0.6rem" }}>
                      {calendarMonthLoading
                        ? "Đang tải ngày dữ liệu..."
                        : calendarAvailabilityError
                          ? "Không tải được ngày dữ liệu"
                          : ""}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div ref={timePresetMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                disabled={!onRequestTelemetryHistory || controlsBusy}
                onClick={() => {
                  setTimePresetMenuOpen((open) => !open);
                }}
                style={{
                  height: 32,
                  borderRadius: 999,
                  border: `1px solid ${C.border}`,
                  padding: "0 10px",
                  background: C.surface,
                  color: C.textBase,
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  cursor: !onRequestTelemetryHistory || controlsBusy ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  minWidth: 120,
                  justifyContent: "space-between",
                  opacity: !onRequestTelemetryHistory || controlsBusy ? 0.68 : 1,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Clock3 size={13} strokeWidth={2.1} />
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
                    right: 0,
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
                        disabled={controlsBusy}
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
                          cursor: controlsBusy ? "not-allowed" : "pointer",
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

            <button
              type="button"
              disabled={trendAtLatest}
              onClick={handleResetTrendViewToLatest}
              style={{
                height: 32,
                borderRadius: 999,
                border: `1px solid ${trendAtLatest ? C.border : C.primary}`,
                padding: "0 12px",
                background: trendAtLatest ? C.surface : C.primaryBg,
                color: trendAtLatest ? C.textMuted : C.primary,
                fontSize: "0.66rem",
                fontWeight: 700,
                cursor: trendAtLatest ? "default" : "pointer",
                opacity: trendAtLatest ? 0.7 : 1,
              }}
            >
              Mới nhất
            </button>

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
        <div
          data-ux="chart-modal-scroll"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            padding: modalLayout.contentPadding,
            overscrollBehavior: "contain",
            scrollbarGutter: "stable",
          }}
        >
          <style>{`
            @keyframes chartSpin { to { transform: rotate(360deg); } }
            @keyframes calendarPopoverIn {
              from {
                opacity: 0;
                transform: translateY(-7px) scale(0.975);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
            @keyframes calendarMonthIn {
              from {
                opacity: 0;
                transform: translateY(4px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @keyframes calendarDataDotPulse {
              0%,
              100% {
                transform: scale(1);
                opacity: 0.9;
              }
              50% {
                transform: scale(1.2);
                opacity: 1;
              }
            }
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
            @media (prefers-reduced-motion: reduce) {
              .calendar-popover-anim,
              .calendar-month-anim,
              .calendar-dot-anim,
              .data-settings-modal-backdrop,
              .data-settings-modal-card,
              .data-clear-confirm-backdrop,
              .data-clear-confirm-card {
                animation: none !important;
              }
            }
          `}</style>

          {/* Top row: Temperature + Acceleration */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: modalLayout.topGridColumns,
              gap: modalLayout.topGridGap,
              marginBottom: modalLayout.sectionGap,
            }}
          >
            <ChartSection
              title="Xu hướng nhiệt độ (°C)"
              icon={<Thermometer size={13} strokeWidth={2} />}
              C={C}
              titleGap={modalLayout.chartTitleGap}
              cardPadding={modalLayout.chartCardPadding}
            >
              {showInitialLoading ? (
                <div style={{ height: modalLayout.chartHeight, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: C.textMuted, fontSize: "0.74rem" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                  <div>Đang tải dữ liệu lịch sử...</div>
                </div>
              ) : (
                <div onContextMenu={handleTelemetryChartUnpin}>
                  <TelemetryTrendChart
                    data={tempDisplayData}
                    hoverPoints={tempDisplayData.map((point) => ({ ts: point.ts, telemetryUuid: point.telemetryUuid }))}
                    series={[
                      {
                        key: "temp",
                        name: "Nhiệt độ",
                        color: C.primary,
                        strokeWidth: 2,
                        latestLabelFormatter: (value) => `${value.toFixed(2)}°C`,
                      },
                    ]}
                    gapSegmentsBySeries={{ temp: tempGapRanges }}
                    timeDomain={[trendVisibleWindow.startMs, trendVisibleWindow.endMs]}
                    yDomain={tempDomain}
                    pinnedTarget={spectrumPinnedTarget}
                    gridColor={gridColor}
                    axisLabelColor={chartTextStyle.fill}
                    C={C}
                    height={modalLayout.chartHeight}
                    showLegend
                    panActive={trendPanning}
                    canPanOlder={trendCanPanOlder}
                    canPanNewer={trendCanPanNewer}
                    onHoverTarget={handleTelemetryChartHover}
                    onPinTarget={handleTelemetryChartPin}
                    onViewportZoom={handleTrendViewportZoom}
                    onYAxisZoom={handleTempYAxisZoom}
                    onViewportPanChange={handleTrendViewportPanChange}
                    onViewportPanStateChange={handleTrendPanStateChange}
                    onLeave={handleTelemetryChartLeave}
                  />
                </div>
              )}
            </ChartSection>

            <ChartSection
              title="Xu hướng gia tốc (m/s²)"
              icon={<Activity size={13} strokeWidth={2} />}
              C={C}
              titleGap={modalLayout.chartTitleGap}
              cardPadding={modalLayout.chartCardPadding}
              headerAction={
                <div
                  role="group"
                  aria-label="Chế độ giá trị gia tốc"
                  style={{
                    display: "inline-grid",
                    gridTemplateColumns: "repeat(2, 70px)",
                    height: 26,
                    padding: 2,
                    borderRadius: 999,
                    border: `1px solid ${C.border}`,
                    background: C.surface,
                  }}
                >
                  {(["instant", "rms"] as const).map((mode) => {
                    const active = accelTrendMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAccelTrendMode(mode)}
                        aria-pressed={active}
                        title={mode === "instant" ? "Giá trị tức thời" : "Giá trị RMS"}
                        style={{
                          border: "none",
                          borderRadius: 999,
                          background: active ? C.primaryBg : "transparent",
                          color: active ? C.primary : C.textMuted,
                          fontSize: "0.62rem",
                          fontWeight: 800,
                          cursor: "pointer",
                          minWidth: 0,
                          transition: "background 0.14s ease, color 0.14s ease",
                        }}
                      >
                        {mode === "instant" ? "Tức thời" : "RMS"}
                      </button>
                    );
                  })}
                </div>
              }
            >
              {showInitialLoading ? (
                <div style={{ height: modalLayout.chartHeight, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: C.textMuted, fontSize: "0.74rem" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                  <div>Đang tải dữ liệu lịch sử...</div>
                </div>
              ) : (
                <div onContextMenu={handleTelemetryChartUnpin}>
                  <TelemetryTrendChart
                    data={accelDisplayData}
                    hoverPoints={accelDisplayData.map((point) => ({ ts: point.ts, telemetryUuid: point.telemetryUuid }))}
                    series={[
                      { key: "ax", name: accelTrendMode === "rms" ? `${VIBRATION_AXIS_LABELS.ax} RMS` : VIBRATION_AXIS_LABELS.ax, color: "#f87171", strokeWidth: 1.8 },
                      { key: "ay", name: accelTrendMode === "rms" ? `${VIBRATION_AXIS_LABELS.ay} RMS` : VIBRATION_AXIS_LABELS.ay, color: "#60a5fa", strokeWidth: 1.8 },
                      { key: "az", name: accelTrendMode === "rms" ? `${VIBRATION_AXIS_LABELS.az} RMS` : VIBRATION_AXIS_LABELS.az, color: "#a78bfa", strokeWidth: 1.8 },
                    ]}
                    gapSegmentsBySeries={{
                      ax: accelGapRanges,
                      ay: accelGapRanges,
                      az: accelGapRanges,
                    }}
                    timeDomain={[trendVisibleWindow.startMs, trendVisibleWindow.endMs]}
                    yDomain={accelTrendYDomain}
                    pinnedTarget={spectrumPinnedTarget}
                    gridColor={gridColor}
                    axisLabelColor={chartTextStyle.fill}
                    C={C}
                    height={modalLayout.chartHeight}
                    showLegend
                    panActive={trendPanning}
                    canPanOlder={trendCanPanOlder}
                    canPanNewer={trendCanPanNewer}
                    onHoverTarget={handleTelemetryChartHover}
                    onPinTarget={handleTelemetryChartPin}
                    onViewportZoom={handleTrendViewportZoom}
                    onYAxisZoom={accelTrendMode === "instant" ? handleAccelYAxisZoom : undefined}
                    onViewportPanChange={handleTrendViewportPanChange}
                    onViewportPanStateChange={handleTrendPanStateChange}
                    onLeave={handleTelemetryChartLeave}
                  />
                </div>
              )}
            </ChartSection>
          </div>

          {!showInitialLoading ? (
            <div style={{ marginBottom: modalLayout.sectionGap }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: modalLayout.chartTitleGap, flexWrap: "wrap" }}>
                <span style={{ color: C.primary }}><Clock3 size={13} strokeWidth={2} /></span>
                <span style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 700 }}>Toàn cảnh dữ liệu đã tải</span>
                <span style={{ color: C.textMuted, fontSize: "0.66rem" }}>
                  {`${activePresetLabel} · kéo hoặc resize để đổi vùng đang xem`}
                </span>
              </div>
              <div
                style={{
                  background: C.card,
                  border: `1px solid ${C.cardBorder}`,
                  borderRadius: 10,
                  padding: modalLayout.overviewCardPadding,
                }}
              >
                <TrendOverviewBrush
                  rows={timelineTelemetryData}
                  gapSegments={trendOverviewGapRanges}
                  selectedStartTs={trendOverviewDisplayWindow.startMs}
                  selectedEndTs={trendOverviewDisplayWindow.endMs}
                  resetKey={trendOverviewResetKey}
                  axisLabelColor={chartTextStyle.fill}
                  C={C}
                  height={modalLayout.overviewHeight}
                  minWindowMs={trendMinViewWindowMs}
                  onRangeCommit={(startTs, endTs) => {
                    handleTrendViewportPanChange({ startMs: startTs, endMs: endTs });
                  }}
                />
              </div>
            </div>
          ) : null}

	          {/* Bottom row: FFT axes in one row */}
	          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: modalLayout.fftHeaderGap,
                minHeight: 18,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                <span style={{ color: C.primary }}><BarChart3 size={13} strokeWidth={2} /></span>
                <span style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 700 }}>Phổ tần số FFT</span>
                <span style={{ color: C.textMuted, fontSize: "0.68rem" }}>
                  ({VIBRATION_AXIS_LABELS.ax} / {VIBRATION_AXIS_LABELS.ay} / {VIBRATION_AXIS_LABELS.az})
                </span>
              </div>
              {hoverTelemetrySnapshot ? (
                <span
                  style={{
                    maxWidth: "48%",
                    color: C.textMuted,
                    fontSize: "0.62rem",
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: 999,
                    border: `1px solid ${C.border}`,
                    background: C.card,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    pointerEvents: "none",
                    flexShrink: 1,
                  }}
                >
                  {hoverTelemetrySummaryLabel || "Mốc: --"}
                </span>
              ) : null}
            </div>

            <div style={{ position: "relative" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: modalLayout.spectrumGridColumns,
                  gap: modalLayout.fftGridGap,
                }}
              >

                {/* FFT ngang */}
                <div style={{
                  position: "relative",
                  background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                  padding: modalLayout.fftCardPadding,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4, padding: "0 4px", minHeight: 18 }}>
                    <div style={{ color: "#f87171", fontSize: "0.68rem", fontWeight: 700 }}>
                      ■ {VIBRATION_AXIS_LABELS.ax}
                    </div>
                    <div
                      style={{
                        color: C.textMuted,
                        fontSize: "0.62rem",
                        fontWeight: 600,
                        minWidth: 0,
                        maxWidth: "72%",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {hoverSpectrumBusy
                        ? SPECTRUM_LOADING_LABEL
                        : formatPeakSummary(
                            spectrumPeakByAxis.x.frequencyHz,
                            spectrumPeakByAxis.x.amplitude,
                            spectrumUnitByAxis.x,
                          )}
                    </div>
                  </div>
                  <div style={{ position: "relative" }}>
                    <SpectrumZoomChart
                      data={fftRenderX}
                      color="#f87171"
                      axisLabelColor={chartTextStyle.fill}
                      gridColor={gridColor}
                      maxHz={spectrumMaxHzByAxis.x}
                      yMax={spectrumFixedYMax}
                      C={C}
                      height={modalLayout.spectrumHeight}
                    />
                    {hoverSpectrumBusy ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 8,
                          overflow: "hidden",
                          pointerEvents: "none",
                        }}
                      >
                        <SpectrumLoadingState C={C} accentColor="#f87171" overlay />
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      color: C.textMuted,
                      fontSize: "0.58rem",
                      paddingRight: 6,
                      marginTop: -2,
                      minHeight: modalLayout.fftAxisFooterHeight,
                      lineHeight: `${modalLayout.fftAxisFooterHeight}px`,
                      visibility: hoverSpectrumBusy ? "hidden" : "visible",
                    }}
                  >
                    Hz
                  </div>
                </div>

                {/* FFT đứng */}
                <div style={{
                  position: "relative",
                  background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                  padding: modalLayout.fftCardPadding,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4, padding: "0 4px", minHeight: 18 }}>
                    <div style={{ color: "#60a5fa", fontSize: "0.68rem", fontWeight: 700 }}>
                      ■ {VIBRATION_AXIS_LABELS.ay}
                    </div>
                    <div
                      style={{
                        color: C.textMuted,
                        fontSize: "0.62rem",
                        fontWeight: 600,
                        minWidth: 0,
                        maxWidth: "72%",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {hoverSpectrumBusy
                        ? SPECTRUM_LOADING_LABEL
                        : formatPeakSummary(
                            spectrumPeakByAxis.y.frequencyHz,
                            spectrumPeakByAxis.y.amplitude,
                            spectrumUnitByAxis.y,
                          )}
                    </div>
                  </div>
                  <div style={{ position: "relative" }}>
                    <SpectrumZoomChart
                      data={fftRenderY}
                      color="#60a5fa"
                      axisLabelColor={chartTextStyle.fill}
                      gridColor={gridColor}
                      maxHz={spectrumMaxHzByAxis.y}
                      yMax={spectrumFixedYMax}
                      C={C}
                      height={modalLayout.spectrumHeight}
                    />
                    {hoverSpectrumBusy ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 8,
                          overflow: "hidden",
                          pointerEvents: "none",
                        }}
                      >
                        <SpectrumLoadingState C={C} accentColor="#60a5fa" overlay />
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      color: C.textMuted,
                      fontSize: "0.58rem",
                      paddingRight: 6,
                      marginTop: -2,
                      minHeight: modalLayout.fftAxisFooterHeight,
                      lineHeight: `${modalLayout.fftAxisFooterHeight}px`,
                      visibility: hoverSpectrumBusy ? "hidden" : "visible",
                    }}
                  >
                    Hz
                  </div>
                </div>

                {/* FFT dọc trục */}
                <div style={{
                  position: "relative",
                  background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 10,
                  padding: modalLayout.fftCardPadding,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4, padding: "0 4px", minHeight: 18 }}>
                    <div style={{ color: "#a78bfa", fontSize: "0.68rem", fontWeight: 700 }}>
                      ■ {VIBRATION_AXIS_LABELS.az}
                    </div>
                    <div
                      style={{
                        color: C.textMuted,
                        fontSize: "0.62rem",
                        fontWeight: 600,
                        minWidth: 0,
                        maxWidth: "72%",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {hoverSpectrumBusy
                        ? SPECTRUM_LOADING_LABEL
                        : formatPeakSummary(
                            spectrumPeakByAxis.z.frequencyHz,
                            spectrumPeakByAxis.z.amplitude,
                            spectrumUnitByAxis.z,
                          )}
                    </div>
                  </div>
                  <div style={{ position: "relative" }}>
                    <SpectrumZoomChart
                      data={fftRenderZ}
                      color="#a78bfa"
                      axisLabelColor={chartTextStyle.fill}
                      gridColor={gridColor}
                      maxHz={spectrumMaxHzByAxis.z}
                      yMax={spectrumFixedYMax}
                      C={C}
                      height={modalLayout.spectrumHeight}
                    />
                    {hoverSpectrumBusy ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 8,
                          overflow: "hidden",
                          pointerEvents: "none",
                        }}
                      >
                        <SpectrumLoadingState C={C} accentColor="#a78bfa" overlay />
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      color: C.textMuted,
                      fontSize: "0.58rem",
                      paddingRight: 6,
                      marginTop: -2,
                      minHeight: modalLayout.fftAxisFooterHeight,
                      lineHeight: `${modalLayout.fftAxisFooterHeight}px`,
                      visibility: hoverSpectrumBusy ? "hidden" : "visible",
                    }}
                  >
                    Hz
                  </div>
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
