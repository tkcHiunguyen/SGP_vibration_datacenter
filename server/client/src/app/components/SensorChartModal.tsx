import React, { startTransition, useState, useMemo, useRef, useEffect, useCallback, useId } from "react";
import { X, Thermometer, BarChart3, Activity, Trash2, Settings, Clock3, CalendarDays, ChevronDown, ArrowLeft, ArrowRight, Box, Play, Square, Minus, Plus, PencilLine, RotateCcw, PanelRightClose } from "lucide-react";
import type { DeviceAxisKey, DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor, SpectrumAxis } from "../data/sensors";
import { parseTelemetryHistoryPayload } from "../data/telemetry-history";
import { useTheme } from "../context/ThemeContext";
import { useDisplayMode } from "../context/DisplayModeContext";
import {
  DETAIL_TILE_FETCH_DEBOUNCE_MS,
  buildTelemetryDetailTileRequests,
  getTelemetryDetailMode,
  type TelemetryDetailMode,
  type TelemetryDetailTileRequest,
} from "./sensor-chart-modal/telemetry-tiles";
import type { ToastItem } from "./ui";
import { ConsoleButton, FormFieldShell, FormInput, Modal } from "./ui";
import type { PlacementAxisSceneMatch } from "./MotorSceneCanvas";
import {
  CALENDAR_WEEKDAY_LABELS,
  CHART_MODAL_EXPANDED_CHART_PX,
  CHART_MODAL_TRANSITION_MS,
  CLEAR_DATA_CONFIRM_MODAL_CLOSE_MS,
  ChartSection,
  DATA_SETTINGS_MODAL_CLOSE_MS,
  DATA_SETTINGS_SUMMARY_CACHE_TTL_MS,
  DATA_SETTINGS_SUMMARY_FETCH_DELAY_MS,
  DAY_IN_MS,
  DEFAULT_HISTORY_PRESET_KEY,
  FFT_AXIS_DISPLAY_ORDER,
  DEFAULT_SPECTRUM_SAMPLE_RATE_HZ,
  DEFAULT_SPECTRUM_SOURCE_SAMPLES,
  EMPTY_SPECTRUM_POINTS,
  GRAVITY_MS2,
  SPECTRUM_CHART_HEIGHT,
  SPECTRUM_HOVER_FETCH_MIN_DELTA_MS,
  SPECTRUM_LOADING_LABEL,
  SPECTRUM_NO_DATA_LABEL,
  SPECTRUM_RENDER_BARS,
  SPECTRUM_RMS_Y_MIN_MS2,
  SpectrumLoadingState,
  SpectrumNoDataState,
  SpectrumZoomChart,
  TELEMETRY_HISTORY_PRESETS,
  TELEMETRY_HISTORY_BUCKET_STEPS_MS,
  TOP_TREND_CHART_HEIGHT,
  TREND_LATEST_EPSILON_MS,
  TREND_MAX_GAP_STEP_RATIO,
  TREND_MAX_RENDER_POINTS,
  TREND_MIN_RENDER_POINTS,
  TREND_MIN_VIEW_WINDOW_MS,
  TREND_OVERVIEW_HEIGHT,
  TREND_OVERVIEW_MAX_POINTS,
  TREND_TILE_PIXEL_WIDTH,
  TREND_ZOOM_STEP,
  TelemetryTrendChart,
  TrendOverviewBrush,
  VIBRATION_AXIS_LABELS,
  addMonthsLocal,
  asFiniteNumber,
  asNonEmptyString,
  asRecord,
  asSpectrumAxis,
  asTimestampMs,
  buildCalendarDayCells,
  buildOverviewTelemetryRows,
  buildTiledTrendRows,
  clampAccelAmplitudeLimit,
  clampTrendViewport,
  downsampleSpectrumChartData,
  formatAbsoluteAxisTime,
  formatByteSize,
  formatChartTime,
  formatDateInputValue,
  formatFrequencyHz,
  formatMonthKey,
  formatMonthLabel,
  formatOptionalValue,
  formatPeakSummary,
  formatTooltipDateTime,
  formatTrendAxisTime,
  parseAmplitudeArray,
  parseDateInputValue,
  parseDeviceDataSummaryPayload,
  parseSpectrumFramePayload,
  parseSpectrumHoverTarget,
  parseSpectrumPoint,
  parseTelemetryAvailabilityPayload,
  safeString,
  spectrumBinHz,
  startOfMonthLocal,
  stopWheelScroll,
  thinSampleIndices,
  toSpectrumChartData,
  useNonPassiveWheelBlock,
} from "./sensor-chart-modal/chart-parts";
import { useChartModalLayout } from "./sensor-chart-modal/useChartModalLayout";
import {
  CHART_RANGE_PRESET_LABELS,
  EXTRA_CHART_RANGE_PRESETS,
  QUICK_CHART_RANGE_PRESETS,
  createCalendarDayChartRange,
  createCustomChartRange,
  createRelativeChartRange,
  formatChartRangeLabel,
  formatChartRangeLoadingLabel,
  type ChartRange,
  type ChartRangePreset,
} from "./sensor-chart-modal/chart-range-controller";
import {
  useChartRangeController,
  type ChartRangeResponse,
} from "./sensor-chart-modal/useChartRangeController";
import {
  buildAdaptiveMissingDataBands,
  getAdaptiveMissingDataThresholdMs,
  getStatusBandMinimumDurationMs,
  normalizeOfflineStatusBands,
} from "./sensor-chart-modal/telemetry-continuity";
import type {
  CalendarDayCell,
  DenseTelemetryRow,
  DeviceDataSummary,
  HistoryPresetKey,
  HoverTelemetrySnapshot,
  SpectrumChartDataPoint,
  SpectrumHoverTarget,
  TelemetryAvailabilityDay,
  TrendRow,
  TrendSeriesConfig,
  TrendStatusBand,
  TrendViewport,
} from "./sensor-chart-modal/chart-parts";

const LazyMotorSceneCanvas = React.lazy(() =>
  import("./MotorSceneCanvas").then((module) => ({
    default: module.MotorSceneCanvas,
  })),
);

type PlacementRotationValue = { x: number; y: number; z: number };
type PlacementAxisLabelsValue = { ax?: string; ay?: string; az?: string };
type PlacementModelAxisKey = "x" | "y" | "z";

const PLACEMENT_FACE_OPTIONS: Array<{ key: string; label: string; axisKey: PlacementModelAxisKey; sign: ""; color: string; pastel: string; rotation: PlacementRotationValue }> = [
  { key: "bottom", label: "Radial V", axisKey: "z", sign: "", color: "#0f766e", pastel: "#ccfbf1", rotation: { x: 0, y: 0, z: 0 } },
  { key: "front", label: "Radial H", axisKey: "x", sign: "", color: "#2563eb", pastel: "#dbeafe", rotation: { x: 90, y: 0, z: 180 } },
  { key: "right", label: "Axial", axisKey: "y", sign: "", color: "#dc2626", pastel: "#fee2e2", rotation: { x: 0, y: 0, z: 90 } },
];

const PLACEMENT_TWIST_OPTIONS = [0, 90] as const;
type PlacementTwistValue = (typeof PLACEMENT_TWIST_OPTIONS)[number];

const MOTOR_PHYSICAL_AXIS_LABELS: Record<PlacementModelAxisKey, string> = {
  x: "Radial H",
  y: "Axial",
  z: "Radial V",
};

const PLACEMENT_MOTOR_AXIS_RENAME_OPTIONS: Array<{
  axisKey: PlacementModelAxisKey;
  deviceAxisKey: DeviceAxisKey;
  defaultLabel: string;
}> = [
  { axisKey: "y", deviceAxisKey: "ay", defaultLabel: MOTOR_PHYSICAL_AXIS_LABELS.y },
  { axisKey: "x", deviceAxisKey: "ax", defaultLabel: MOTOR_PHYSICAL_AXIS_LABELS.x },
  { axisKey: "z", deviceAxisKey: "az", defaultLabel: MOTOR_PHYSICAL_AXIS_LABELS.z },
];

const modelAxisLabels = (axisLabels: PlacementAxisLabelsValue | undefined): Record<PlacementModelAxisKey, string> => ({
  x: axisLabels?.ax || MOTOR_PHYSICAL_AXIS_LABELS.x,
  y: axisLabels?.ay || MOTOR_PHYSICAL_AXIS_LABELS.y,
  z: axisLabels?.az || MOTOR_PHYSICAL_AXIS_LABELS.z,
});

const defaultMotorAxisLabels = () => ({
  ax: MOTOR_PHYSICAL_AXIS_LABELS.x,
  ay: MOTOR_PHYSICAL_AXIS_LABELS.y,
  az: MOTOR_PHYSICAL_AXIS_LABELS.z,
});

const motorAxisLabelsFromPlacement = (
  chartLabels: { ax: string; ay: string; az: string },
  axisKeyMapping: Record<PlacementModelAxisKey, PlacementModelAxisKey>,
) => {
  const next = defaultMotorAxisLabels();
  (["x", "y", "z"] as const).forEach((rawAxisKey) => {
    next[deviceAxisKeyForModelAxis(axisKeyMapping[rawAxisKey])] = chartLabels[deviceAxisKeyForModelAxis(rawAxisKey)];
  });
  return next;
};

const axisLabelFor = (axisLabels: PlacementAxisLabelsValue | undefined, axisKey: PlacementModelAxisKey) =>
  modelAxisLabels(axisLabels)[axisKey];

const withPlacementTwist = (
  faceRotation: PlacementRotationValue,
  twistDegrees: number,
  faceKey: string,
): PlacementRotationValue => {
  if (twistDegrees === 0) return normalizePlacementRotation(faceRotation);
  // Explicit 3-axis × 2-twist table. Keeps the 6 bidirectional orientations unique.
  if (faceKey === "bottom") return normalizePlacementRotation({ x: 0, y: 90, z: 0 });
  if (faceKey === "front") return normalizePlacementRotation({ x: 90, y: 90, z: 180 });
  if (faceKey === "right") return normalizePlacementRotation({ x: 90, y: 0, z: 90 });
  return normalizePlacementRotation(faceRotation);
};

const normalizePlacementAngle = (value: number) => ((value % 360) + 360) % 360;
const normalizePlacementRotation = (rotation: PlacementRotationValue): PlacementRotationValue => ({
  x: normalizePlacementAngle(rotation.x),
  y: normalizePlacementAngle(rotation.y),
  z: normalizePlacementAngle(rotation.z),
});
const shortestPlacementAngleDelta = (from: number, to: number) => {
  const delta = normalizePlacementAngle(to) - normalizePlacementAngle(from);
  return ((delta + 540) % 360) - 180;
};

type PlacementAxisVector = { x: number; y: number; z: number };
type PlacementAxisMatch = Record<PlacementModelAxisKey, { motorAxis: PlacementModelAxisKey; motor: string; sensor: string; hint: string }>;
const deviceAxisKeyForModelAxis = (axisKey: PlacementModelAxisKey): DeviceAxisKey =>
  axisKey === "x" ? "ax" : axisKey === "y" ? "ay" : "az";
const placementAxisLabelsEqual = (
  left: PlacementAxisLabelsValue | undefined,
  right: PlacementAxisLabelsValue | undefined,
) => (["ax", "ay", "az"] as const).every((axis) => (left?.[axis] || "") === (right?.[axis] || ""));
async function persistDeviceAxisLabels(deviceId: string, axisLabels: { ax: string; ay: string; az: string }): Promise<void> {
  const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ axisLabels }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(safeString(asRecord(body).error || "device_axis_label_update_failed"));
  }
}
const degToRad = (degrees: number) => (degrees * Math.PI) / 180;
const rotatePlacementVector = (vector: PlacementAxisVector, rotation: PlacementRotationValue): PlacementAxisVector => {
  let { x, y, z } = vector;
  const rx = degToRad(rotation.x);
  const ry = degToRad(rotation.y);
  const rz = degToRad(rotation.z);
  let cos = Math.cos(rx);
  let sin = Math.sin(rx);
  [y, z] = [y * cos - z * sin, y * sin + z * cos];
  cos = Math.cos(ry);
  sin = Math.sin(ry);
  [x, z] = [x * cos + z * sin, -x * sin + z * cos];
  cos = Math.cos(rz);
  sin = Math.sin(rz);
  [x, y] = [x * cos - y * sin, x * sin + y * cos];
  return { x, y, z };
};
const absPlacementDot = (a: PlacementAxisVector, b: PlacementAxisVector) => Math.abs(a.x * b.x + a.y * b.y + a.z * b.z);
const buildPlacementAxisMatches = (
  axisLabels: PlacementAxisLabelsValue | undefined,
  motorRotation: PlacementRotationValue,
  sensorRotation: PlacementRotationValue,
): PlacementAxisMatch => {
  const labels = modelAxisLabels(axisLabels);
  const motorAxes = [
    { key: "x" as const, label: labels.x, vector: rotatePlacementVector({ x: 1, y: 0, z: 0 }, motorRotation) },
    { key: "y" as const, label: labels.y, vector: rotatePlacementVector({ x: 0, y: 0, z: 1 }, motorRotation) },
    { key: "z" as const, label: labels.z, vector: rotatePlacementVector({ x: 0, y: 1, z: 0 }, motorRotation) },
  ];
  const sensorAxes = [
    { key: "x" as const, label: "X", vector: rotatePlacementVector({ x: 1, y: 0, z: 0 }, sensorRotation) },
    { key: "y" as const, label: "Y", vector: rotatePlacementVector({ x: 0, y: 0, z: 1 }, sensorRotation) },
    { key: "z" as const, label: "Z", vector: rotatePlacementVector({ x: 0, y: 1, z: 0 }, sensorRotation) },
  ];
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const bestPermutation = permutations.reduce((best, candidate) => {
    const candidateScore = candidate.reduce((score, motorIndex, sensorIndex) =>
      score + absPlacementDot(sensorAxes[sensorIndex].vector, motorAxes[motorIndex].vector), 0);
    const bestScore = best.reduce((score, motorIndex, sensorIndex) =>
      score + absPlacementDot(sensorAxes[sensorIndex].vector, motorAxes[motorIndex].vector), 0);
    return candidateScore > bestScore ? candidate : best;
  }, permutations[0]);
  return sensorAxes.reduce((matches, sensorAxis, sensorIndex) => {
    const motorAxis = motorAxes[bestPermutation[sensorIndex]];
    matches[sensorAxis.key] = {
      motorAxis: motorAxis.key,
      motor: motorAxis.label,
      sensor: sensorAxis.label,
      hint: `song song trục ${sensorAxis.label} cảm biến`,
    };
    return matches;
  }, {} as PlacementAxisMatch);
};
const buildPlacementAxisMatchesFromKeyMapping = (
  axisLabels: PlacementAxisLabelsValue | undefined,
  axisKeyMapping: Record<PlacementModelAxisKey, PlacementModelAxisKey>,
): PlacementAxisMatch => {
  const labels = modelAxisLabels(axisLabels);
  return (["x", "y", "z"] as const).reduce((matches, sensorAxisKey) => {
    const motorAxis = axisKeyMapping[sensorAxisKey] || sensorAxisKey;
    const sensorLabel = sensorAxisKey === "x" ? "X" : sensorAxisKey === "y" ? "Y" : "Z";
    matches[sensorAxisKey] = {
      motorAxis,
      motor: labels[motorAxis],
      sensor: sensorLabel,
      hint: `song song trục ${sensorLabel} cảm biến`,
    } as PlacementAxisMatch[typeof sensorAxisKey];
    return matches;
  }, {} as PlacementAxisMatch);
};
const chartAxisLabelsFromPlacementMatches = (
  axisLabels: { ax: string; ay: string; az: string },
  matches: PlacementAxisMatch,
) => ({
  ax: axisLabels[deviceAxisKeyForModelAxis(matches.x.motorAxis)],
  ay: axisLabels[deviceAxisKeyForModelAxis(matches.y.motorAxis)],
  az: axisLabels[deviceAxisKeyForModelAxis(matches.z.motorAxis)],
});
const placementAxisMappingFromChartLabels = (chartLabels: { ax: string; ay: string; az: string }) => ({
  x: chartLabels.ax,
  y: chartLabels.ay,
  z: chartLabels.az,
});
const placementSensorLabelForMotorAxis = (matches: PlacementAxisMatch, motorAxis: PlacementModelAxisKey) => {
  const sensorAxis = (["x", "y", "z"] as const).find((axisKey) => matches[axisKey].motorAxis === motorAxis);
  return sensorAxis ? `Sensor ${matches[sensorAxis].sensor}` : "Chưa mapping";
};
const easePlacementInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const PLAYBACK_BASE_STEP_MS = 500;
const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8] as const;
const DEFAULT_PLAYBACK_SPEED_INDEX = 2;
const TEMP_Y_DOMAIN_FIXED: [number, number] = [20, 120];
const ACCEL_TREND_DEFAULT_Y_MAX = 16 * GRAVITY_MS2;
const VRMS_TREND_DEFAULT_Y_MAX = 20;
const DRMS_TREND_DEFAULT_Y_MAX = 1;
const TREND_Y_MIN = 0.001;
const TREND_Y_MAX = 1_000_000;
const STORAGE_CHART_HISTORY_PRESET_KEY = "sgp_ui_chart_history_preset";
const STORAGE_CHART_Y_AXIS_ZOOM_KEY = "sgp_ui_chart_y_axis_zoom";

type ChartYAxisZoomStorage = {
  accel: number;
  vrms: number;
  drms: number;
  spectrum: number | null;
};

const DEFAULT_CHART_Y_AXIS_ZOOM: ChartYAxisZoomStorage = {
  accel: ACCEL_TREND_DEFAULT_Y_MAX,
  vrms: VRMS_TREND_DEFAULT_Y_MAX,
  drms: DRMS_TREND_DEFAULT_Y_MAX,
  spectrum: null,
};

function clampStoredTrendYMax(value: unknown, fallback: number): number {
  const parsed = asFiniteNumber(value);
  if (typeof parsed !== "number") {
    return fallback;
  }
  return Math.max(TREND_Y_MIN, Math.min(TREND_Y_MAX, parsed));
}

function clampStoredSpectrumYMax(value: unknown): number | null {
  const parsed = asFiniteNumber(value);
  if (typeof parsed !== "number") {
    return null;
  }
  return Math.max(SPECTRUM_RMS_Y_MIN_MS2, Math.min(10_000, parsed));
}

type DetailTileUxPhase = "idle" | "queued" | "loading" | "ready";
type DetailTileUxState = {
  phase: DetailTileUxPhase;
  pendingTiles: number;
  mode: TelemetryDetailMode | null;
  loadedAtMs?: number;
};

type TelemetryResolutionSelection = "auto" | number;

/* ── Main Modal ── */
type TelemetryHistoryRequestOptions = {
  limit?: number;
  bucketMs?: number;
  from?: string;
  to?: string;
  force?: boolean;
  replace?: boolean;
};

type DetailTileCacheEntry = {
  tile: TelemetryDetailTileRequest;
  points: DeviceTelemetryPoint[];
  loadedAtMs: number;
};

type DeviceStatusHistoryItem = {
  status: "online" | "offline";
  startedAt: string;
  endedAt?: string;
  reason?: string;
};

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

async function fetchChartRange(
  deviceId: string,
  range: ChartRange,
  bucketMs: number,
  signal: AbortSignal,
): Promise<ChartRangeResponse> {
  const query = new URLSearchParams({
    from: new Date(range.fromMs).toISOString(),
    to: new Date(Math.max(range.fromMs, range.toMs - 1)).toISOString(),
    bucketMs: String(bucketMs),
  });
  const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/telemetry?${query.toString()}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error(safeString(asRecord(payload).error || "telemetry_range_failed"));
  }
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const points = parseTelemetryHistoryPayload(payload);
  const returnedBucketMs = asFiniteNumber(data.bucketMs) ?? bucketMs;
  const totalMatched = asFiniteNumber(data.totalMatched) ?? points.length;
  const complete = typeof data.complete === "boolean"
    ? data.complete
    : data.truncated !== true;
  return {
    points,
    metadata: {
      from: asNonEmptyString(data.from) ?? new Date(range.fromMs).toISOString(),
      to: asNonEmptyString(data.to) ?? new Date(range.toMs).toISOString(),
      bucketMs: returnedBucketMs,
      sampleCount: asFiniteNumber(data.sampleCount) ?? points.length,
      totalMatched,
      complete,
    },
  };
}

function formatDateTimeLocalValue(timestampMs: number): string {
  const date = new Date(timestampMs);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(timestampMs - offsetMs).toISOString().slice(0, 16);
}

function parseDeviceStatusHistoryPayload(payload: unknown): DeviceStatusHistoryItem[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const source = firstArray(data.items, root.items, payload);

  return source
    .map((item): DeviceStatusHistoryItem | null => {
      const row = asRecord(item);
      const status = row.status === "online" ? "online" : row.status === "offline" ? "offline" : null;
      const startedAt = asNonEmptyString(row.startedAt ?? row.started_at);
      if (!status || !startedAt) {
        return null;
      }
      return {
        status,
        startedAt,
        endedAt: asNonEmptyString(row.endedAt ?? row.ended_at),
        reason: asNonEmptyString(row.reason),
      };
    })
    .filter((item): item is DeviceStatusHistoryItem => Boolean(item))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function hasDenseTelemetryValue(row: DenseTelemetryRow): boolean {
  return row.temp !== null || row.ax !== null || row.ay !== null || row.az !== null || row.vrmsX !== null || row.vrmsY !== null || row.vrmsZ !== null || row.drmsX !== null || row.drmsY !== null || row.drmsZ !== null;
}

function makeNullDenseTelemetryRow(ts: number): DenseTelemetryRow {
  return {
    ts,
    temp: null,
    ax: null,
    ay: null,
    az: null,
    vrmsX: null,
    vrmsY: null,
    vrmsZ: null,
    drmsX: null,
    drmsY: null,
    drmsZ: null,
  };
}

function stitchDenseRowsWithGaps(
  rows: DenseTelemetryRow[],
  startMs: number,
  endMs: number,
  stepMs: number,
  gapThresholdMs: number,
): DenseTelemetryRow[] {
  const safeStartMs = Math.min(startMs, endMs);
  const safeEndMs = Math.max(startMs, endMs);
  if (rows.length === 0) {
    return [
      makeNullDenseTelemetryRow(safeStartMs),
      makeNullDenseTelemetryRow(safeEndMs > safeStartMs ? safeEndMs : safeStartMs + 1),
    ];
  }

  const safeStepMs = Math.max(1, stepMs);
  const stagedRows: DenseTelemetryRow[] = [makeNullDenseTelemetryRow(safeStartMs)];
  let previousTs = safeStartMs;
  for (const row of rows) {
    const clampedTs = Math.max(safeStartMs, Math.min(safeEndMs, row.ts));
    if (clampedTs - previousTs > gapThresholdMs) {
      const gapStart = Math.min(safeEndMs, previousTs + safeStepMs);
      if (gapStart > previousTs && gapStart < clampedTs) {
        stagedRows.push(makeNullDenseTelemetryRow(gapStart));
      }

      const gapEnd = Math.max(safeStartMs, clampedTs - safeStepMs);
      const lastTs = stagedRows[stagedRows.length - 1]?.ts ?? Number.NEGATIVE_INFINITY;
      if (gapEnd > lastTs && gapEnd < clampedTs) {
        stagedRows.push(makeNullDenseTelemetryRow(gapEnd));
      }
    }

    stagedRows.push({ ...row, ts: clampedTs });
    previousTs = clampedTs;
  }

  if (safeEndMs - previousTs > gapThresholdMs) {
    const tailGapStart = Math.min(safeEndMs, previousTs + safeStepMs);
    const lastTs = stagedRows[stagedRows.length - 1]?.ts ?? Number.NEGATIVE_INFINITY;
    if (tailGapStart > lastTs && tailGapStart < safeEndMs) {
      stagedRows.push(makeNullDenseTelemetryRow(tailGapStart));
    }
  }
  stagedRows.push(makeNullDenseTelemetryRow(safeEndMs));

  const deduped = new Map<number, DenseTelemetryRow>();
  for (const row of stagedRows.sort((left, right) => left.ts - right.ts)) {
    const existing = deduped.get(row.ts);
    if (!existing || (!hasDenseTelemetryValue(existing) && hasDenseTelemetryValue(row))) {
      deduped.set(row.ts, row);
    }
  }
  return Array.from(deduped.values()).sort((left, right) => left.ts - right.ts);
}

function buildDenseTelemetryRowsFromPoints(
  points: DeviceTelemetryPoint[],
  startMs: number,
  endMs: number,
): DenseTelemetryRow[] {
  const safeStartMs = Math.min(startMs, endMs);
  const safeEndMs = Math.max(startMs, endMs);

  const rawRows = points
    .flatMap((point): DenseTelemetryRow[] => {
      const bucketStartMs = point.bucketStartedAt ? Date.parse(point.bucketStartedAt) : Number.NaN;
      const bucketEndMs = point.bucketEndedAt ? Date.parse(point.bucketEndedAt) : Number.NaN;
      const hasBucketCoverage = Number.isFinite(bucketStartMs)
        && Number.isFinite(bucketEndMs)
        && bucketEndMs >= bucketStartMs;
      const coverageOverlapsWindow = hasBucketCoverage
        && bucketEndMs >= safeStartMs
        && bucketStartMs <= safeEndMs;
      const rawSourceTs = hasBucketCoverage
        ? bucketStartMs + (bucketEndMs - bucketStartMs) / 2
        : Date.parse(point.receivedAt);
      const sourceOutsideWindow = hasBucketCoverage
        ? !coverageOverlapsWindow
        : rawSourceTs < safeStartMs || rawSourceTs > safeEndMs;
      if (!Number.isFinite(rawSourceTs) || sourceOutsideWindow) {
        return [];
      }
      const sourceTs = Math.max(safeStartMs, Math.min(safeEndMs, rawSourceTs));

      return [{
        ts: sourceTs,
        telemetryUuid: point.telemetryUuid,
        coverageStartMs: hasBucketCoverage ? bucketStartMs : undefined,
        coverageEndMs: hasBucketCoverage ? bucketEndMs : undefined,
        temp:
          typeof point.temperature === "number" && Number.isFinite(point.temperature)
            ? Number(point.temperature.toFixed(2))
            : null,
        ax:
          typeof point.ax === "number" && Number.isFinite(point.ax)
            ? Number(point.ax.toFixed(4))
            : null,
        ay:
          typeof point.ay === "number" && Number.isFinite(point.ay)
            ? Number(point.ay.toFixed(4))
            : null,
        az:
          typeof point.az === "number" && Number.isFinite(point.az)
            ? Number(point.az.toFixed(4))
            : null,
        vrmsX:
          typeof point.vrmsXMms === "number" && Number.isFinite(point.vrmsXMms)
            ? Number(point.vrmsXMms.toFixed(4))
            : null,
        vrmsY:
          typeof point.vrmsYMms === "number" && Number.isFinite(point.vrmsYMms)
            ? Number(point.vrmsYMms.toFixed(4))
            : null,
        vrmsZ:
          typeof point.vrmsZMms === "number" && Number.isFinite(point.vrmsZMms)
            ? Number(point.vrmsZMms.toFixed(4))
            : null,
        drmsX:
          typeof point.drmsXUm === "number" && Number.isFinite(point.drmsXUm)
            ? Number((point.drmsXUm / 1000).toFixed(6))
            : null,
        drmsY:
          typeof point.drmsYUm === "number" && Number.isFinite(point.drmsYUm)
            ? Number((point.drmsYUm / 1000).toFixed(6))
            : null,
        drmsZ:
          typeof point.drmsZUm === "number" && Number.isFinite(point.drmsZUm)
            ? Number((point.drmsZUm / 1000).toFixed(6))
            : null,
      }];
    })
    .sort((left, right) => left.ts - right.ts);

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
  const fallbackStepMs = Math.max(1000, Math.round((safeEndMs - safeStartMs) / 240));
  const typicalStepMs = diffs.length > 0
    ? (() => {
        const sortedDiffs = [...diffs].sort((left, right) => left - right);
        return Math.max(1000, sortedDiffs[Math.floor(sortedDiffs.length / 2)]);
      })()
    : fallbackStepMs;
  const gapThresholdMs = Math.max(2000, Math.round(typicalStepMs * 2));

  return stitchDenseRowsWithGaps(uniqueRows, safeStartMs, safeEndMs, typicalStepMs, gapThresholdMs);
}

function estimateTelemetryGapStepMs(rows: DenseTelemetryRow[], windowMs: number): number {
  const maxAllowedStepMs = Math.max(1000, Math.round(Math.max(1, windowMs) * TREND_MAX_GAP_STEP_RATIO));
  const valuedRows = rows.filter(hasDenseTelemetryValue);

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
}

type DenseTelemetryBucketAccumulator = {
  ts: number;
  telemetryUuid?: string;
  valueRows: number;
  tempSum: number;
  tempCount: number;
  axSum: number;
  axCount: number;
  aySum: number;
  ayCount: number;
  azSum: number;
  azCount: number;
  vrmsXSum: number;
  vrmsXCount: number;
  vrmsYSum: number;
  vrmsYCount: number;
  vrmsZSum: number;
  vrmsZCount: number;
  drmsXSum: number;
  drmsXCount: number;
  drmsYSum: number;
  drmsYCount: number;
  drmsZSum: number;
  drmsZCount: number;
};

function bucketDenseTelemetryRows(
  rows: DenseTelemetryRow[],
  stepMs: number,
  startMs: number,
  endMs: number,
): DenseTelemetryRow[] {
  const safeStartMs = Math.min(startMs, endMs);
  const safeEndMs = Math.max(startMs, endMs);
  const safeStepMs = Math.max(1, Math.floor(Number.isFinite(stepMs) ? stepMs : 1));

  const buckets = new Map<number, DenseTelemetryBucketAccumulator>();
  for (const row of rows) {
    if (!hasDenseTelemetryValue(row) || row.ts < safeStartMs || row.ts > safeEndMs) {
      continue;
    }

    const bucketTs = safeStartMs + Math.floor((row.ts - safeStartMs) / safeStepMs) * safeStepMs;
    const safeBucketTs = Math.max(safeStartMs, Math.min(safeEndMs, bucketTs));
    const current = buckets.get(safeBucketTs) ?? {
      ts: safeBucketTs,
      telemetryUuid: row.telemetryUuid,
      valueRows: 0,
      tempSum: 0,
      tempCount: 0,
      axSum: 0,
      axCount: 0,
      aySum: 0,
      ayCount: 0,
      azSum: 0,
      azCount: 0,
      vrmsXSum: 0,
      vrmsXCount: 0,
      vrmsYSum: 0,
      vrmsYCount: 0,
      vrmsZSum: 0,
      vrmsZCount: 0,
      drmsXSum: 0,
      drmsXCount: 0,
      drmsYSum: 0,
      drmsYCount: 0,
      drmsZSum: 0,
      drmsZCount: 0,
    };

    current.valueRows += 1;
    if (current.telemetryUuid !== row.telemetryUuid) {
      current.telemetryUuid = undefined;
    }
    if (typeof row.temp === "number" && Number.isFinite(row.temp)) {
      current.tempSum += row.temp;
      current.tempCount += 1;
    }
    if (typeof row.ax === "number" && Number.isFinite(row.ax)) {
      current.axSum += row.ax;
      current.axCount += 1;
    }
    if (typeof row.ay === "number" && Number.isFinite(row.ay)) {
      current.aySum += row.ay;
      current.ayCount += 1;
    }
    if (typeof row.az === "number" && Number.isFinite(row.az)) {
      current.azSum += row.az;
      current.azCount += 1;
    }
    if (typeof row.vrmsX === "number" && Number.isFinite(row.vrmsX)) { current.vrmsXSum += row.vrmsX; current.vrmsXCount += 1; }
    if (typeof row.vrmsY === "number" && Number.isFinite(row.vrmsY)) { current.vrmsYSum += row.vrmsY; current.vrmsYCount += 1; }
    if (typeof row.vrmsZ === "number" && Number.isFinite(row.vrmsZ)) { current.vrmsZSum += row.vrmsZ; current.vrmsZCount += 1; }
    if (typeof row.drmsX === "number" && Number.isFinite(row.drmsX)) { current.drmsXSum += row.drmsX; current.drmsXCount += 1; }
    if (typeof row.drmsY === "number" && Number.isFinite(row.drmsY)) { current.drmsYSum += row.drmsY; current.drmsYCount += 1; }
    if (typeof row.drmsZ === "number" && Number.isFinite(row.drmsZ)) { current.drmsZSum += row.drmsZ; current.drmsZCount += 1; }

    buckets.set(safeBucketTs, current);
  }

  const valueRows = Array.from(buckets.values())
    .map((bucket): DenseTelemetryRow => ({
      ts: bucket.ts,
      telemetryUuid: bucket.valueRows === 1 ? bucket.telemetryUuid : undefined,
      temp: bucket.tempCount > 0 ? Number((bucket.tempSum / bucket.tempCount).toFixed(2)) : null,
      ax: bucket.axCount > 0 ? Number((bucket.axSum / bucket.axCount).toFixed(4)) : null,
      ay: bucket.ayCount > 0 ? Number((bucket.aySum / bucket.ayCount).toFixed(4)) : null,
      az: bucket.azCount > 0 ? Number((bucket.azSum / bucket.azCount).toFixed(4)) : null,
      vrmsX: bucket.vrmsXCount > 0 ? Number((bucket.vrmsXSum / bucket.vrmsXCount).toFixed(4)) : null,
      vrmsY: bucket.vrmsYCount > 0 ? Number((bucket.vrmsYSum / bucket.vrmsYCount).toFixed(4)) : null,
      vrmsZ: bucket.vrmsZCount > 0 ? Number((bucket.vrmsZSum / bucket.vrmsZCount).toFixed(4)) : null,
      drmsX: bucket.drmsXCount > 0 ? Number((bucket.drmsXSum / bucket.drmsXCount).toFixed(3)) : null,
      drmsY: bucket.drmsYCount > 0 ? Number((bucket.drmsYSum / bucket.drmsYCount).toFixed(3)) : null,
      drmsZ: bucket.drmsZCount > 0 ? Number((bucket.drmsZSum / bucket.drmsZCount).toFixed(3)) : null,
    }))
    .sort((left, right) => left.ts - right.ts);

  return stitchDenseRowsWithGaps(valueRows, safeStartMs, safeEndMs, safeStepMs, safeStepMs * 2);
}

function toHoverTelemetrySnapshot(point: DeviceTelemetryPoint): HoverTelemetrySnapshot | null {
  const ts = Date.parse(point.receivedAt);
  if (!Number.isFinite(ts)) {
    return null;
  }

  return {
    ts,
    telemetryUuid: point.telemetryUuid,
    vibrationAvailable: point.vibrationAvailable,
    temp:
      typeof point.temperature === "number" && Number.isFinite(point.temperature)
        ? Number(point.temperature.toFixed(2))
        : undefined,
    ax:
      typeof point.ax === "number" && Number.isFinite(point.ax)
        ? Number(point.ax.toFixed(3))
        : undefined,
    ay:
      typeof point.ay === "number" && Number.isFinite(point.ay)
        ? Number(point.ay.toFixed(3))
        : undefined,
    az:
      typeof point.az === "number" && Number.isFinite(point.az)
        ? Number(point.az.toFixed(3))
        : undefined,
    vrmsX: typeof point.vrmsXMms === "number" && Number.isFinite(point.vrmsXMms) ? Number(point.vrmsXMms.toFixed(3)) : undefined,
    vrmsY: typeof point.vrmsYMms === "number" && Number.isFinite(point.vrmsYMms) ? Number(point.vrmsYMms.toFixed(3)) : undefined,
    vrmsZ: typeof point.vrmsZMms === "number" && Number.isFinite(point.vrmsZMms) ? Number(point.vrmsZMms.toFixed(3)) : undefined,
    drmsX: typeof point.drmsXUm === "number" && Number.isFinite(point.drmsXUm) ? Number((point.drmsXUm / 1000).toFixed(6)) : undefined,
    drmsY: typeof point.drmsYUm === "number" && Number.isFinite(point.drmsYUm) ? Number((point.drmsYUm / 1000).toFixed(6)) : undefined,
    drmsZ: typeof point.drmsZUm === "number" && Number.isFinite(point.drmsZUm) ? Number((point.drmsZUm / 1000).toFixed(6)) : undefined,
  };
}

function formatTelemetryStepMs(stepMs: number): string {
  const safeStepMs = Math.max(1, Math.round(Number.isFinite(stepMs) ? stepMs : 0));
  if (safeStepMs < 1000) {
    return `${safeStepMs}ms`;
  }

  if (safeStepMs < 60_000) {
    const seconds = safeStepMs / 1000;
    return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} giây`;
  }

  if (safeStepMs < 3_600_000) {
    const minutes = safeStepMs / 60_000;
    return `${Number.isInteger(minutes) ? minutes.toFixed(0) : minutes.toFixed(minutes < 10 ? 1 : 0)} phút`;
  }

  const hours = safeStepMs / 3_600_000;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(hours < 10 ? 1 : 0)} giờ`;
}

function readStoredHistoryPreset(): HistoryPresetKey {
  if (typeof window === "undefined") {
    return DEFAULT_HISTORY_PRESET_KEY;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_CHART_HISTORY_PRESET_KEY);
    return TELEMETRY_HISTORY_PRESETS.some((preset) => preset.key === stored)
      ? (stored as HistoryPresetKey)
      : DEFAULT_HISTORY_PRESET_KEY;
  } catch {
    return DEFAULT_HISTORY_PRESET_KEY;
  }
}

function writeStoredHistoryPreset(preset: HistoryPresetKey): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_CHART_HISTORY_PRESET_KEY, preset);
  } catch {
    // Ignore storage failures (private mode/quota); chart still works in-memory.
  }
}

function readStoredChartYAxisZoom(): ChartYAxisZoomStorage {
  if (typeof window === "undefined") {
    return DEFAULT_CHART_Y_AXIS_ZOOM;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_CHART_Y_AXIS_ZOOM_KEY);
    if (!raw) {
      return DEFAULT_CHART_Y_AXIS_ZOOM;
    }
    const stored = asRecord(JSON.parse(raw));
    return {
      accel: clampAccelAmplitudeLimit(asFiniteNumber(stored.accel) ?? DEFAULT_CHART_Y_AXIS_ZOOM.accel),
      vrms: clampStoredTrendYMax(stored.vrms, DEFAULT_CHART_Y_AXIS_ZOOM.vrms),
      drms: clampStoredTrendYMax(stored.drms, DEFAULT_CHART_Y_AXIS_ZOOM.drms),
      spectrum: clampStoredSpectrumYMax(stored.spectrum),
    };
  } catch {
    return DEFAULT_CHART_Y_AXIS_ZOOM;
  }
}

function writeStoredChartYAxisZoom(value: ChartYAxisZoomStorage): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_CHART_Y_AXIS_ZOOM_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures (private mode/quota); chart still works in-memory.
  }
}

interface Props {
  sensor: Sensor | null;
  telemetryPoints?: DeviceTelemetryPoint[];
  telemetryLoading?: boolean;
  spectrumPoints?: DeviceSpectrumPoint[];
  onRequestTelemetryHistory?: (deviceId: string, options?: TelemetryHistoryRequestOptions) => Promise<void>;
  onNotify?: (message: Omit<ToastItem, "id">) => void;
  onSensorUpdated?: (sensor: Sensor) => void;
  onDeviceDataCleared?: (deviceId: string) => void;
  onClose: () => void;
  onCollapse?: () => void;
  pinned?: boolean;
}

const AXIS_SERIES_COLORS: Record<DeviceAxisKey, string> = {
  ax: "#22d3ee",
  ay: "#a3e635",
  az: "#c084fc",
};

const TEMPERATURE_TREND_STROKE_WIDTH = 1.35;
const AXIS_TREND_STROKE_WIDTH = 1.25;

type FftAxisDisplayItem = (typeof FFT_AXIS_DISPLAY_ORDER)[number];

export const SensorChartModal = React.memo(function SensorChartModal({
  sensor,
  telemetryPoints: realtimeTelemetryPoints = [],
  spectrumPoints = [],
  onNotify,
  onSensorUpdated,
  onDeviceDataCleared,
  onClose,
  onCollapse,
  pinned = false,
}: Props) {
  const { C } = useTheme();
  const { wallboard } = useDisplayMode();
  const initialHistoryPreset = useMemo<ChartRangePreset>(() => readStoredHistoryPreset(), [sensor?.id]);

  useEffect(() => {
    document.body.classList.add("sgp-chart-modal-open");
    return () => {
      document.body.classList.remove("sgp-chart-modal-open");
    };
  }, []);

  const [visible, setVisible] = useState(false);
  const [accelAmplitudeLimit, setAccelAmplitudeLimit] = useState(() => readStoredChartYAxisZoom().accel);
  const [vrmsAmplitudeLimit, setVrmsAmplitudeLimit] = useState(() => readStoredChartYAxisZoom().vrms);
  const [drmsAmplitudeLimit, setDrmsAmplitudeLimit] = useState(() => readStoredChartYAxisZoom().drms);
  const [spectrumYAxisMax, setSpectrumYAxisMax] = useState<number | null>(() => readStoredChartYAxisZoom().spectrum);
  const [trendViewWindow, setTrendViewWindow] = useState<TrendViewport | null>(null);
  const [trendPanning, setTrendPanning] = useState(false);
  const [calendarPopoverOpen, setCalendarPopoverOpen] = useState(false);
  const [calendarHoverDate, setCalendarHoverDate] = useState<string | null>(null);
  const [calendarMonthCursor, setCalendarMonthCursor] = useState<Date>(() => startOfMonthLocal(new Date()));
  const [calendarAvailabilityByMonth, setCalendarAvailabilityByMonth] = useState<Record<string, Record<string, number>>>({});
  const [calendarAvailabilityLoadingKey, setCalendarAvailabilityLoadingKey] = useState<string | null>(null);
  const [calendarAvailabilityError, setCalendarAvailabilityError] = useState("");
  const [timePresetMenuOpen, setTimePresetMenuOpen] = useState(false);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [customRangeFrom, setCustomRangeFrom] = useState(() => formatDateTimeLocalValue(Date.now() - DAY_IN_MS));
  const [customRangeTo, setCustomRangeTo] = useState(() => formatDateTimeLocalValue(Date.now()));
  const [customRangeError, setCustomRangeError] = useState("");
  const [advancedRangeOpen, setAdvancedRangeOpen] = useState(false);
  const [statusHistoryItems, setStatusHistoryItems] = useState<DeviceStatusHistoryItem[]>([]);
  const [hoverSpectrumPoints, setHoverSpectrumPoints] = useState<DeviceSpectrumPoint[] | null>(null);
  const [hoverSpectrumLoading, setHoverSpectrumLoading] = useState(false);
  const [hoverSpectrumDebouncing, setHoverSpectrumDebouncing] = useState(false);
  const [spectrumPinnedTarget, setSpectrumPinnedTarget] = useState<SpectrumHoverTarget | null>(null);
  const [trendHoverTarget, setTrendHoverTarget] = useState<SpectrumHoverTarget | null>(null);
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
  const [dataClearJob, setDataClearJob] = useState<Record<string, unknown> | null>(null);
  const dataClearJobActive = dataClearJob && (safeString(dataClearJob.status) === "queued" || safeString(dataClearJob.status) === "running");
  const [axisRenameTarget, setAxisRenameTarget] = useState<DeviceAxisKey | null>(null);
  const [axisRenameDraft, setAxisRenameDraft] = useState("");
  const [axisRenameSaving, setAxisRenameSaving] = useState(false);
  const [axisRenameError, setAxisRenameError] = useState("");
  const [positionAxisRenameDrafts, setPositionAxisRenameDrafts] = useState<{ ax: string; ay: string; az: string }>(defaultMotorAxisLabels);
  const [positionAxisRenameSaving, setPositionAxisRenameSaving] = useState(false);
  const [positionAxisRenameError, setPositionAxisRenameError] = useState("");
  const [visualizeOpen, setVisualizeOpen] = useState(false);
  const [positionConfigOpen, setPositionConfigOpen] = useState(false);
  const [positionConfigSelection, setPositionConfigSelection] = useState<"motor" | "sensor">("motor");
  const [positionConfigStep, setPositionConfigStep] = useState<1 | 2 | 3>(1);
  const [positionMotorRotation, setPositionMotorRotation] = useState<PlacementRotationValue>({ x: 0, y: 0, z: 0 });
  const [positionSensorRotation, setPositionSensorRotation] = useState<PlacementRotationValue>({ x: 0, y: 0, z: 0 });
  const [positionMotorFaceKey, setPositionMotorFaceKey] = useState("bottom");
  const [positionSensorFaceKey, setPositionSensorFaceKey] = useState("bottom");
  const [positionMotorTwist, setPositionMotorTwist] = useState(0);
  const [positionSensorTwist, setPositionSensorTwist] = useState<PlacementTwistValue>(0);
  const [confirmedAxisLabels, setConfirmedAxisLabels] = useState<{ ax: string; ay: string; az: string } | null>(null);
  const [sceneAxisMatches, setSceneAxisMatches] = useState<PlacementAxisSceneMatch | null>(null);
  const [useLiveAxisMatches, setUseLiveAxisMatches] = useState(false);
  const [motorAxisLabels, setMotorAxisLabels] = useState<{ ax: string; ay: string; az: string }>(defaultMotorAxisLabels);
  const [placementAxisKeyMapping, setPlacementAxisKeyMapping] = useState<Record<PlacementModelAxisKey, PlacementModelAxisKey>>({ x: "x", y: "y", z: "z" });
  const positionRotationAnimationRef = useRef<number | null>(null);
  const [playbackRunning, setPlaybackRunning] = useState(false);
  const [playbackCursorTs, setPlaybackCursorTs] = useState<number | null>(null);
  const [playbackSpeedIndex, setPlaybackSpeedIndex] = useState(DEFAULT_PLAYBACK_SPEED_INDEX);
  const [detailTileUx, setDetailTileUx] = useState<DetailTileUxState>({
    phase: "idle",
    pendingTiles: 0,
    mode: null,
  });
  const [detailTileVersion, setDetailTileVersion] = useState(0);
  const [selectedTelemetryStepMs, setSelectedTelemetryStepMs] = useState<TelemetryResolutionSelection>("auto");
  const modalRootRef = useRef<HTMLDivElement | null>(null);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);
  const modalLayout = useChartModalLayout(modalRootRef, modalBodyRef);
  const closeTimerRef = useRef<number | null>(null);
  const onSensorUpdatedRef = useRef(onSensorUpdated);
  const spectrumHoverTimerRef = useRef<number | null>(null);
  const lastSpectrumHoverTsRef = useRef<number | null>(null);
  const spectrumRequestSeqRef = useRef(0);
  const spectrumAbortRef = useRef<AbortController | null>(null);
  const spectrumFrameCacheRef = useRef<Map<string, DeviceSpectrumPoint[]>>(new Map());
  const dataSettingsCloseTimerRef = useRef<number | null>(null);
  const dataSettingsSummaryFetchTimerRef = useRef<number | null>(null);
  const dataSummaryLoadedAtRef = useRef<number>(0);
  const clearDataConfirmCloseTimerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const detailTileFetchTimerRef = useRef<number | null>(null);
  const detailTileCacheRef = useRef<Set<string>>(new Set());
  const detailTileInFlightRef = useRef<Set<string>>(new Set());
  const detailTileEntriesRef = useRef<Map<string, DetailTileCacheEntry>>(new Map());
  const detailTileRequestSeqRef = useRef(0);
  const statusHistoryRequestSeqRef = useRef(0);
  const dataClearNotifiedJobIdRef = useRef<string | null>(null);
  const timePresetMenuRef = useRef<HTMLDivElement | null>(null);
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);
  const rangeController = useChartRangeController({
    deviceId: sensor?.id,
    initialPreset: initialHistoryPreset,
    realtimePoints: realtimeTelemetryPoints,
    fetchRange: fetchChartRange,
  });
  const telemetryPoints = rangeController.data;
  const activeRange = rangeController.state.activeRange;
  const selectedRange = rangeController.selectedRange;
  const telemetryWindowStartMs = activeRange.fromMs;
  const telemetryWindowAnchorMs = activeRange.toMs;
  const activeHistoryPreset = selectedRange.kind === "relative" ? selectedRange.preset : null;
  const selectedCalendarDate = selectedRange.kind === "calendar-day" ? selectedRange.date : "";
  const historyPresetLoading = rangeController.state.pendingRange?.kind === "relative"
    ? rangeController.state.pendingRange.preset
    : null;
  const calendarLoading = rangeController.state.status === "loading"
    && rangeController.state.pendingRange?.kind === "calendar-day";
  const rangeBusy = rangeController.state.status === "loading" || rangeController.state.status === "refreshing";

  useEffect(() => {
    writeStoredChartYAxisZoom({
      accel: accelAmplitudeLimit,
      vrms: vrmsAmplitudeLimit,
      drms: drmsAmplitudeLimit,
      spectrum: spectrumYAxisMax,
    });
  }, [accelAmplitudeLimit, drmsAmplitudeLimit, spectrumYAxisMax, vrmsAmplitudeLimit]);

  useEffect(() => {
    onSensorUpdatedRef.current = onSensorUpdated;
  }, [onSensorUpdated]);

  const calendarMonthKey = useMemo(() => formatMonthKey(calendarMonthCursor), [calendarMonthCursor]);
  const calendarMonthLabel = useMemo(() => formatMonthLabel(calendarMonthCursor), [calendarMonthCursor]);
  const calendarMonthAvailability = calendarAvailabilityByMonth[calendarMonthKey] ?? {};
  const calendarMonthLoading = calendarAvailabilityLoadingKey === calendarMonthKey;
  const calendarDayCells = useMemo(() => buildCalendarDayCells(calendarMonthCursor), [calendarMonthCursor]);
  const calendarDaysWithDataCount = useMemo(
    () => Object.values(calendarMonthAvailability).filter((count) => count > 0).length,
    [calendarMonthAvailability],
  );
  const vibrationAxisLabels = useMemo(
    () => ({
      ax: VIBRATION_AXIS_LABELS.ax,
      ay: VIBRATION_AXIS_LABELS.ay,
      az: VIBRATION_AXIS_LABELS.az,
    }),
    [],
  );
  const chartAxisLabels = confirmedAxisLabels ?? vibrationAxisLabels;
  const markPlacementAxisMatchesLive = useCallback(() => {
    setUseLiveAxisMatches(true);
    setSceneAxisMatches(null);
  }, []);
  const handlePlacementAxisMatchChange = useCallback((match: PlacementAxisSceneMatch) => {
    if (useLiveAxisMatches) {
      setSceneAxisMatches(match);
    }
  }, [useLiveAxisMatches]);

  useEffect(() => {
    setConfirmedAxisLabels(null);
    setSceneAxisMatches(null);
    setUseLiveAxisMatches(false);
    setPositionAxisRenameError("");
    setMotorAxisLabels(defaultMotorAxisLabels());
    setPositionAxisRenameDrafts(defaultMotorAxisLabels());
    setPlacementAxisKeyMapping({ x: "x", y: "y", z: "z" });
    setPositionConfigStep(1);
    setPositionConfigSelection("motor");
    setPositionMotorFaceKey("bottom");
    setPositionSensorFaceKey("bottom");
    setPositionMotorTwist(0);
    setPositionSensorTwist(0);
    setPositionMotorRotation(PLACEMENT_FACE_OPTIONS[0].rotation);
    setPositionSensorRotation(PLACEMENT_FACE_OPTIONS[0].rotation);
    if (!sensor?.id) return;
    let cancelled = false;
    fetch(`/api/devices/${encodeURIComponent(sensor.id)}/placement-config`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const config = payload?.data;
        if (cancelled || !config || typeof config !== "object") return;
        const motor = config.motor || {};
        const sensorConfig = config.sensor || {};
        if (motor.rotation) setPositionMotorRotation(motor.rotation);
        if (sensorConfig.rotation) setPositionSensorRotation(sensorConfig.rotation);
        if (typeof motor.faceKey === "string") setPositionMotorFaceKey(motor.faceKey);
        if (typeof sensorConfig.faceKey === "string") setPositionSensorFaceKey(sensorConfig.faceKey);
        if (motor.twist === 0 || motor.twist === 90) setPositionMotorTwist(motor.twist);
        if (sensorConfig.twist === 0 || sensorConfig.twist === 90) setPositionSensorTwist(sensorConfig.twist);
        let nextAxisKeyMapping: Record<PlacementModelAxisKey, PlacementModelAxisKey> = { x: "x", y: "y", z: "z" };
        let hasStoredAxisKeyMapping = false;
        if (config.axisKeyMapping && typeof config.axisKeyMapping === "object") {
          const mapping = config.axisKeyMapping as Partial<Record<PlacementModelAxisKey, PlacementModelAxisKey>>;
          nextAxisKeyMapping = {
            x: mapping.x === "x" || mapping.x === "y" || mapping.x === "z" ? mapping.x : "x",
            y: mapping.y === "x" || mapping.y === "y" || mapping.y === "z" ? mapping.y : "y",
            z: mapping.z === "x" || mapping.z === "y" || mapping.z === "z" ? mapping.z : "z",
          };
          hasStoredAxisKeyMapping = true;
        }
        setPlacementAxisKeyMapping(nextAxisKeyMapping);
        setUseLiveAxisMatches(!hasStoredAxisKeyMapping);
        let nextChartAxisLabels: { ax: string; ay: string; az: string } | null = null;
        if (config.chartAxisLabels && typeof config.chartAxisLabels === "object") {
          const labels = config.chartAxisLabels as Partial<Record<DeviceAxisKey, string>>;
          nextChartAxisLabels = {
            ax: labels.ax || MOTOR_PHYSICAL_AXIS_LABELS.x,
            ay: labels.ay || MOTOR_PHYSICAL_AXIS_LABELS.y,
            az: labels.az || MOTOR_PHYSICAL_AXIS_LABELS.z,
          };
          setConfirmedAxisLabels(nextChartAxisLabels);
          if (sensor && !placementAxisLabelsEqual(sensor.axisLabels, nextChartAxisLabels)) {
            onSensorUpdatedRef.current?.({ ...sensor, axisLabels: nextChartAxisLabels });
            void persistDeviceAxisLabels(sensor.id, nextChartAxisLabels).catch(() => undefined);
          }
        } else if (config.axisMapping && typeof config.axisMapping === "object") {
          const mapping = config.axisMapping as Partial<Record<PlacementModelAxisKey, string>>;
          nextChartAxisLabels = {
            ax: mapping.x || MOTOR_PHYSICAL_AXIS_LABELS.x,
            ay: mapping.y || MOTOR_PHYSICAL_AXIS_LABELS.y,
            az: mapping.z || MOTOR_PHYSICAL_AXIS_LABELS.z,
          };
          setConfirmedAxisLabels(nextChartAxisLabels);
          if (sensor && !placementAxisLabelsEqual(sensor.axisLabels, nextChartAxisLabels)) {
            onSensorUpdatedRef.current?.({ ...sensor, axisLabels: nextChartAxisLabels });
            void persistDeviceAxisLabels(sensor.id, nextChartAxisLabels).catch(() => undefined);
          }
        }
        if (config.motorAxisLabels && typeof config.motorAxisLabels === "object") {
          const labels = config.motorAxisLabels as Partial<Record<DeviceAxisKey, string>>;
          const nextMotorAxisLabels = {
            ax: labels.ax || MOTOR_PHYSICAL_AXIS_LABELS.x,
            ay: labels.ay || MOTOR_PHYSICAL_AXIS_LABELS.y,
            az: labels.az || MOTOR_PHYSICAL_AXIS_LABELS.z,
          };
          setMotorAxisLabels(nextMotorAxisLabels);
          setPositionAxisRenameDrafts(nextMotorAxisLabels);
        } else if (nextChartAxisLabels) {
          const nextMotorAxisLabels = motorAxisLabelsFromPlacement(nextChartAxisLabels, nextAxisKeyMapping);
          setMotorAxisLabels(nextMotorAxisLabels);
          setPositionAxisRenameDrafts(nextMotorAxisLabels);
        } else {
          const nextMotorAxisLabels = defaultMotorAxisLabels();
          setMotorAxisLabels(nextMotorAxisLabels);
          setPositionAxisRenameDrafts(nextMotorAxisLabels);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sensor?.id, vibrationAxisLabels]);

  const visualizeOverlay = modalLayout.viewportWidth < 1180;

  useEffect(() => {
    setTrendHoverTarget(null);
  }, [sensor?.id]);
  const visualizeSidebarWidth = visualizeOverlay
    ? "min(var(--dc-chart-control-max), calc(100vw - 48px))"
    : "min(35vw, var(--dc-chart-control-max))";

  useEffect(() => {
    if (sensor) { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }
    else { setVisible(false); }
  }, [sensor]);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const clearDetailTileFetchTimer = useCallback(() => {
    if (detailTileFetchTimerRef.current !== null) {
      window.clearTimeout(detailTileFetchTimerRef.current);
      detailTileFetchTimerRef.current = null;
    }
  }, []);

  const resetDetailTileCache = useCallback(() => {
    clearDetailTileFetchTimer();
    detailTileCacheRef.current.clear();
    detailTileInFlightRef.current.clear();
    detailTileEntriesRef.current.clear();
    detailTileRequestSeqRef.current += 1;
    setDetailTileVersion((version) => version + 1);
    setDetailTileUx({
      phase: "idle",
      pendingTiles: 0,
      mode: null,
    });
  }, [clearDetailTileFetchTimer]);

  const handleClose = useCallback(() => {
    if (pinned || clearingDeviceData) {
      return;
    }
    if (closeTimerRef.current !== null) {
      return;
    }
    clearPlaybackTimer();
    setPlaybackRunning(false);
    setPlaybackCursorTs(null);
    setVisualizeOpen(false);
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, CHART_MODAL_TRANSITION_MS);
  }, [clearPlaybackTimer, clearingDeviceData, onClose, pinned]);

  const openAxisRenameModal = useCallback(
    (axis: DeviceAxisKey) => {
      if (!sensor || axisRenameSaving) {
        return;
      }
      setCalendarPopoverOpen(false);
      setTimePresetMenuOpen(false);
      setAxisRenameTarget(axis);
      setAxisRenameDraft(chartAxisLabels[axis]);
      setAxisRenameError("");
    },
    [axisRenameSaving, sensor, chartAxisLabels],
  );

  const closeAxisRenameModal = useCallback(() => {
    if (axisRenameSaving) {
      return;
    }
    setAxisRenameTarget(null);
    setAxisRenameDraft("");
    setAxisRenameError("");
  }, [axisRenameSaving]);

  const saveAxisRename = useCallback(async () => {
    if (!sensor || !axisRenameTarget || axisRenameSaving) {
      return;
    }

    const trimmedName = axisRenameDraft.trim();
    const nextChartLabels = {
      ...chartAxisLabels,
      [axisRenameTarget]: trimmedName || vibrationAxisLabels[axisRenameTarget],
    };
    const rawAxisKey: PlacementModelAxisKey = axisRenameTarget === "ax" ? "x" : axisRenameTarget === "ay" ? "y" : "z";
    const motorAxisKey = placementAxisKeyMapping[rawAxisKey];
    const nextMotorAxisLabels = {
      ...motorAxisLabels,
      [deviceAxisKeyForModelAxis(motorAxisKey)]: nextChartLabels[axisRenameTarget],
    };
    setAxisRenameSaving(true);
    setAxisRenameError("");

    try {
      const existingResponse = await fetch(`/api/devices/${encodeURIComponent(sensor.id)}/placement-config`);
      const existingPayload = existingResponse.ok ? await existingResponse.json().catch(() => ({})) : {};
      const existingConfig = asRecord(asRecord(existingPayload).data ?? existingPayload);
      const response = await fetch(`/api/devices/${encodeURIComponent(sensor.id)}/placement-config`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...existingConfig,
          axisMapping: placementAxisMappingFromChartLabels(nextChartLabels),
          axisKeyMapping: placementAxisKeyMapping,
          chartAxisLabels: nextChartLabels,
          motorAxisLabels: nextMotorAxisLabels,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "placement_axis_label_update_failed"));
      }

      const axisDirectionLabel = chartAxisLabels[axisRenameTarget];
      setConfirmedAxisLabels(nextChartLabels);
      setMotorAxisLabels(nextMotorAxisLabels);
      setPositionAxisRenameDrafts(nextMotorAxisLabels);
      onSensorUpdated?.({ ...sensor, axisLabels: nextChartLabels });
      onNotify?.({
        type: "success",
        title: "Đã đổi tên trục",
        text: `${sensor.name || sensor.id}: ${axisDirectionLabel} → ${axisRenameDraft.trim() || "mặc định"}`,
      });
      setAxisRenameTarget(null);
      setAxisRenameDraft("");
    } catch (error) {
      const message = `Không đổi được tên trục: ${safeString(error)}`;
      setAxisRenameError(message);
      onNotify?.({ type: "warning", title: "Đổi tên trục thất bại", text: message });
    } finally {
      setAxisRenameSaving(false);
    }
  }, [axisRenameDraft, axisRenameSaving, axisRenameTarget, chartAxisLabels, motorAxisLabels, onNotify, onSensorUpdated, placementAxisKeyMapping, sensor, vibrationAxisLabels]);

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

  const stopPlayback = useCallback(() => {
    clearPlaybackTimer();
    setPlaybackRunning(false);
    setPlaybackCursorTs(null);
  }, [clearPlaybackTimer]);

  const toggleVisualizeSidebar = useCallback(() => {
    setCalendarPopoverOpen(false);
    setTimePresetMenuOpen(false);
    setVisualizeOpen((open) => !open);
  }, []);

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
      setDataClearJob(payload);
      onNotify?.({ type: "success", title: "Đã tạo job xoá", text: "Tiến độ hiển thị trong modal xoá." });
      return;
    } catch (error) {
      onNotify?.({
        type: "warning",
        title: "Xoá dữ liệu thất bại",
        text: safeString(error),
      });
    } finally {
      setClearingDeviceData(false);
    }
  }, [clearingDeviceData, closeClearDataConfirm, onNotify, sensor]);

  useEffect(() => {
    setDataClearJob(null);
  }, [sensor?.id]);

  useEffect(() => {
    if (!sensor) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const jobId = asNonEmptyString(dataClearJob?.jobId) ?? "";
        const url = jobId
          ? `/api/device-data-clear-jobs/${encodeURIComponent(jobId)}`
          : `/api/devices/${encodeURIComponent(sensor.id)}/data-clear-job`;
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        const body = await response.json().catch(() => ({}));
        const job = asRecord(asRecord(body).data);
        if (!cancelled && Object.keys(job).length > 0) {
          setDataClearJob(job);
          const status = safeString(job.status);
          const currentJobId = safeString(job.jobId);
          const active = status === "queued" || status === "running";
          if (!active && currentJobId && dataClearNotifiedJobIdRef.current !== currentJobId) {
            dataClearNotifiedJobIdRef.current = currentJobId;
            if (status === "completed") {
              onDeviceDataCleared?.(sensor.id);
              onNotify?.({ type: "success", title: "Đã xoá dữ liệu", text: `${sensor.name || sensor.id}: job hoàn tất.` });
              dataSummaryLoadedAtRef.current = 0;
              void loadDeviceDataSummary({ silent: true });
            } else if (status === "failed") {
              onNotify?.({ type: "warning", title: "Job xoá thất bại", text: safeString(job.error || "unknown_error") });
            }
          }
        }
      } catch {
        // keep polling
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dataClearJob?.jobId, loadDeviceDataSummary, onDeviceDataCleared, onNotify, sensor]);

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
      if (axisRenameTarget || positionAxisRenameSaving || clearDataConfirmMounted || clearingDeviceData || dataSettingsMounted) {
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (positionConfigOpen) {
        setPositionConfigOpen(false);
        return;
      }
      if (visualizeOpen) {
        setVisualizeOpen(false);
        return;
      }
      handleClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [axisRenameTarget, clearDataConfirmMounted, clearingDeviceData, dataSettingsMounted, sensor, handleClose, positionAxisRenameSaving, positionConfigOpen, visualizeOpen]);

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
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      if (detailTileFetchTimerRef.current !== null) {
        window.clearTimeout(detailTileFetchTimerRef.current);
        detailTileFetchTimerRef.current = null;
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
    setVisualizeOpen(false);
    setPlaybackRunning(false);
    setPlaybackCursorTs(null);
    setPlaybackSpeedIndex(DEFAULT_PLAYBACK_SPEED_INDEX);
    setSelectedTelemetryStepMs("auto");
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
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setTimePresetMenuOpen(false);
    setCalendarPopoverOpen(false);
    setCalendarMonthCursor(startOfMonthLocal(new Date()));
    setCalendarAvailabilityByMonth({});
    setCalendarAvailabilityLoadingKey(null);
    setCalendarAvailabilityError("");
    setStatusHistoryItems([]);
    statusHistoryRequestSeqRef.current += 1;
  }, [sensor?.id]);

  const animatePlacementRotation = useCallback((target: PlacementRotationValue, objectKey = positionConfigStep === 1 ? "motor" : "sensor") => {
    markPlacementAxisMatchesLive();
    if (typeof window === "undefined") {
      if (objectKey === "motor") setPositionMotorRotation(normalizePlacementRotation(target));
      else setPositionSensorRotation(normalizePlacementRotation(target));
      return;
    }
    if (positionRotationAnimationRef.current !== null) {
      window.cancelAnimationFrame(positionRotationAnimationRef.current);
      positionRotationAnimationRef.current = null;
    }
    const setValues = objectKey === "motor" ? setPositionMotorRotation : setPositionSensorRotation;
    const source = objectKey === "motor" ? positionMotorRotation : positionSensorRotation;
    const normalizedTarget = normalizePlacementRotation(target);
    const delta = {
      x: shortestPlacementAngleDelta(source.x, normalizedTarget.x),
      y: shortestPlacementAngleDelta(source.y, normalizedTarget.y),
      z: shortestPlacementAngleDelta(source.z, normalizedTarget.z),
    };
    const start = window.performance.now();
    const duration = 620;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easePlacementInOut(progress);
      setValues(normalizePlacementRotation({
        x: source.x + delta.x * eased,
        y: source.y + delta.y * eased,
        z: source.z + delta.z * eased,
      }));
      if (progress < 1) {
        positionRotationAnimationRef.current = window.requestAnimationFrame(tick);
        return;
      }
      positionRotationAnimationRef.current = null;
      setValues(normalizedTarget);
    };
    positionRotationAnimationRef.current = window.requestAnimationFrame(tick);
  }, [markPlacementAxisMatchesLive, positionConfigStep, positionMotorRotation, positionSensorRotation]);

  const placementAxisMatches = useMemo(
    () => useLiveAxisMatches
      ? sceneAxisMatches ?? buildPlacementAxisMatches(motorAxisLabels, positionMotorRotation, positionSensorRotation)
      : buildPlacementAxisMatchesFromKeyMapping(motorAxisLabels, placementAxisKeyMapping),
    [motorAxisLabels, placementAxisKeyMapping, positionMotorRotation, positionSensorRotation, sceneAxisMatches, useLiveAxisMatches],
  );

  const savePositionConfig = useCallback(async () => {
    if (!sensor || positionAxisRenameSaving) {
      return;
    }
    const defaults = defaultMotorAxisLabels();
    const nextMotorAxisLabels = {
      ax: positionAxisRenameDrafts.ax.trim() || defaults.ax,
      ay: positionAxisRenameDrafts.ay.trim() || defaults.ay,
      az: positionAxisRenameDrafts.az.trim() || defaults.az,
    };
    const nextChartLabels = chartAxisLabelsFromPlacementMatches(nextMotorAxisLabels, placementAxisMatches);
    const nextAxisKeyMapping = {
      x: placementAxisMatches.x.motorAxis,
      y: placementAxisMatches.y.motorAxis,
      z: placementAxisMatches.z.motorAxis,
    };

    setPositionAxisRenameSaving(true);
    setPositionAxisRenameError("");
    try {
      const placementConfig = {
        motor: { faceKey: positionMotorFaceKey, twist: positionMotorTwist, rotation: positionMotorRotation },
        sensor: { faceKey: positionSensorFaceKey, twist: positionSensorTwist, rotation: positionSensorRotation },
        axisMapping: placementAxisMappingFromChartLabels(nextChartLabels),
        axisKeyMapping: nextAxisKeyMapping,
        chartAxisLabels: nextChartLabels,
        motorAxisLabels: nextMotorAxisLabels,
      };
      const response = await fetch(`/api/devices/${encodeURIComponent(sensor.id)}/placement-config`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(placementConfig),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "placement_axis_label_update_failed"));
      }

      setMotorAxisLabels(nextMotorAxisLabels);
      setConfirmedAxisLabels(nextChartLabels);
      setPlacementAxisKeyMapping(nextAxisKeyMapping);
      setUseLiveAxisMatches(false);
      setSceneAxisMatches(null);
      onSensorUpdated?.({ ...sensor, axisLabels: nextChartLabels });
      setPositionConfigOpen(false);
      onNotify?.({
        type: "success",
        title: "Đã lưu cấu hình 3D",
        text: `${sensor.name || sensor.id}: ${nextChartLabels.ax} / ${nextChartLabels.ay} / ${nextChartLabels.az}`,
      });
    } catch (error) {
      const message = `Không lưu được cấu hình 3D: ${safeString(error)}`;
      setPositionAxisRenameError(message);
      onNotify?.({ type: "warning", title: "Lưu cấu hình 3D thất bại", text: message });
    } finally {
      setPositionAxisRenameSaving(false);
    }
  }, [
    onNotify,
    onSensorUpdated,
    placementAxisMatches,
    positionAxisRenameDrafts,
    positionAxisRenameSaving,
    positionMotorFaceKey,
    positionMotorRotation,
    positionMotorTwist,
    positionSensorFaceKey,
    positionSensorRotation,
    positionSensorTwist,
    sensor,
  ]);

  useEffect(() => () => {
    if (positionRotationAnimationRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(positionRotationAnimationRef.current);
    }
  }, []);

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
      if (customRangeOpen) {
        const menuNode = timePresetMenuRef.current;
        if (menuNode && !menuNode.contains(targetNode)) {
          setCustomRangeOpen(false);
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
  }, [calendarPopoverOpen, customRangeOpen, timePresetMenuOpen]);

  const telemetryTimeline = useMemo<HoverTelemetrySnapshot[]>(() => {
    const byTs = new Map<number, HoverTelemetrySnapshot>();
    const addSnapshot = (point: DeviceTelemetryPoint) => {
      const snapshot = toHoverTelemetrySnapshot(point);
      if (snapshot) {
        byTs.set(snapshot.ts, snapshot);
      }
    };

    telemetryPoints.forEach(addSnapshot);
    detailTileEntriesRef.current.forEach((entry) => {
      entry.points.forEach(addSnapshot);
    });

    return Array.from(byTs.values()).sort((left, right) => left.ts - right.ts);
  }, [detailTileVersion, telemetryPoints]);

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
      const cacheKey = `${sensor.id}:${telemetryUuid || requestAt}`;
      const cached = spectrumFrameCacheRef.current.get(cacheKey);
      if (cached && !options?.force) {
        setHoverSpectrumPoints(cached);
        setHoverSpectrumLoading(false);
        setHoverSpectrumDebouncing(false);
        return;
      }

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
      spectrumAbortRef.current?.abort();
      const abortController = new AbortController();
      spectrumAbortRef.current = abortController;
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
            signal: abortController.signal,
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
        spectrumFrameCacheRef.current.set(cacheKey, points);
        if (spectrumFrameCacheRef.current.size > 160) {
          const oldestKey = spectrumFrameCacheRef.current.keys().next().value;
          if (oldestKey) {
            spectrumFrameCacheRef.current.delete(oldestKey);
          }
        }
        setHoverSpectrumPoints(points);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        if (requestId === spectrumRequestSeqRef.current) {
          setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
        }
      } finally {
        if (requestId === spectrumRequestSeqRef.current) {
          if (spectrumAbortRef.current === abortController) {
            spectrumAbortRef.current = null;
          }
          setHoverSpectrumLoading(false);
        }
      }
    },
    [sensor],
  );

  const requestTelemetryDetailTile = useCallback(
    async (deviceId: string, tile: TelemetryDetailTileRequest): Promise<DeviceTelemetryPoint[]> => {
      const query = new URLSearchParams({
        from: new Date(tile.fromMs).toISOString(),
        to: new Date(Math.max(tile.fromMs, tile.toExclusiveMs - 1)).toISOString(),
      });
      if (tile.bucketMs) {
        query.set("bucketMs", String(tile.bucketMs));
      }
      if (tile.limit) {
        query.set("limit", String(tile.limit));
      }

      const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/telemetry?${query.toString()}`, {
        headers: {
          Accept: "application/json",
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(safeString(asRecord(payload).error || "telemetry_tile_failed"));
      }
      return parseTelemetryHistoryPayload(payload);
    },
    [],
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
      const nearestSnapshot = findNearestTelemetrySnapshot(target.timestampMs);
      if (nearestSnapshot?.vibrationAvailable === false) {
        setTrendHoverTarget({ ...target, timestampMs: nearestSnapshot.ts, telemetryUuid: undefined });
        setHoverTelemetrySnapshot(nearestSnapshot);
        if (spectrumHoverTimerRef.current !== null) {
          window.clearTimeout(spectrumHoverTimerRef.current);
          spectrumHoverTimerRef.current = null;
        }
        spectrumRequestSeqRef.current += 1;
        spectrumAbortRef.current?.abort();
        setHoverSpectrumDebouncing(false);
        setHoverSpectrumLoading(false);
        setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
        return;
      }
      const targetTelemetryUuid = target.telemetryUuid || nearestSnapshot?.telemetryUuid;
      const targetTimestampMs = nearestSnapshot?.telemetryUuid ? nearestSnapshot.ts : target.timestampMs;
      setTrendHoverTarget({ ...target, timestampMs: targetTimestampMs, telemetryUuid: targetTelemetryUuid });
      setHoverTelemetrySnapshot(nearestSnapshot);

      if (spectrumHoverTimerRef.current !== null) {
        window.clearTimeout(spectrumHoverTimerRef.current);
      }
      spectrumRequestSeqRef.current += 1;
      spectrumAbortRef.current?.abort();
      setHoverSpectrumLoading(true);
      setHoverSpectrumDebouncing(false);
      void requestSpectrumFrameAt(targetTimestampMs, targetTelemetryUuid);
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
      const nearestSnapshot = findNearestTelemetrySnapshot(target.timestampMs);
      if (nearestSnapshot?.vibrationAvailable === false) {
        const normalizedTarget = { ...target, timestampMs: nearestSnapshot.ts, telemetryUuid: undefined };
        setSpectrumPinnedTarget(normalizedTarget);
        setTrendHoverTarget(normalizedTarget);
        setHoverTelemetrySnapshot(nearestSnapshot);
        setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
        setHoverSpectrumLoading(false);
        return;
      }
      const targetTelemetryUuid = target.telemetryUuid || nearestSnapshot?.telemetryUuid;
      const targetTimestampMs = nearestSnapshot?.telemetryUuid ? nearestSnapshot.ts : target.timestampMs;
      const normalizedTarget = { ...target, timestampMs: targetTimestampMs, telemetryUuid: targetTelemetryUuid };
      setSpectrumPinnedTarget(normalizedTarget);
      setTrendHoverTarget(normalizedTarget);
      setHoverTelemetrySnapshot(nearestSnapshot);
      setHoverSpectrumPoints(EMPTY_SPECTRUM_POINTS);
      setHoverSpectrumLoading(false);
      void requestSpectrumFrameAt(targetTimestampMs, targetTelemetryUuid, { force: true });
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
    setTrendHoverTarget(null);
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
    setTrendHoverTarget(null);
    lastSpectrumHoverTsRef.current = null;
  }, [spectrumPinnedTarget]);

  const handleHistoryPresetSelect = useCallback(
    (preset: HistoryPresetKey) => {
      writeStoredHistoryPreset(preset);
      setCalendarPopoverOpen(false);
      setCustomRangeOpen(false);
      setTrendViewWindow(null);
      void rangeController.selectRange(createRelativeChartRange(preset));
    },
    [rangeController.selectRange],
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
    (dateValue: string) => {
      const range = createCalendarDayChartRange(dateValue);
      if (!range) return;
      setTimePresetMenuOpen(false);
      setCustomRangeOpen(false);
      setCalendarMonthCursor(startOfMonthLocal(new Date(range.fromMs)));
      setCalendarPopoverOpen(false);
      setTrendViewWindow(null);
      void rangeController.selectRange(range);
    },
    [rangeController.selectRange],
  );

  const handleToggleCalendarPopover = useCallback(() => {
    setTimePresetMenuOpen(false);
    setCustomRangeOpen(false);
    setCalendarAvailabilityError("");
    setCalendarPopoverOpen((open) => {
      const next = !open;
      if (next) {
        const anchor = parseDateInputValue(selectedCalendarDate) ?? new Date(telemetryWindowAnchorMs);
        setCalendarMonthCursor(startOfMonthLocal(anchor));
      }
      return next;
    });
  }, [selectedCalendarDate, telemetryWindowAnchorMs]);

  const handleCustomRangeApply = useCallback(() => {
    const fromMs = Date.parse(customRangeFrom);
    const toMs = Date.parse(customRangeTo);
    const range = createCustomChartRange(fromMs, toMs);
    if (!range) {
      setCustomRangeError("Thời gian kết thúc phải lớn hơn thời gian bắt đầu.");
      return;
    }
    if (range.toMs > Date.now() + 60_000) {
      setCustomRangeError("Khoảng tùy chỉnh không được kết thúc trong tương lai.");
      return;
    }
    setCustomRangeError("");
    setCustomRangeOpen(false);
    setTimePresetMenuOpen(false);
    setTrendViewWindow(null);
    void rangeController.selectRange(range);
  }, [customRangeFrom, customRangeTo, rangeController.selectRange]);

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

  const timelineTelemetryData = useMemo<DenseTelemetryRow[]>(() => {
    if (!sensor) {
      return [];
    }
    return buildDenseTelemetryRowsFromPoints(telemetryPoints, telemetryWindowStartMs, telemetryWindowAnchorMs);
  }, [sensor, telemetryPoints, telemetryWindowAnchorMs, telemetryWindowStartMs]);
  const overviewTelemetryData = useMemo(
    () => buildOverviewTelemetryRows(timelineTelemetryData),
    [timelineTelemetryData],
  );

  const telemetryGapStepMs = useMemo(
    () => estimateTelemetryGapStepMs(timelineTelemetryData, telemetryWindowAnchorMs - telemetryWindowStartMs),
    [telemetryWindowAnchorMs, telemetryWindowStartMs, timelineTelemetryData],
  );

  const tempDomain = TEMP_Y_DOMAIN_FIXED;

  const hoverSpectrumBusy = hoverSpectrumDebouncing || hoverSpectrumLoading;
  const hoverTelemetrySummaryLabel = useMemo(() => {
    if (!hoverTelemetrySnapshot) {
      return "";
    }
    return `Mốc: ${formatTooltipDateTime(hoverTelemetrySnapshot.ts)} · Temp ${formatOptionalValue(
      hoverTelemetrySnapshot.temp,
      2,
      "°C",
    )} · ${chartAxisLabels.ax} ${formatOptionalValue(
      hoverTelemetrySnapshot.ax,
      2,
    )} · ${chartAxisLabels.ay} ${formatOptionalValue(
      hoverTelemetrySnapshot.ay,
      2,
    )} · ${chartAxisLabels.az} ${formatOptionalValue(hoverTelemetrySnapshot.az, 2)} m/s²`;
  }, [hoverTelemetrySnapshot, chartAxisLabels]);
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
  const spectrumPeakByAxis = useMemo<
    Record<SpectrumAxis, { frequencyHz?: number; amplitude?: number }>
  >(
    () => {
      const pickPeak = (data: typeof fftX) =>
        data.length > 0 ? data.reduce((peak, item) => (item.amp > peak.amp ? item : peak)) : null;
      const peakX = pickPeak(fftX);
      const peakY = pickPeak(fftY);
      const peakZ = pickPeak(fftZ);
      return {
        x: {
          frequencyHz: peakX?.freq,
          amplitude: peakX?.amp,
        },
        y: {
          frequencyHz: peakY?.freq,
          amplitude: peakY?.amp,
        },
        z: {
          frequencyHz: peakZ?.freq,
          amplitude: peakZ?.amp,
        },
      };
    },
    [fftX, fftY, fftZ],
  );
  const spectrumMaxHzByAxis = useMemo<Record<SpectrumAxis, number>>(
    () => ({
      x: fftX.length > 0 ? fftX[fftX.length - 1].freq : 0,
      y: fftY.length > 0 ? fftY[fftY.length - 1].freq : 0,
      z: fftZ.length > 0 ? fftZ[fftZ.length - 1].freq : 0,
    }),
    [fftX, fftY, fftZ],
  );
  const spectrumAutoYAxisMax = useMemo(() => {
    const maxAmp = Math.max(
      spectrumPeakByAxis.x.amplitude ?? 0,
      spectrumPeakByAxis.y.amplitude ?? 0,
      spectrumPeakByAxis.z.amplitude ?? 0,
    );
    const padded = maxAmp * 1.18;
    if (!(padded > 0)) {
      return SPECTRUM_RMS_Y_MIN_MS2;
    }
    if (padded <= 1) {
      return Math.max(SPECTRUM_RMS_Y_MIN_MS2, Number(padded.toFixed(2)));
    }
    if (padded <= 10) {
      return Math.ceil(padded * 10) / 10;
    }
    return Math.ceil(padded);
  }, [spectrumPeakByAxis]);
  const effectiveSpectrumYAxisMax = spectrumYAxisMax ?? spectrumAutoYAxisMax;
  const loadedTrendWindowMs = useMemo(
    () => Math.max(1, telemetryWindowAnchorMs - telemetryWindowStartMs),
    [telemetryWindowAnchorMs, telemetryWindowStartMs],
  );
  const trendMinViewWindowMs = useMemo(
    () => Math.min(loadedTrendWindowMs, Math.max(TREND_MIN_VIEW_WINDOW_MS, telemetryGapStepMs * 8)),
    [loadedTrendWindowMs, telemetryGapStepMs],
  );
  const trendVisibleWindow = useMemo(() => {
    const requestedWindow = trendViewWindow ?? {
      startMs: telemetryWindowStartMs,
      endMs: telemetryWindowAnchorMs,
    };
    return clampTrendViewport(
      requestedWindow,
      telemetryWindowStartMs,
      telemetryWindowAnchorMs,
      trendMinViewWindowMs,
    );
  }, [
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

  useEffect(() => {
    if (!sensor) {
      return;
    }

    const requestSeq = statusHistoryRequestSeqRef.current + 1;
    statusHistoryRequestSeqRef.current = requestSeq;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        from: new Date(telemetryWindowStartMs).toISOString(),
        to: new Date(telemetryWindowAnchorMs).toISOString(),
        limit: "5000",
      });
      void fetch(`/api/devices/${encodeURIComponent(sensor.id)}/status-history?${query.toString()}`, {
        headers: { Accept: "application/json" },
      })
        .then((response) => response.json().then((body) => ({ ok: response.ok, body })).catch(() => ({ ok: response.ok, body: null })))
        .then(({ ok, body }) => {
          if (requestSeq !== statusHistoryRequestSeqRef.current) {
            return;
          }
          setStatusHistoryItems(ok && body ? parseDeviceStatusHistoryPayload(body) : []);
        })
        .catch(() => {
          if (requestSeq === statusHistoryRequestSeqRef.current) {
            setStatusHistoryItems([]);
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [sensor, telemetryWindowAnchorMs, telemetryWindowStartMs]);

  const trendStatusBands = useMemo<TrendStatusBand[]>(() => {
    const fallbackEnd = telemetryWindowAnchorMs;
    return statusHistoryItems.reduce<TrendStatusBand[]>((bands, item) => {
        const from = Date.parse(item.startedAt);
        const to = item.endedAt ? Date.parse(item.endedAt) : fallbackEnd;
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
          return bands;
        }
        bands.push({
          from,
          to,
          status: item.status,
          reason: item.reason,
        });
        return bands;
      }, []);
  }, [statusHistoryItems, telemetryWindowAnchorMs]);

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

  const handleAccelYAxisZoom = useCallback(({ deltaY }: { deltaY: number }) => {
    const zoomOut = deltaY > 0;
    setAccelAmplitudeLimit((current) => clampAccelAmplitudeLimit(current * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP)));
  }, []);

  const clampGenericTrendYMax = useCallback((value: number) => Math.max(TREND_Y_MIN, Math.min(TREND_Y_MAX, value)), []);

  const handleVrmsYAxisZoom = useCallback(({ deltaY }: { deltaY: number }) => {
    const zoomOut = deltaY > 0;
    setVrmsAmplitudeLimit((current) => clampGenericTrendYMax(current * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP)));
  }, [clampGenericTrendYMax]);

  const handleDrmsYAxisZoom = useCallback(({ deltaY }: { deltaY: number }) => {
    const zoomOut = deltaY > 0;
    setDrmsAmplitudeLimit((current) => clampGenericTrendYMax(current * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP)));
  }, [clampGenericTrendYMax]);

  const handleSpectrumYAxisZoom = useCallback((deltaY: number) => {
    const zoomOut = deltaY > 0;
    setSpectrumYAxisMax((current) => {
      const base = current ?? spectrumAutoYAxisMax;
      const next = base * (zoomOut ? TREND_ZOOM_STEP : 1 / TREND_ZOOM_STEP);
      return Math.max(SPECTRUM_RMS_Y_MIN_MS2, Math.min(10000, Number(next.toFixed(next < 10 ? 2 : 1))));
    });
  }, [spectrumAutoYAxisMax]);

  const hasYAxisZoom = useMemo(() => {
    const same = (left: number, right: number) => Math.abs(left - right) <= 0.0001;
    return !same(accelAmplitudeLimit, ACCEL_TREND_DEFAULT_Y_MAX)
      || !same(vrmsAmplitudeLimit, VRMS_TREND_DEFAULT_Y_MAX)
      || !same(drmsAmplitudeLimit, DRMS_TREND_DEFAULT_Y_MAX)
      || spectrumYAxisMax !== null;
  }, [accelAmplitudeLimit, drmsAmplitudeLimit, spectrumYAxisMax, vrmsAmplitudeLimit]);

  const handleResetYAxisZoom = useCallback(() => {
    setAccelAmplitudeLimit(ACCEL_TREND_DEFAULT_Y_MAX);
    setVrmsAmplitudeLimit(VRMS_TREND_DEFAULT_Y_MAX);
    setDrmsAmplitudeLimit(DRMS_TREND_DEFAULT_Y_MAX);
    setSpectrumYAxisMax(null);
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

  const trendDetailMode = useMemo(
    () => getTelemetryDetailMode(
      Math.max(1, trendVisibleWindow.endMs - trendVisibleWindow.startMs),
      loadedTrendWindowMs,
    ),
    [loadedTrendWindowMs, trendVisibleWindow.endMs, trendVisibleWindow.startMs],
  );

  const detailTelemetryData = useMemo<DenseTelemetryRow[]>(() => {
    if (!trendDetailMode) {
      return [];
    }

    const pointsByKey = new Map<string, DeviceTelemetryPoint>();
    detailTileEntriesRef.current.forEach((entry) => {
      if (rangeController.activeQueryKey && entry.tile.rangeKey !== rangeController.activeQueryKey) {
        return;
      }
      if (entry.tile.mode !== trendDetailMode) {
        return;
      }
      if (entry.tile.toExclusiveMs <= trendVisibleWindow.startMs || entry.tile.fromMs >= trendVisibleWindow.endMs) {
        return;
      }

      for (const point of entry.points) {
        const ts = Date.parse(point.receivedAt);
        if (!Number.isFinite(ts) || ts < trendVisibleWindow.startMs || ts > trendVisibleWindow.endMs) {
          continue;
        }
        const key = point.telemetryUuid || `${point.receivedAt}|${point.ax ?? ""}|${point.ay ?? ""}|${point.az ?? ""}|${point.temperature ?? ""}`;
        pointsByKey.set(key, point);
      }
    });

    if (pointsByKey.size === 0) {
      return [];
    }

    return buildDenseTelemetryRowsFromPoints(
      Array.from(pointsByKey.values()),
      trendVisibleWindow.startMs,
      trendVisibleWindow.endMs,
    );
  }, [detailTileVersion, rangeController.activeQueryKey, trendDetailMode, trendVisibleWindow.endMs, trendVisibleWindow.startMs]);

  const hasDetailTelemetryData = useMemo(
    () => detailTelemetryData.some(hasDenseTelemetryValue),
    [detailTelemetryData],
  );
  const detailTelemetryDataWithRealtimeTail = useMemo(() => {
    const lastDetailValueTs = detailTelemetryData.reduce(
      (latest, row) => hasDenseTelemetryValue(row) ? Math.max(latest, row.ts) : latest,
      Number.NEGATIVE_INFINITY,
    );
    if (!Number.isFinite(lastDetailValueTs)) return detailTelemetryData;
    const rowsByTimestamp = new Map(detailTelemetryData.map((row) => [row.ts, row]));
    for (const row of timelineTelemetryData) {
      if (row.ts > lastDetailValueTs && hasDenseTelemetryValue(row)) {
        rowsByTimestamp.set(row.ts, row);
      }
    }
    return [...rowsByTimestamp.values()].sort((left, right) => left.ts - right.ts);
  }, [detailTelemetryData, timelineTelemetryData]);
  const detailLayerActive = Boolean(
    trendDetailMode
    && detailTileUx.mode === trendDetailMode
    && hasDetailTelemetryData,
  );
  const activeTelemetryData = detailLayerActive ? detailTelemetryDataWithRealtimeTail : timelineTelemetryData;
  const activeTelemetryGapStepMs = detailLayerActive
    ? estimateTelemetryGapStepMs(detailTelemetryDataWithRealtimeTail, trendVisibleWindow.endMs - trendVisibleWindow.startMs)
    : telemetryGapStepMs;
  const manualTelemetryStepMs = selectedTelemetryStepMs === "auto" ? null : selectedTelemetryStepMs;

  useEffect(() => {
    if (typeof selectedTelemetryStepMs !== "number") {
      return;
    }
    if (selectedTelemetryStepMs < activeTelemetryGapStepMs) {
      setSelectedTelemetryStepMs("auto");
    }
  }, [activeTelemetryGapStepMs, selectedTelemetryStepMs]);

  const displayTelemetryStepMs = manualTelemetryStepMs ?? activeTelemetryGapStepMs;
  const displayTelemetryData = useMemo(
    () => manualTelemetryStepMs
      ? bucketDenseTelemetryRows(
          activeTelemetryData,
          manualTelemetryStepMs,
          trendVisibleWindow.startMs,
          trendVisibleWindow.endMs,
        )
      : activeTelemetryData,
    [
      activeTelemetryData,
      manualTelemetryStepMs,
      trendVisibleWindow.endMs,
      trendVisibleWindow.startMs,
    ],
  );
  const displayTrendStatusBands = useMemo(
    () => {
      const visibleWindowMs = trendVisibleWindow.endMs - trendVisibleWindow.startMs;
      const conflictCheckedBands = trendStatusBands.filter((band) => {
        const isServerOffline = band.reason === "server_offline" || band.reason === "unclean_shutdown";
        if (!isServerOffline) {
          return true;
        }
        return !displayTelemetryData.some((row) => row.ts >= band.from && row.ts <= band.to && hasDenseTelemetryValue(row));
      });
      return normalizeOfflineStatusBands(conflictCheckedBands, {
        minimumDurationMs: getStatusBandMinimumDurationMs(visibleWindowMs, activeTelemetryGapStepMs),
        mergeToleranceMs: activeTelemetryGapStepMs,
        windowStartMs: trendVisibleWindow.startMs,
        windowEndMs: trendVisibleWindow.endMs,
      });
    },
    [
      activeTelemetryGapStepMs,
      displayTelemetryData,
      trendStatusBands,
      trendVisibleWindow.endMs,
      trendVisibleWindow.startMs,
    ],
  );
  const overviewTrendStatusBands = useMemo(
    () => {
      const conflictCheckedBands = trendStatusBands.filter((band) => {
        const isServerOffline = band.reason === "server_offline" || band.reason === "unclean_shutdown";
        if (!isServerOffline) {
          return true;
        }
        return !timelineTelemetryData.some((row) => row.ts >= band.from && row.ts <= band.to && hasDenseTelemetryValue(row));
      });
      return normalizeOfflineStatusBands(conflictCheckedBands, {
        minimumDurationMs: getStatusBandMinimumDurationMs(loadedTrendWindowMs, telemetryGapStepMs),
        mergeToleranceMs: telemetryGapStepMs,
        windowStartMs: telemetryWindowStartMs,
        windowEndMs: telemetryWindowAnchorMs,
      });
    },
    [
      loadedTrendWindowMs,
      telemetryGapStepMs,
      telemetryWindowAnchorMs,
      telemetryWindowStartMs,
      timelineTelemetryData,
      trendStatusBands,
    ],
  );
  const trendMissingDataBands = useMemo(
    () => buildAdaptiveMissingDataBands(
      activeTelemetryData,
      trendStatusBands,
      {
        thresholdMs: getAdaptiveMissingDataThresholdMs(
          trendVisibleWindow.endMs - trendVisibleWindow.startMs,
          activeTelemetryGapStepMs,
        ),
        expectedStepMs: activeTelemetryGapStepMs,
        windowStartMs: trendVisibleWindow.startMs,
        windowEndMs: trendVisibleWindow.endMs,
        hasValue: hasDenseTelemetryValue,
      },
    ),
    [
      activeTelemetryData,
      activeTelemetryGapStepMs,
      trendStatusBands,
      trendVisibleWindow.endMs,
      trendVisibleWindow.startMs,
    ],
  );
  const overviewMissingDataBands = useMemo(
    () => buildAdaptiveMissingDataBands(
      timelineTelemetryData,
      trendStatusBands,
      {
        thresholdMs: getAdaptiveMissingDataThresholdMs(loadedTrendWindowMs, telemetryGapStepMs),
        expectedStepMs: telemetryGapStepMs,
        windowStartMs: telemetryWindowStartMs,
        windowEndMs: telemetryWindowAnchorMs,
        hasValue: hasDenseTelemetryValue,
      },
    ),
    [
      loadedTrendWindowMs,
      telemetryGapStepMs,
      telemetryWindowAnchorMs,
      telemetryWindowStartMs,
      timelineTelemetryData,
      trendStatusBands,
    ],
  );
  const visibleTelemetryData = useMemo(
    () => displayTelemetryData.filter(
      (row) => row.ts >= trendVisibleWindow.startMs && row.ts <= trendVisibleWindow.endMs,
    ),
    [displayTelemetryData, trendVisibleWindow.endMs, trendVisibleWindow.startMs],
  );
  const visibleTelemetryHoverPoints = useMemo(
    () => visibleTelemetryData.map((row) => ({ ts: row.ts, telemetryUuid: row.telemetryUuid })),
    [visibleTelemetryData],
  );

  const playbackRows = useMemo(
    () =>
      visibleTelemetryData.filter(
        (row) =>
          (
            (typeof row.temp === "number" && Number.isFinite(row.temp))
            || (typeof row.ax === "number" && Number.isFinite(row.ax))
            || (typeof row.ay === "number" && Number.isFinite(row.ay))
            || (typeof row.az === "number" && Number.isFinite(row.az))
            || (typeof row.vrmsX === "number" && Number.isFinite(row.vrmsX))
            || (typeof row.vrmsY === "number" && Number.isFinite(row.vrmsY))
            || (typeof row.vrmsZ === "number" && Number.isFinite(row.vrmsZ))
            || (typeof row.drmsX === "number" && Number.isFinite(row.drmsX))
            || (typeof row.drmsY === "number" && Number.isFinite(row.drmsY))
            || (typeof row.drmsZ === "number" && Number.isFinite(row.drmsZ))
          ),
      ),
    [visibleTelemetryData],
  );
  const playbackSpeedMultiplier = PLAYBACK_SPEED_OPTIONS[playbackSpeedIndex] ?? 1;
  const playbackStepDelayMs = Math.max(80, Math.round(PLAYBACK_BASE_STEP_MS / playbackSpeedMultiplier));
  const playbackSpeedLabel = `${playbackSpeedMultiplier}x`;
  const playbackDelayLabel = `${(playbackStepDelayMs / 1000).toFixed(playbackStepDelayMs % 1000 === 0 ? 0 : 2)}s/điểm`;
  const playbackCanStart = playbackRows.length > 0;
  const handleStartPlayback = useCallback(() => {
    if (playbackRows.length === 0) {
      stopPlayback();
      return;
    }
    clearPlaybackTimer();
    setPlaybackCursorTs((currentTs) => {
      const currentIndex = typeof currentTs === "number"
        ? playbackRows.findIndex((row) => row.ts === currentTs)
        : -1;
      const nextIndex = currentIndex >= 0 && currentIndex < playbackRows.length - 1 ? currentIndex : 0;
      return playbackRows[nextIndex]?.ts ?? null;
    });
    setPlaybackRunning(true);
  }, [clearPlaybackTimer, playbackRows, stopPlayback]);
  const handleDecreasePlaybackSpeed = useCallback(() => {
    setPlaybackSpeedIndex((current) => Math.max(0, current - 1));
  }, []);
  const handleIncreasePlaybackSpeed = useCallback(() => {
    setPlaybackSpeedIndex((current) => Math.min(PLAYBACK_SPEED_OPTIONS.length - 1, current + 1));
  }, []);
  const accelTrendYDomain = useMemo<[number, number]>(
    () => [0, accelAmplitudeLimit],
    [accelAmplitudeLimit],
  );
  const vrmsTrendYDomain = useMemo<[number, number]>(
    () => [0, vrmsAmplitudeLimit],
    [vrmsAmplitudeLimit],
  );
  const drmsTrendYDomain = useMemo<[number, number]>(
    () => [0, drmsAmplitudeLimit],
    [drmsAmplitudeLimit],
  );
  const trendTimeDomain = useMemo<[number, number]>(
    () => [trendVisibleWindow.startMs, trendVisibleWindow.endMs],
    [trendVisibleWindow.endMs, trendVisibleWindow.startMs],
  );
  const tempTrendSeries = useMemo<TrendSeriesConfig[]>(
    () => [{
      key: "temp",
      name: "Nhiệt độ",
      color: C.primary,
      strokeWidth: TEMPERATURE_TREND_STROKE_WIDTH,
      latestLabelFormatter: (value) => `${value.toFixed(2)}°C`,
    }],
    [C.primary],
  );
  const accelTrendSeries = useMemo<TrendSeriesConfig[]>(
    () => [
      { key: "ax", name: `${chartAxisLabels.ax} RMS`, color: AXIS_SERIES_COLORS.ax, strokeWidth: AXIS_TREND_STROKE_WIDTH },
      { key: "ay", name: `${chartAxisLabels.ay} RMS`, color: AXIS_SERIES_COLORS.ay, strokeWidth: AXIS_TREND_STROKE_WIDTH },
      { key: "az", name: `${chartAxisLabels.az} RMS`, color: AXIS_SERIES_COLORS.az, strokeWidth: AXIS_TREND_STROKE_WIDTH },
    ],
    [chartAxisLabels.ax, chartAxisLabels.ay, chartAxisLabels.az],
  );
  const vrmsTrendSeries = useMemo<TrendSeriesConfig[]>(
    () => [
      { key: "vrmsX", name: `${chartAxisLabels.ax} VRMS`, color: AXIS_SERIES_COLORS.ax, strokeWidth: AXIS_TREND_STROKE_WIDTH },
      { key: "vrmsY", name: `${chartAxisLabels.ay} VRMS`, color: AXIS_SERIES_COLORS.ay, strokeWidth: AXIS_TREND_STROKE_WIDTH },
      { key: "vrmsZ", name: `${chartAxisLabels.az} VRMS`, color: AXIS_SERIES_COLORS.az, strokeWidth: AXIS_TREND_STROKE_WIDTH },
    ],
    [chartAxisLabels.ax, chartAxisLabels.ay, chartAxisLabels.az],
  );
  const drmsTrendSeries = useMemo<TrendSeriesConfig[]>(
    () => [
      { key: "drmsX", name: `${chartAxisLabels.ax} DRMS`, color: AXIS_SERIES_COLORS.ax, strokeWidth: AXIS_TREND_STROKE_WIDTH },
      { key: "drmsY", name: `${chartAxisLabels.ay} DRMS`, color: AXIS_SERIES_COLORS.ay, strokeWidth: AXIS_TREND_STROKE_WIDTH },
      { key: "drmsZ", name: `${chartAxisLabels.az} DRMS`, color: AXIS_SERIES_COLORS.az, strokeWidth: AXIS_TREND_STROKE_WIDTH },
    ],
    [chartAxisLabels.ax, chartAxisLabels.ay, chartAxisLabels.az],
  );
  const showInitialLoading = rangeBusy && telemetryPoints.length === 0;
  const chartHasTelemetry = telemetryPoints.length > 0;
  const trendOverviewResetKey = useMemo(
    () => rangeController.activeQueryKey
      || `${sensor?.id ?? "no-sensor"}:${Math.round(telemetryWindowStartMs / 1000)}:${Math.round(telemetryWindowAnchorMs / 1000)}`,
    [rangeController.activeQueryKey, sensor?.id, telemetryWindowAnchorMs, telemetryWindowStartMs],
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

  const telemetryStepLabel = `${formatTelemetryStepMs(displayTelemetryStepMs)}/điểm`;

  useEffect(() => {
    const targetSensorId = sensor?.id;
    if (!targetSensorId || (rangeController.state.status === "loading" && telemetryPoints.length === 0) || trendPanning) {
      clearDetailTileFetchTimer();
      return;
    }
    if (!trendDetailMode) {
      clearDetailTileFetchTimer();
      setDetailTileUx((current) => current.phase === "idle" && current.mode === null
        ? current
        : { phase: "idle", pendingTiles: 0, mode: null });
      return;
    }

    const candidateTiles = buildTelemetryDetailTileRequests({
      deviceId: targetSensorId,
      rangeKey: rangeController.activeQueryKey,
      visibleStartMs: trendVisibleWindow.startMs,
      visibleEndMs: trendVisibleWindow.endMs,
      loadedStartMs: telemetryWindowStartMs,
      loadedEndMs: telemetryWindowAnchorMs,
      cachedKeys: new Set([
        ...detailTileCacheRef.current,
        ...detailTileInFlightRef.current,
      ]),
    });
    if (candidateTiles.length === 0) {
      clearDetailTileFetchTimer();
      setDetailTileUx({
        phase: "ready",
        pendingTiles: 0,
        mode: trendDetailMode,
        loadedAtMs: Date.now(),
      });
      return;
    }

    setDetailTileUx({
      phase: "queued",
      pendingTiles: candidateTiles.length,
      mode: trendDetailMode,
    });
    clearDetailTileFetchTimer();
    const requestSeq = detailTileRequestSeqRef.current + 1;
    detailTileRequestSeqRef.current = requestSeq;
    detailTileFetchTimerRef.current = window.setTimeout(() => {
      detailTileFetchTimerRef.current = null;
      setDetailTileUx({
        phase: "loading",
        pendingTiles: candidateTiles.length,
        mode: trendDetailMode,
      });
      void (async () => {
        for (let index = 0; index < candidateTiles.length; index += 1) {
          const tile = candidateTiles[index];
          if (!tile) {
            continue;
          }
          if (requestSeq !== detailTileRequestSeqRef.current) {
            return;
          }
          if (detailTileCacheRef.current.has(tile.cacheKey) || detailTileInFlightRef.current.has(tile.cacheKey)) {
            continue;
          }

          detailTileInFlightRef.current.add(tile.cacheKey);
          try {
            const points = await requestTelemetryDetailTile(targetSensorId, tile);
            if (requestSeq !== detailTileRequestSeqRef.current) {
              return;
            }
            detailTileEntriesRef.current.set(tile.cacheKey, {
              tile,
              points,
              loadedAtMs: Date.now(),
            });
            detailTileCacheRef.current.add(tile.cacheKey);
            setDetailTileVersion((version) => version + 1);
          } catch {
            detailTileCacheRef.current.delete(tile.cacheKey);
            detailTileEntriesRef.current.delete(tile.cacheKey);
          } finally {
            detailTileInFlightRef.current.delete(tile.cacheKey);
            if (requestSeq === detailTileRequestSeqRef.current) {
              const remainingTiles = Math.max(0, candidateTiles.length - index - 1);
              setDetailTileUx({
                phase: remainingTiles > 0 ? "loading" : "ready",
                pendingTiles: remainingTiles,
                mode: trendDetailMode,
                loadedAtMs: remainingTiles > 0 ? undefined : Date.now(),
              });
            }
          }
        }
      })();
    }, DETAIL_TILE_FETCH_DEBOUNCE_MS);

    return () => {
      clearDetailTileFetchTimer();
    };
  }, [
    clearDetailTileFetchTimer,
    requestTelemetryDetailTile,
    sensor?.id,
    rangeController.state.status,
    rangeController.activeQueryKey,
    telemetryPoints.length,
    telemetryWindowAnchorMs,
    telemetryWindowStartMs,
    trendDetailMode,
    trendPanning,
    trendVisibleWindow.endMs,
    trendVisibleWindow.startMs,
  ]);
  useEffect(() => {
    clearPlaybackTimer();
    if (!playbackRunning) {
      return;
    }
    if (playbackRows.length === 0) {
      stopPlayback();
      return;
    }

    playbackTimerRef.current = window.setTimeout(() => {
      playbackTimerRef.current = null;
      const currentIndex = typeof playbackCursorTs === "number"
        ? playbackRows.findIndex((row) => row.ts === playbackCursorTs)
        : -1;
      const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
      if (nextIndex >= playbackRows.length) {
        stopPlayback();
        return;
      }
      setPlaybackCursorTs(playbackRows[nextIndex]?.ts ?? null);
    }, playbackStepDelayMs);

    return () => {
      clearPlaybackTimer();
    };
  }, [clearPlaybackTimer, playbackCursorTs, playbackRows, playbackRunning, playbackStepDelayMs, stopPlayback]);

  useEffect(() => {
    if (!visualizeOpen) {
      stopPlayback();
    }
  }, [stopPlayback, visualizeOpen]);

  useEffect(() => {
    if (!sensor) {
      return;
    }
    resetDetailTileCache();
    setTrendViewWindow(null);
    setTrendPanning(false);
    setCalendarPopoverOpen(false);
    setCalendarHoverDate(null);
    setCalendarMonthCursor(startOfMonthLocal(new Date()));
    setCalendarAvailabilityByMonth({});
    setCalendarAvailabilityLoadingKey(null);
    setCalendarAvailabilityError("");
    setStatusHistoryItems([]);
    statusHistoryRequestSeqRef.current += 1;
    setPlaybackRunning(false);
    setPlaybackCursorTs(null);
    setPlaybackSpeedIndex(DEFAULT_PLAYBACK_SPEED_INDEX);
  }, [resetDetailTileCache, sensor?.id]);

  if (!sensor) return null;

  const chartTextStyle = { fill: wallboard ? "#c5d5e8" : C.textMuted, fontSize: wallboard ? 22 : 10 };
  const gridColor = C.border + "44";
  const fftRenderByAxis = {
    x: fftRenderX,
    y: fftRenderY,
    z: fftRenderZ,
  } satisfies Record<SpectrumAxis, typeof fftRenderX>;

  const renderFftAxisLabelButton = (axis: DeviceAxisKey, spectrumAxis: SpectrumAxis) => {
    const color = AXIS_SERIES_COLORS[axis];
    const axisDisplayLabel = chartAxisLabels[axis];
    return (
      <button
        className="dc-fft-axis-label-button"
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openAxisRenameModal(axis);
        }}
        disabled={axisRenameSaving}
        title={`Đổi tên ${axisDisplayLabel}`}
        aria-label={`Đổi tên ${axisDisplayLabel}`}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          flex: "0 1 auto",
          width: "fit-content",
          maxWidth: "46%",
          minHeight: 22,
          minWidth: 0,
          boxSizing: "border-box",
          border: `1px solid ${color}38`,
          borderRadius: 6,
          background: `${color}12`,
          color,
          fontSize: "0.56rem",
          fontWeight: 800,
          lineHeight: 1.15,
          padding: "2px 18px 2px 6px",
          cursor: axisRenameSaving ? "wait" : "pointer",
          opacity: axisRenameSaving ? 0.68 : 1,
          transition: "transform 0.14s ease, border-color 0.14s ease, background 0.14s ease",
        }}
      >
        <span aria-hidden="true" style={{ flex: "0 0 auto", fontSize: "0.48rem", lineHeight: 1 }}>■</span>
        <span style={{ display: "inline-block", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.15 }}>
          {chartAxisLabels[axis]} <span style={{ opacity: 0.72 }}>({spectrumAxis})</span>
        </span>
        <PencilLine
          size={8}
          strokeWidth={2.3}
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 5,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
          }}
        />
      </button>
    );
  };

  const renderFftAxisCard = ({ deviceAxis, spectrumAxis }: FftAxisDisplayItem) => {
    const color = AXIS_SERIES_COLORS[deviceAxis];
    const data = fftRenderByAxis[spectrumAxis];
    const peak = spectrumPeakByAxis[spectrumAxis];

    return (
      <div
        className="dc-fft-card"
        key={deviceAxis}
        style={{
          position: "relative",
          background: C.card,
          border: `1px solid ${C.cardBorder}`,
          borderRadius: 10,
          padding: modalLayout.fftCardPadding,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, marginBottom: 1, padding: 0, minHeight: modalLayout.fftCardHeaderHeight, minWidth: 0, overflow: "hidden" }}>
          {renderFftAxisLabelButton(deviceAxis, spectrumAxis)}
          <div
            className="dc-fft-peak-summary"
            style={{
              color: C.textMuted,
              fontSize: "0.56rem",
              fontWeight: 600,
              minWidth: 0,
              maxWidth: "54%",
              flex: "0 1 auto",
              textAlign: "right",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hoverSpectrumBusy ? SPECTRUM_LOADING_LABEL : formatPeakSummary(peak.frequencyHz, peak.amplitude, "m/s²")}
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <SpectrumZoomChart
            data={data}
            color={color}
            axisLabelColor={chartTextStyle.fill}
            gridColor={gridColor}
            maxHz={spectrumMaxHzByAxis[spectrumAxis]}
            C={C}
            height={modalLayout.spectrumHeight}
            yMax={effectiveSpectrumYAxisMax}
            onYAxisZoom={handleSpectrumYAxisZoom}
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
              <SpectrumLoadingState C={C} accentColor={color} overlay />
            </div>
          ) : data.length === 0 ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 8,
                overflow: "hidden",
                pointerEvents: "none",
              }}
            >
              <SpectrumNoDataState C={C} accentColor={color} />
            </div>
          ) : null}
        </div>
        <div
          className="dc-fft-axis-footer"
          style={{
            textAlign: "right",
            color: C.textMuted,
            fontSize: "0.58rem",
            paddingRight: 6,
            marginTop: -2,
            minHeight: modalLayout.fftAxisFooterHeight,
            lineHeight: `${modalLayout.fftAxisFooterHeight}px`,
            visibility: hoverSpectrumBusy || data.length === 0 ? "hidden" : "visible",
          }}
        >
          Hz
        </div>
      </div>
    );
  };

  const trendCharts = [
    {
      key: "temperature",
      title: "Đồ thị nhiệt độ (°C)",
      icon: <Thermometer size={13} strokeWidth={2} />,
      series: tempTrendSeries,
      yDomain: tempDomain,
    },
    {
      key: "acceleration",
      title: "Đồ thị gia tốc (m/s²)",
      icon: <Activity size={13} strokeWidth={2} />,
      series: accelTrendSeries,
      yDomain: accelTrendYDomain,
      onYAxisZoom: handleAccelYAxisZoom,
      showTelemetryStatus: true,
    },
    {
      key: "velocity",
      title: "Đồ thị vận tốc RMS (mm/s)",
      icon: <Activity size={13} strokeWidth={2} />,
      series: vrmsTrendSeries,
      yDomain: vrmsTrendYDomain,
      onYAxisZoom: handleVrmsYAxisZoom,
    },
    {
      key: "displacement",
      title: "Đồ thị biên độ RMS (mm)",
      icon: <Activity size={13} strokeWidth={2} />,
      series: drmsTrendSeries,
      yDomain: drmsTrendYDomain,
      onYAxisZoom: handleDrmsYAxisZoom,
    },
  ] satisfies Array<{
    key: string;
    title: string;
    icon: React.ReactNode;
    series: TrendSeriesConfig[];
    yDomain: [number, number];
    onYAxisZoom?: (next: { deltaY: number }) => void;
    showTelemetryStatus?: boolean;
  }>;

  return (
    <>
      <div
        ref={modalRootRef}
        className="dc-chart-modal-root"
        data-ux="chart-modal"
        data-ux-chart-ready={showInitialLoading ? "false" : "true"}
        data-ux-telemetry-points={telemetryPoints.length}
        data-ux-chart-range={selectedRange.kind === "relative" ? selectedRange.preset : selectedRange.kind}
        data-ux-chart-range-status={rangeController.state.status}
        style={{
        position: "relative",
        zIndex: 1,
        transform: visible ? "translateX(0)" : "translateX(18px)",
        opacity: visible ? 1 : 0,
        transition: `transform ${CHART_MODAL_TRANSITION_MS}ms cubic-bezier(0.32,0.72,0,1), opacity ${CHART_MODAL_TRANSITION_MS}ms ease`,
        width: "100%",
        height: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 18px 42px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
      >
        {/* Header */}
        <div style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: modalLayout.headerPadding,
          display: "grid",
          gridTemplateColumns: modalLayout.viewportWidth < 1180 ? "1fr" : "minmax(0, 1fr) auto",
          alignItems: "start",
          gap: 5,
          flexShrink: 0,
          overflow: "visible",
          position: "relative",
          zIndex: 30,
        }}>

	          <div style={{ minWidth: 0, display: "grid", gap: 1 }}>
	            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, minWidth: 0, minHeight: 32 }}>
              <span
                className="dc-chart-modal-device-title"
                title={sensor.name}
	                style={{
	                  color: C.textBright,
	                  fontSize: "0.84rem",
	                  fontWeight: 800,
	                  lineHeight: 1.18,
	                  minWidth: 0,
	                  overflow: "hidden",
	                  textOverflow: "ellipsis",
	                  whiteSpace: "nowrap",
	                }}
	              >
	                {sensor.name}
	              </span>
	              <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
                <button
                  className="dc-chart-icon-button"
                  type="button"
                  aria-label="Tùy chọn"
                  onClick={openDataSettings}
                  disabled={clearingDeviceData}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 7,
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
                  className="dc-chart-icon-tooltip"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "calc(100% + 9px)",
                    transform: settingsTooltipVisible ? "translate(0, 0)" : "translate(0, -3px)",
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              rowGap: 5,
              flexWrap: "wrap",
              justifyContent: "flex-end",
              minWidth: 0,
            }}
          >
            <div
              className="dc-chart-range-quick"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}
              aria-label="Khoảng thời gian nhanh"
            >
              {QUICK_CHART_RANGE_PRESETS.map((preset) => {
                const active = selectedRange.kind === "relative" && selectedRange.preset === preset;
                const loading = historyPresetLoading === preset;
                return (
                  <button
                    key={preset}
                    data-ux-range-preset={preset}
                    className="dc-chart-control-button"
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleHistoryPresetSelect(preset)}
                    style={{
                      height: 34,
                      minWidth: 48,
                      borderRadius: 999,
                      border: `1px solid ${active ? C.primary : C.border}`,
                      padding: "0 10px",
                      background: active ? C.primaryBg : C.surface,
                      color: active ? C.primary : C.textBase,
                      fontSize: "0.66rem",
                      fontWeight: 800,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                    }}
                  >
                    <span>{CHART_RANGE_PRESET_LABELS[preset]}</span>
                    {loading ? (
                      <span style={{ width: 9, height: 9, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div ref={calendarPopoverRef} style={{ position: "relative" }}>
              <button
                className="dc-chart-control-button"
                type="button"
                onClick={handleToggleCalendarPopover}
                style={{
                  height: 34,
                  borderRadius: 999,
                  border: `1px solid ${calendarPopoverOpen ? C.primary : C.border}`,
                  padding: "0 9px",
                  background: calendarPopoverOpen ? C.primaryBg : C.surface,
                  color: calendarPopoverOpen ? C.primary : C.textBase,
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 116,
                  justifyContent: "space-between",
                  opacity: 1,
                  transition: "all 0.14s ease",
                }}
                title="Chọn ngày dữ liệu"
                aria-label="Chọn ngày dữ liệu"
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <CalendarDays size={13} strokeWidth={2.1} />
                  <span>{selectedRange.kind === "calendar-day" ? formatChartRangeLabel(selectedRange) : "Lịch"}</span>
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
                  className="calendar-popover-anim dc-chart-calendar-popover"
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
                      aria-label="Chuyển sang tháng trước"
                      title="Chuyển sang tháng trước"
                      onClick={() => handleCalendarMonthShift(-1)}
                      style={{
                        width: 34,
                        height: 34,
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
                      <div className="dc-chart-calendar-month" style={{ color: C.textBright, fontSize: "0.73rem", fontWeight: 800, letterSpacing: "0.01em" }}>
                        {calendarMonthLabel}
                      </div>
                      <div className="dc-chart-calendar-summary" style={{ color: C.textMuted, fontSize: "0.62rem" }}>
                        {calendarDaysWithDataCount > 0
                          ? `${calendarDaysWithDataCount} ngày có dữ liệu`
                          : "Chưa có dữ liệu trong tháng"}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Chuyển sang tháng sau"
                      title="Chuyển sang tháng sau"
                      onClick={() => handleCalendarMonthShift(1)}
                      style={{
                        width: 34,
                        height: 34,
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
                      const disabled = cell.isFuture;
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
                    <div style={{ color: C.textMuted, fontSize: "0.6rem", marginLeft: "auto" }}>
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
                className="dc-chart-control-button"
                type="button"
                onClick={() => {
                  setCalendarPopoverOpen(false);
                  setCustomRangeOpen(false);
                  setTimePresetMenuOpen((open) => !open);
                }}
                style={{
                  height: 34,
                  borderRadius: 999,
                  border: `1px solid ${EXTRA_CHART_RANGE_PRESETS.includes(activeHistoryPreset as ChartRangePreset) || selectedRange.kind === "custom" ? C.primary : C.border}`,
                  padding: "0 9px",
                  background: EXTRA_CHART_RANGE_PRESETS.includes(activeHistoryPreset as ChartRangePreset) || selectedRange.kind === "custom" ? C.primaryBg : C.surface,
                  color: EXTRA_CHART_RANGE_PRESETS.includes(activeHistoryPreset as ChartRangePreset) || selectedRange.kind === "custom" ? C.primary : C.textBase,
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  minWidth: 82,
                  justifyContent: "space-between",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Clock3 size={13} strokeWidth={2.1} />
                  Thêm
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
                  className="dc-time-preset-menu"
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
                  {EXTRA_CHART_RANGE_PRESETS.map((preset) => {
                    const active = activeHistoryPreset === preset;
                    const loading = historyPresetLoading === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setTimePresetMenuOpen(false);
                          handleHistoryPresetSelect(preset);
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
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0 9px",
                        }}
                      >
                        <span>{CHART_RANGE_PRESET_LABELS[preset]}</span>
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
                  <div style={{ height: 1, background: C.border, margin: "5px 3px" }} />
                  <button
                    type="button"
                    onClick={() => {
                      const currentRange = selectedRange;
                      setCustomRangeFrom(formatDateTimeLocalValue(currentRange.fromMs));
                      setCustomRangeTo(formatDateTimeLocalValue(Math.min(Date.now(), currentRange.toMs)));
                      setCustomRangeError("");
                      setTimePresetMenuOpen(false);
                      setCustomRangeOpen(true);
                    }}
                    style={{
                      width: "100%",
                      height: 32,
                      border: "none",
                      borderRadius: 8,
                      background: selectedRange.kind === "custom" ? C.primaryBg : "transparent",
                      color: selectedRange.kind === "custom" ? C.primary : C.textBase,
                      fontSize: "0.67rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 9px",
                    }}
                  >
                    Khoảng tùy chỉnh
                  </button>
                </div>
              ) : null}
              {customRangeOpen ? (
                <div
                  className="dc-time-preset-menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    width: 284,
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                    background: C.surface,
                    boxShadow: "0 14px 28px rgba(0, 0, 0, 0.32)",
                    padding: 10,
                    zIndex: 40,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <strong style={{ color: C.textBright, fontSize: "0.7rem" }}>Khoảng thời gian tùy chỉnh</strong>
                  <label style={{ display: "grid", gap: 4, color: C.textMuted, fontSize: "0.6rem", fontWeight: 700 }}>
                    Bắt đầu
                    <input
                      type="datetime-local"
                      value={customRangeFrom}
                      max={customRangeTo}
                      onChange={(event) => setCustomRangeFrom(event.currentTarget.value)}
                      style={{ height: 34, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.textBase, padding: "0 8px", colorScheme: "dark" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, color: C.textMuted, fontSize: "0.6rem", fontWeight: 700 }}>
                    Kết thúc
                    <input
                      type="datetime-local"
                      value={customRangeTo}
                      min={customRangeFrom}
                      max={formatDateTimeLocalValue(Date.now())}
                      onChange={(event) => setCustomRangeTo(event.currentTarget.value)}
                      style={{ height: 34, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.textBase, padding: "0 8px", colorScheme: "dark" }}
                    />
                  </label>
                  {customRangeError ? <span style={{ color: C.danger, fontSize: "0.6rem" }}>{customRangeError}</span> : null}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                    <button type="button" onClick={() => setCustomRangeOpen(false)} style={{ height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.textMuted, padding: "0 10px", cursor: "pointer", fontWeight: 700 }}>Hủy</button>
                    <button type="button" onClick={handleCustomRangeApply} style={{ height: 30, borderRadius: 8, border: `1px solid ${C.primary}`, background: C.primaryBg, color: C.primary, padding: "0 11px", cursor: "pointer", fontWeight: 800 }}>Áp dụng</button>
                  </div>
                </div>
              ) : null}
            </div>

            {rangeBusy && rangeController.state.pendingRange ? (
              <span
                role="status"
                style={{
                  height: 30,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  border: `1px solid ${C.primary}55`,
                  background: C.primaryBg,
                  color: C.primary,
                  padding: "0 9px",
                  fontSize: "0.62rem",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                {formatChartRangeLoadingLabel(
                  rangeController.state.pendingRange,
                  rangeController.state.status === "refreshing",
                )}
              </span>
            ) : rangeController.state.status === "error" ? (
              <span role="alert" title={rangeController.state.error ?? undefined} style={{ color: C.danger, fontSize: "0.62rem", fontWeight: 700 }}>
                Không tải được khoảng mới; đang giữ dữ liệu hiện tại.
              </span>
            ) : null}

            {hasYAxisZoom ? (
              <button
                className="dc-chart-control-button"
                type="button"
                onClick={handleResetYAxisZoom}
                title="Reset zoom trục Y"
                aria-label="Reset zoom trục Y"
                style={{
                  height: 34,
                  borderRadius: 999,
                  border: `1px solid ${C.primary}`,
                  padding: "0 9px",
                  background: C.primaryBg,
                  color: C.primary,
                  fontSize: "0.66rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <RotateCcw size={13} strokeWidth={2.2} />
                <span>Reset zoom</span>
              </button>
            ) : null}

            <button
              className="dc-chart-control-button"
              type="button"
              onClick={toggleVisualizeSidebar}
              aria-pressed={visualizeOpen ? "true" : "false"}
              title={visualizeOpen ? "Ẩn mô hình 3D" : "Mở mô hình 3D"}
              style={{
                height: 34,
                borderRadius: 999,
                border: `1px solid ${visualizeOpen ? C.primary : C.border}`,
                padding: "0 10px",
                background: visualizeOpen
                  ? `linear-gradient(135deg, ${C.primaryBg}, ${C.surface})`
                  : C.surface,
                color: visualizeOpen ? C.primary : C.textBase,
                fontSize: "0.66rem",
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                boxShadow: visualizeOpen ? `0 0 0 1px ${C.primary}22, 0 8px 18px ${C.primary}18` : "none",
                transition: "border-color 0.14s ease, background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease",
              }}
            >
              <Box size={13} strokeWidth={2.2} />
              <span>Visualize</span>
            </button>

            <button
              className="dc-chart-control-button"
              type="button"
              disabled={trendAtLatest}
              onClick={handleResetTrendViewToLatest}
              style={{
                height: 34,
                borderRadius: 999,
                border: `1px solid ${trendAtLatest ? C.border : C.primary}`,
                padding: "0 10px",
                background: trendAtLatest ? C.surface : C.primaryBg,
                color: trendAtLatest ? C.textMuted : C.primary,
                fontSize: "0.66rem",
                fontWeight: 700,
                display: selectedRange.kind === "relative" ? "inline-flex" : "none",
                cursor: trendAtLatest ? "default" : "pointer",
                opacity: trendAtLatest ? 0.7 : 1,
              }}
            >
              Mới nhất
            </button>

            {pinned && onCollapse ? (
              <button
                type="button"
                className="dc-chart-panel-collapse-button"
                aria-label="Thu gọn biểu đồ"
                title="Thu gọn biểu đồ"
                onClick={onCollapse}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.textBase,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <PanelRightClose size={14} strokeWidth={2.2} />
              </button>
            ) : null}

            {/* X close button – prominent */}
            {!pinned ? (
              <button
              type="button"
              onClick={handleClose}
              title="Đóng"
              aria-label="Đóng khung dữ liệu thiết bị"
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
            ) : null}
          </div>
        </div>

        <div
          ref={modalBodyRef}
          data-ux="chart-modal-body"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            position: "relative",
            display: "flex",
            alignItems: "stretch",
            overflow: "hidden",
            background: C.surface,
          }}
        >
          {/* Scrollable content */}
          <div
            data-ux="chart-modal-scroll"
            style={{
              flex: "1 1 auto",
              height: "100%",
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              overflowY: modalLayout.bodyScrollable ? "auto" : "hidden",
              overflowX: "hidden",
              padding: modalLayout.contentPadding,
              overscrollBehavior: "contain",
            }}
          >
          <style>{`
            @keyframes chartSpin { to { transform: rotate(360deg); } }
            @keyframes chartDotPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
            @keyframes detailTilePulse {
              0%, 100% { opacity: 0.45; transform: scale(0.85); }
              50% { opacity: 1; transform: scale(1.18); }
            }
            @keyframes visualizeSidebarIn {
              from {
                opacity: 0;
                transform: translateX(18px);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }
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
              alignItems: "stretch",
              opacity: rangeBusy && telemetryPoints.length > 0 ? 0.78 : 1,
              transition: "opacity 150ms ease",
            }}
          >
            {trendCharts.map((chart) => (
              <ChartSection
                key={chart.key}
                title={chart.title}
                icon={chart.icon}
                C={C}
                titleGap={modalLayout.chartTitleGap}
                cardPadding={modalLayout.chartCardPadding}
              >
                {showInitialLoading ? (
                  <div className="dc-chart-loading-state" style={{ height: modalLayout.chartHeight, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: C.textMuted, fontSize: "0.74rem" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.primary, animation: "chartSpin 0.8s linear infinite" }} />
                    <div>Đang tải dữ liệu lịch sử...</div>
                  </div>
                ) : (
                  <div onContextMenu={handleTelemetryChartUnpin} style={{ position: "relative" }}>
                    <TelemetryTrendChart
                      data={visibleTelemetryData}
                      dataSource={detailLayerActive ? "detail" : rangeController.dataSource}
                      hoverPoints={visibleTelemetryHoverPoints}
                      series={chart.series}
                      statusBands={displayTrendStatusBands}
                      missingDataBands={trendMissingDataBands}
                      timeDomain={trendTimeDomain}
                      yDomain={chart.yDomain}
                      hoverTarget={trendHoverTarget}
                      pinnedTarget={spectrumPinnedTarget}
                      playheadTimestampMs={playbackCursorTs}
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
                      onYAxisZoom={chart.onYAxisZoom}
                      onViewportPanChange={handleTrendViewportPanChange}
                      onViewportPanStateChange={handleTrendPanStateChange}
                      onLeave={handleTelemetryChartLeave}
                    />
                    {chart.showTelemetryStatus && !chartHasTelemetry ? (
                      <div className="dc-chart-empty-state" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: "0.74rem", pointerEvents: "none", padding: "0 12px", boxSizing: "border-box", maxWidth: "100%", textAlign: "center", overflow: "hidden" }}>
                        <span style={{ display: "block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Chưa có dữ liệu</span>
                      </div>
                    ) : chart.showTelemetryStatus && rangeBusy ? (
                      <div className="dc-chart-loading-state" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.10)", backdropFilter: "blur(1px)", color: C.textMuted, fontSize: "0.72rem", pointerEvents: "none" }}>Đang cập nhật...</div>
                    ) : null}
                  </div>
                )}
              </ChartSection>
            ))}
          </div>

          {/* Bottom row: FFT axes in one row */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                marginBottom: modalLayout.fftHeaderGap,
                minHeight: modalLayout.fftSectionHeaderHeight,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", minWidth: 0 }}>
                <span style={{ color: C.primary }}><BarChart3 size={13} strokeWidth={2} /></span>
                <span className="dc-fft-section-title" style={{ color: C.textBright, fontSize: "0.74rem", fontWeight: 700 }}>Phổ tần số FFT</span>
                <button
                  className="dc-chart-control-button"
                  type="button"
                  onClick={() => {
                    setPositionAxisRenameDrafts(motorAxisLabels);
                    setPositionAxisRenameError("");
                    setPositionConfigOpen(true);
                  }}
                  title="Mở cấu hình vị trí motor và cảm biến"
                  aria-label="Mở cấu hình vị trí motor và cảm biến"
                  onMouseEnter={(event) => {
                    event.currentTarget.style.transform = "translateY(-1px)";
                    event.currentTarget.style.borderColor = "rgba(20,184,166,0.55)";
                    event.currentTarget.style.boxShadow = "0 7px 16px rgba(15,23,42,0.14)";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.transform = "translateY(0)";
                    event.currentTarget.style.borderColor = C.border;
                    event.currentTarget.style.boxShadow = "none";
                  }}
                  style={{
                    height: 22,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    padding: "0 6px",
                    background: C.surface,
                    color: C.textBase,
                    fontSize: "0.58rem",
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                    transition: "transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease, background 140ms ease",
                  }}
                >
                  <Box size={10} strokeWidth={2.2} />
                  <span>Cấu hình</span>
                </button>
              </div>
              {hoverTelemetrySnapshot ? (
                <span
                  className="dc-fft-hover-summary"
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

                {FFT_AXIS_DISPLAY_ORDER.map(renderFftAxisCard)}

              </div>

            </div>

            {!showInitialLoading ? (
              <div
                style={{
                  marginTop: modalLayout.sectionGap,
                  marginLeft: -4,
                  marginRight: -4,
                  width: "calc(100% + 8px)",
                  minWidth: 0,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    minHeight: modalLayout.overviewHeaderHeight,
                    marginBottom: modalLayout.chartTitleGap,
                    flexWrap: "wrap",
                    minWidth: 0,
                    overflowX: "hidden",
                    overflowY: "hidden",
                    scrollbarWidth: "none",
                    whiteSpace: "normal",
                  }}
                >
                  <span style={{ color: C.primary }}><Clock3 size={13} strokeWidth={2} /></span>
                  <span className="dc-loaded-data-title" style={{ color: C.textBright, fontSize: "0.72rem", fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Toàn cảnh dữ liệu đã tải</span>
                  <button
                    type="button"
                    onClick={() => setAdvancedRangeOpen((open) => !open)}
                    aria-expanded={advancedRangeOpen}
                    style={{
                      marginLeft: "auto",
                      height: 22,
                      borderRadius: 6,
                      border: `1px solid ${advancedRangeOpen ? C.primary : C.border}`,
                      background: advancedRangeOpen ? C.primaryBg : C.surface,
                      color: advancedRangeOpen ? C.primary : C.textMuted,
                      padding: "0 7px",
                      cursor: "pointer",
                      fontSize: "0.56rem",
                      fontWeight: 800,
                    }}
                  >
                    Nâng cao
                  </button>
                  {advancedRangeOpen ? (
                  <label
                    className="dc-chart-resolution-control"
                    title={`Khoảng thời gian mà mỗi điểm trên chart đại diện. Hiện tại: ${telemetryStepLabel}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      minHeight: 22,
                      height: 22,
                      padding: "0 5px",
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: C.surface,
                      color: C.textMuted,
                      fontSize: "0.56rem",
                      fontWeight: 800,
                      letterSpacing: "0.01em",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      maxWidth: "min(100%, 168px)",
                      overflow: "hidden",
                    }}
                  >
                    <span>Độ phân giải</span>
                    <select
                      aria-label="Độ phân giải dữ liệu đã tải"
                      value={selectedTelemetryStepMs === "auto" ? "auto" : String(selectedTelemetryStepMs)}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setSelectedTelemetryStepMs(nextValue === "auto" ? "auto" : Number(nextValue));
                      }}
                      style={{
                        height: 20,
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: C.textBright,
                        fontSize: "0.56rem",
                        fontWeight: 900,
                        cursor: "pointer",
                        maxWidth: 104,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <option value="auto">Tự động ({formatTelemetryStepMs(activeTelemetryGapStepMs)}/điểm)</option>
                      {TELEMETRY_HISTORY_BUCKET_STEPS_MS.map((stepMs) => (
                        <option
                          key={stepMs}
                          value={stepMs}
                          disabled={stepMs < activeTelemetryGapStepMs}
                        >
                          {formatTelemetryStepMs(stepMs)}/điểm
                        </option>
                      ))}
                    </select>
                  </label>
                  ) : null}
                </div>
                <div
                  style={{
                    background: C.card,
                    border: `1px solid ${C.cardBorder}`,
                    borderRadius: 10,
                    padding: modalLayout.overviewCardPadding,
                    width: "100%",
                    minWidth: 0,
                    boxSizing: "border-box",
                  }}
                >
                  <TrendOverviewBrush
                    rows={overviewTelemetryData}
                    statusBands={overviewTrendStatusBands}
                    missingDataBands={overviewMissingDataBands}
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
          </div>
          </div>

          {visualizeOpen && visualizeOverlay ? (
            <button
              type="button"
              aria-label="Đóng mô hình 3D"
              onClick={() => setVisualizeOpen(false)}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 12,
                border: "none",
                background: "rgba(2, 6, 23, 0.42)",
                cursor: "pointer",
              }}
            />
          ) : null}

          {visualizeOpen ? (
            <aside
              aria-label="Mô hình 3D motor"
              style={{
                position: visualizeOverlay ? "absolute" : "relative",
                top: 0,
                right: 0,
                bottom: 0,
                zIndex: 14,
                flex: visualizeOverlay ? "0 0 auto" : `0 0 ${visualizeSidebarWidth}`,
                width: visualizeSidebarWidth,
                minWidth: visualizeOverlay ? 0 : 420,
                maxWidth: "100%",
                borderLeft: `1px solid ${C.border}`,
                background: `linear-gradient(180deg, ${C.card} 0%, ${C.surface} 46%, #080d16 100%)`,
                boxShadow: visualizeOverlay
                  ? "-24px 0 60px rgba(0, 0, 0, 0.46)"
                  : "-12px 0 28px rgba(0, 0, 0, 0.22)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                animation: "visualizeSidebarIn 180ms cubic-bezier(0.2, 0.85, 0.25, 1)",
              }}
            >
              <div
                style={{
                  flex: "1 1 auto",
                  minHeight: 0,
                  position: "relative",
                  padding: 12,
                  background: "radial-gradient(circle at 50% 0%, rgba(94, 234, 212, 0.13), transparent 34%)",
                }}
              >
                <React.Suspense
                  fallback={(
                    <div
                      style={{
                        height: "100%",
                        minHeight: 360,
                        borderRadius: 10,
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                        background: "#080d16",
                        color: "#94a3b8",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.72rem",
                        fontWeight: 800,
                      }}
                    >
                      Đang mở môi trường 3D...
                    </div>
                  )}
                >
                  <LazyMotorSceneCanvas className="motor-scene-canvas--modal-sidebar" />
                </React.Suspense>
                <div
                  style={{
                    position: "absolute",
                    top: 24,
                    left: 24,
                    zIndex: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: 6,
                    borderRadius: 999,
                    border: "1px solid rgba(148, 163, 184, 0.28)",
                    background: "rgba(8, 13, 22, 0.82)",
                    boxShadow: "0 14px 28px rgba(0, 0, 0, 0.32)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleStartPlayback}
                    disabled={!playbackCanStart}
                    title={playbackCanStart ? "Chạy playhead theo vùng brush đang chọn" : "Không có điểm dữ liệu trong vùng brush"}
                    style={{
                      height: 30,
                      borderRadius: 999,
                      border: "1px solid rgba(248, 113, 113, 0.58)",
                      padding: "0 12px",
                      background: playbackRunning ? "rgba(239, 68, 68, 0.22)" : "rgba(239, 68, 68, 0.15)",
                      color: playbackCanStart ? "#fecaca" : "rgba(254, 202, 202, 0.48)",
                      cursor: playbackCanStart ? "pointer" : "not-allowed",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.68rem",
                      fontWeight: 900,
                      letterSpacing: "0.02em",
                      opacity: playbackCanStart ? 1 : 0.62,
                    }}
                  >
                    <Play size={13} strokeWidth={2.4} fill="currentColor" />
                    Play
                  </button>
                  <button
                    type="button"
                    onClick={handleDecreasePlaybackSpeed}
                    disabled={playbackSpeedIndex === 0}
                    aria-label="Giảm tốc playback"
                    title="Giảm tốc"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      border: "1px solid rgba(148, 163, 184, 0.26)",
                      background: "rgba(15, 23, 42, 0.64)",
                      color: playbackSpeedIndex === 0 ? "rgba(148, 163, 184, 0.42)" : "#e2e8f0",
                      cursor: playbackSpeedIndex === 0 ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Minus size={13} strokeWidth={2.5} />
                  </button>
                  <div
                    title={playbackDelayLabel}
                    style={{
                      minWidth: 58,
                      color: "#e2e8f0",
                      fontSize: "0.64rem",
                      fontWeight: 900,
                      textAlign: "center",
                      lineHeight: 1.1,
                    }}
                  >
                    <div>{playbackSpeedLabel}</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.54rem", fontWeight: 800 }}>{playbackDelayLabel}</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleIncreasePlaybackSpeed}
                    disabled={playbackSpeedIndex === PLAYBACK_SPEED_OPTIONS.length - 1}
                    aria-label="Tăng tốc playback"
                    title="Tăng tốc"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      border: "1px solid rgba(148, 163, 184, 0.26)",
                      background: "rgba(15, 23, 42, 0.64)",
                      color: playbackSpeedIndex === PLAYBACK_SPEED_OPTIONS.length - 1 ? "rgba(148, 163, 184, 0.42)" : "#e2e8f0",
                      cursor: playbackSpeedIndex === PLAYBACK_SPEED_OPTIONS.length - 1 ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Plus size={13} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={stopPlayback}
                    disabled={!playbackRunning && playbackCursorTs === null}
                    title="Dừng và xoá đường đỏ khỏi chart"
                    style={{
                      height: 30,
                      borderRadius: 999,
                      border: "1px solid rgba(148, 163, 184, 0.26)",
                      padding: "0 10px",
                      background: "rgba(15, 23, 42, 0.64)",
                      color: !playbackRunning && playbackCursorTs === null ? "rgba(148, 163, 184, 0.42)" : "#e2e8f0",
                      cursor: !playbackRunning && playbackCursorTs === null ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: "0.64rem",
                      fontWeight: 900,
                    }}
                  >
                    <Square size={11} strokeWidth={2.5} />
                    Stop
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Đóng mô hình 3D"
                  onClick={() => setVisualizeOpen(false)}
                  style={{
                    position: "absolute",
                    top: 24,
                    right: 24,
                    zIndex: 6,
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    border: "1px solid rgba(148, 163, 184, 0.28)",
                    background: "rgba(8, 13, 22, 0.82)",
                    color: "#cbd5e1",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 14px 28px rgba(0, 0, 0, 0.32)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <X size={15} strokeWidth={2.5} />
                </button>
              </div>
            </aside>
          ) : null}
        </div>
	      </div>

      <Modal
        open={positionConfigOpen}
        onClose={() => setPositionConfigOpen(false)}
        title="Cấu hình vị trí"
        description="Thiết lập vị trí motor và cảm biến trong không gian 3D."
        width={1180}
        zIndex={118}
        backdropBlur={3}
      >
        <div
          style={{
            position: "relative",
            height: "min(72vh, 720px)",
            minHeight: 520,
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${C.border}`,
            background: C.surface,
          }}
        >
          <React.Suspense
            fallback={
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: C.textMuted,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                }}
              >
                Đang mở môi trường 3D...
              </div>
            }
          >
            <LazyMotorSceneCanvas
              key={`position-config-${sensor.id}-${motorAxisLabels.ax}-${motorAxisLabels.ay}-${motorAxisLabels.az}`}
              className="motor-scene-canvas--position-config"
              placementMode
              selectedPlacementObject={positionConfigSelection}
              placementMotorRotation={positionMotorRotation}
              placementSensorRotation={positionSensorRotation}
              showPlacementSensorAxes={positionConfigOpen}
              placementAxisLabels={motorAxisLabels}
              onPlacementAxisMatchChange={handlePlacementAxisMatchChange}
              onPlacementSelectionChange={(objectKey) => {
                if (objectKey === "motor" || objectKey === "sensor") {
                  setPositionConfigSelection(objectKey);
                }
              }}
              onPlacementRotationChange={(objectKey, rotation) => {
                markPlacementAxisMatchesLive();
                if (objectKey === "motor") {
                  setPositionMotorRotation(rotation);
                  return;
                }
                setPositionSensorRotation(rotation);
              }}
            />
          </React.Suspense>

          <div
            style={{
              position: "absolute",
              right: 18,
              top: 16,
              width: 330,
              borderRadius: 16,
              border: `1px solid ${C.border}`,
              background: "rgba(248, 250, 252, 0.42)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 18px 45px rgba(15,23,42,0.22)",
              padding: 14,
              color: C.textBase,
              zIndex: 5,
            }}
          >
            <style>{`
              @keyframes positionConfigStepIn { from { opacity: 0; transform: translateX(18px) scale(0.98); } to { opacity: 1; transform: translateX(0) scale(1); } }
              @keyframes positionConfigRowIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
              @keyframes positionConfigGlow { 0%, 100% { box-shadow: 0 0 0 rgba(20,184,166,0); } 50% { box-shadow: 0 0 22px rgba(20,184,166,0.22); } }
            `}</style>
            <div key={positionConfigStep} style={{ animation: "positionConfigStepIn 420ms cubic-bezier(0.16, 1, 0.3, 1)", willChange: "opacity, transform" }}>
            <div style={{ color: "#0f766e", fontSize: "0.68rem", fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Bước {positionConfigStep}/3
            </div>
            <div style={{ color: "#0f172a", fontSize: "0.92rem", fontWeight: 900, marginTop: 5 }}>
              {positionConfigStep === 1 ? "Xác định hướng motor" : positionConfigStep === 2 ? "Xác định hướng cảm biến" : "Đổi tên và xác nhận"}
            </div>
            <div style={{ color: "#334155", fontSize: "0.68rem", lineHeight: 1.45, marginTop: 5 }}>
              {positionConfigStep < 3 ? "Chọn trục rung tiếp xúc + hướng xoay 0°/90° quanh trục đó." : "Đổi tên 3 trục motor theo mapping cảm biến, rồi lưu cấu hình."}
            </div>

            {positionConfigStep < 3 && (
              <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7, marginTop: 14 }}>
              {PLACEMENT_FACE_OPTIONS.map((option) => {
                const objectKey = positionConfigStep === 1 ? "motor" : "sensor";
                const activeFaceKey = positionConfigStep === 1 ? positionMotorFaceKey : positionSensorFaceKey;
                const activeTwist = positionConfigStep === 1 ? positionMotorTwist : positionSensorTwist;
                const axisLabel = axisLabelFor(objectKey === "motor" ? motorAxisLabels : vibrationAxisLabels, option.axisKey);
                const active = activeFaceKey === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    title={`${option.sign}${axisLabel}`}
                    onClick={() => {
                      if (objectKey === "motor") {
                        setPositionMotorFaceKey(option.key);
                      } else {
                        setPositionSensorFaceKey(option.key);
                      }
                      animatePlacementRotation(withPlacementTwist(option.rotation, activeTwist, option.key), objectKey);
                    }}
                    style={{
                      height: 38,
                      borderRadius: 10,
                      border: `1px solid ${active ? option.color : C.border}`,
                      background: active ? option.pastel : "rgba(255,255,255,0.82)",
                      color: active ? option.color : "#334155",
                      fontSize: "0.68rem",
                      fontWeight: 900,
                      cursor: "pointer",
                      outline: "none",
                    }}
                  >
                    <span style={{ display: "block", lineHeight: 1 }}>{axisLabel}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginTop: 9 }}>
              {PLACEMENT_TWIST_OPTIONS.map((twist) => {
                const objectKey = positionConfigStep === 1 ? "motor" : "sensor";
                const activeFaceKey = positionConfigStep === 1 ? positionMotorFaceKey : positionSensorFaceKey;
                const activeTwist = positionConfigStep === 1 ? positionMotorTwist : positionSensorTwist;
                const activeFace = PLACEMENT_FACE_OPTIONS.find((option) => option.key === activeFaceKey) ?? PLACEMENT_FACE_OPTIONS[0];
                const active = activeTwist === twist;
                return (
                  <button
                    key={twist}
                    type="button"
                    onClick={() => {
                      if (objectKey === "motor") {
                        setPositionMotorTwist(twist);
                      } else {
                        setPositionSensorTwist(twist);
                      }
                      animatePlacementRotation(withPlacementTwist(activeFace.rotation, twist, activeFace.key), objectKey);
                    }}
                    style={{
                      height: 30,
                      borderRadius: 999,
                      border: `1px solid ${active ? activeFace.color : C.border}`,
                      background: active ? activeFace.pastel : "rgba(255,255,255,0.82)",
                      color: active ? activeFace.color : "#475569",
                      fontSize: "0.62rem",
                      fontWeight: 900,
                      cursor: "pointer",
                      outline: "none",
                    }}
                  >
                    {twist}°
                  </button>
                );
              })}
            </div>
              </>
            )}

            {positionConfigStep === 3 && (
              <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                {PLACEMENT_MOTOR_AXIS_RENAME_OPTIONS.map((option, index) => {
                  const sensorLabel = placementSensorLabelForMotorAxis(placementAxisMatches, option.axisKey);
                  return (
                    <div
                      key={option.deviceAxisKey}
                      style={{
                        borderRadius: 12,
                        border: `1px solid ${C.border}`,
                        background: "rgba(255,255,255,0.8)",
                        padding: 9,
                        animation: `positionConfigRowIn 360ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 70}ms both`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                        <span style={{ color: "#0f172a", fontSize: "0.68rem", fontWeight: 900 }}>{option.defaultLabel}</span>
                        <span style={{ color: "#0f766e", fontSize: "0.62rem", fontWeight: 900 }}>{sensorLabel}</span>
                      </div>
                      <FormFieldShell icon={<PencilLine size={13} strokeWidth={2.1} />} style={{ minHeight: 36 }}>
                        <FormInput
                          value={positionAxisRenameDrafts[option.deviceAxisKey]}
                          onChange={(event) => {
                            setPositionAxisRenameDrafts((current) => ({
                              ...current,
                              [option.deviceAxisKey]: event.target.value,
                            }));
                            if (positionAxisRenameError) {
                              setPositionAxisRenameError("");
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" || positionAxisRenameSaving) {
                              return;
                            }
                            event.preventDefault();
                            void savePositionConfig();
                          }}
                          onDoubleClick={(event) => event.currentTarget.select()}
                          placeholder={option.defaultLabel}
                          autoFocus={index === 0}
                          disabled={positionAxisRenameSaving}
                          maxLength={48}
                          aria-label={`Tên trục ${option.defaultLabel}`}
                        />
                      </FormFieldShell>
                    </div>
                  );
                })}
                {positionAxisRenameError ? (
                  <div style={{ color: C.warning, fontSize: "0.7rem", lineHeight: 1.45 }}>{positionAxisRenameError}</div>
                ) : (
                  <div style={{ color: "#64748b", fontSize: "0.6rem", fontWeight: 800, lineHeight: 1.45 }}>
                    Tên trống sẽ quay về tên mặc định Axial / Radial H / Radial V.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                disabled={positionAxisRenameSaving}
                onClick={async () => {
                  if (positionConfigStep === 1) {
                    setPositionConfigStep(2);
                    setPositionConfigSelection("sensor");
                    return;
                  }
                  if (positionConfigStep === 2) {
                    setPositionAxisRenameDrafts(motorAxisLabels);
                    setPositionAxisRenameError("");
                    setPositionConfigStep(3);
                    return;
                  }
                  void savePositionConfig();
                }}
                onMouseDown={(event) => {
                  event.currentTarget.style.transform = "translateY(1px) scale(0.98)";
                  event.currentTarget.style.boxShadow = "0 3px 8px rgba(15,118,110,0.18)";
                }}
                onMouseUp={(event) => {
                  event.currentTarget.style.transform = "translateY(-1px) scale(1)";
                  event.currentTarget.style.boxShadow = "0 8px 18px rgba(15,118,110,0.22)";
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.transform = "translateY(-1px)";
                  event.currentTarget.style.boxShadow = "0 8px 18px rgba(15,118,110,0.22)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.transform = "translateY(0) scale(1)";
                  event.currentTarget.style.boxShadow = "none";
                }}
                style={{
                  height: 32,
                  borderRadius: 999,
                  border: "1px solid rgba(15,118,110,0.45)",
                  background: "linear-gradient(135deg, rgba(20,184,166,0.2), rgba(45,212,191,0.32))",
                  color: "#0f766e",
                  padding: "0 13px",
                  fontSize: "0.68rem",
                  fontWeight: 900,
                  cursor: positionAxisRenameSaving ? "wait" : "pointer",
                  outline: "none",
                  opacity: positionAxisRenameSaving ? 0.7 : 1,
                  transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
                  animation: positionConfigStep === 3 ? "positionConfigGlow 1600ms ease-in-out infinite" : undefined,
                }}
              >
                {positionConfigStep === 1 ? "Hoàn thành motor" : positionConfigStep === 2 ? "Tiếp tục" : positionAxisRenameSaving ? "Đang lưu..." : "Lưu cấu hình"}
              </button>
              <button
                type="button"
                disabled={positionAxisRenameSaving}
                onClick={() => {
                  if (positionConfigStep === 3) {
                    setPositionConfigStep(2);
                    return;
                  }
                  if (positionConfigStep === 1) {
                    setPositionMotorFaceKey("bottom");
                    setPositionMotorTwist(0);
                    animatePlacementRotation({ x: 0, y: 0, z: 0 }, "motor");
                  } else {
                    setPositionSensorFaceKey("bottom");
                    setPositionSensorTwist(0);
                    animatePlacementRotation({ x: 0, y: 0, z: 0 }, "sensor");
                  }
                }}
                onMouseDown={(event) => {
                  event.currentTarget.style.transform = "translateY(1px) scale(0.98)";
                }}
                onMouseUp={(event) => {
                  event.currentTarget.style.transform = "translateY(-1px) scale(1)";
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.transform = "translateY(-1px)";
                  event.currentTarget.style.boxShadow = "0 7px 15px rgba(15,23,42,0.14)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.transform = "translateY(0) scale(1)";
                  event.currentTarget.style.boxShadow = "none";
                }}
                style={{
                  height: 32,
                  borderRadius: 999,
                  border: `1px solid ${C.border}`,
                  background: "rgba(255, 255, 255, 0.72)",
                  color: "#334155",
                  padding: "0 11px",
                  fontSize: "0.66rem",
                  fontWeight: 900,
                  cursor: positionAxisRenameSaving ? "wait" : "pointer",
                  opacity: positionAxisRenameSaving ? 0.68 : 1,
                  outline: "none",
                  transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
                }}
              >
                {positionConfigStep === 3 ? "Quay lại" : "Reset"}
              </button>
            </div>
            </div>
          </div>

        </div>
      </Modal>

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
        footer={(
          <>
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
	              {clearingDeviceData ? `Đang xoá ${Math.round(asFiniteNumber(dataClearJob?.progress) ?? 0)}%` : "Xoá dữ liệu"}
	            </ConsoleButton>
	          </div>
                  {dataClearJob && (safeString(dataClearJob.status) === "queued" || safeString(dataClearJob.status) === "running") ? (
                    <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted }}>
                      Job xoá: {Math.round(asFiniteNumber(dataClearJob.progress) ?? 0)}% · telemetry {Math.round(asFiniteNumber(dataClearJob.telemetryDeleted) ?? 0)}
                    </div>
                  ) : null}
          </>
	        )}
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
	                    {dataSummary.spectrum.latestAt ? formatTooltipDateTime(dataSummary.spectrum.latestAt) : SPECTRUM_NO_DATA_LABEL}
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
        open={Boolean(axisRenameTarget)}
        onClose={closeAxisRenameModal}
        title={`Đổi tên ${axisRenameTarget ? chartAxisLabels[axisRenameTarget] : "trục"}`}
        width={420}
        zIndex={96}
        disableClose={axisRenameSaving}
        footer={
          <>
            <ConsoleButton variant="neutral" size="sm" onClick={closeAxisRenameModal} disabled={axisRenameSaving}>
              Huỷ
            </ConsoleButton>
            <ConsoleButton variant="primary" size="sm" onClick={() => void saveAxisRename()} disabled={axisRenameSaving}>
              {axisRenameSaving ? "Đang lưu..." : "Lưu tên trục"}
            </ConsoleButton>
          </>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <FormFieldShell icon={<PencilLine size={14} strokeWidth={2.1} />} style={{ minHeight: 40 }}>
            <FormInput
              value={axisRenameDraft}
              onChange={(event) => {
                setAxisRenameDraft(event.target.value);
                if (axisRenameError) {
                  setAxisRenameError("");
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || axisRenameSaving) {
                  return;
                }
                event.preventDefault();
                void saveAxisRename();
              }}
              onDoubleClick={(event) => event.currentTarget.select()}
              placeholder={axisRenameTarget ? chartAxisLabels[axisRenameTarget] : "Tên trục"}
              autoFocus
              disabled={axisRenameSaving}
              maxLength={48}
              aria-label="Tên trục cảm biến"
            />
          </FormFieldShell>
          {axisRenameError ? (
            <div style={{ color: C.warning, fontSize: "0.7rem", lineHeight: 1.45 }}>{axisRenameError}</div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={clearDataConfirmMounted}
        onClose={() => closeClearDataConfirm()}
        title={dataClearJobActive ? "Đang xoá dữ liệu" : "Xoá dữ liệu thiết bị?"}
        width={440}
        zIndex={95}
        disableClose={clearingDeviceData}
        backdropClassName={`data-clear-confirm-backdrop ${clearDataConfirmClosing ? "modal-closing" : "modal-open"}`}
        cardClassName={`data-clear-confirm-card ${clearDataConfirmClosing ? "modal-closing" : "modal-open"}`}
        footer={
          <>
            <ConsoleButton variant="neutral" size="sm" onClick={() => closeClearDataConfirm()} disabled={clearingDeviceData}>
              Đóng
            </ConsoleButton>
            <ConsoleButton variant="danger" size="sm" onClick={() => void clearDeviceData()} disabled={clearingDeviceData || Boolean(dataClearJobActive)}>
              {clearingDeviceData ? "Đang tạo job..." : dataClearJobActive ? `Đang xoá ${Math.round(asFiniteNumber(dataClearJob?.progress) ?? 0)}%` : "Xoá dữ liệu"}
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
          {dataClearJobActive ? (
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
              <div style={{ height: 8, borderRadius: 999, background: `${C.border}66`, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(0, Math.min(100, asFiniteNumber(dataClearJob?.progress) ?? 0))}%`, height: "100%", background: C.primary }} />
              </div>
              <div style={{ color: C.textMuted, fontSize: "0.72rem" }}>
                Tiến độ {Math.round(asFiniteNumber(dataClearJob?.progress) ?? 0)}% · đã xoá {Math.round(asFiniteNumber(dataClearJob?.telemetryDeleted) ?? 0)} telemetry
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
});
