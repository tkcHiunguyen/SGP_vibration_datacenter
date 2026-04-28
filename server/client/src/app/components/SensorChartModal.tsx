import React, { startTransition, useState, useMemo, useRef, useEffect, useCallback, useId } from "react";
import { X, Thermometer, BarChart3, Activity, Trash2, Settings, Clock3, CalendarDays, ChevronDown, ArrowLeft, ArrowRight } from "lucide-react";
import type { DeviceSpectrumPoint, DeviceTelemetryPoint, Sensor, SpectrumAxis } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";
import type { ToastItem } from "./ui";
import { ConsoleButton, Modal } from "./ui";
import {
  ACCEL_LIMIT_MAX_MS2,
  ACCEL_LIMIT_MIN_MS2,
  ACCEL_LIMIT_MS2,
  ACCEL_RMS_MAX_WINDOW_MS,
  ACCEL_RMS_MIN_WINDOW_MS,
  ACCEL_RMS_TARGET_SAMPLES,
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
  DEFAULT_SPECTRUM_SAMPLE_RATE_HZ,
  DEFAULT_SPECTRUM_SOURCE_SAMPLES,
  EMPTY_SPECTRUM_POINTS,
  GRAVITY_MS2,
  SPECTRUM_CHART_HEIGHT,
  SPECTRUM_FIXED_Y_MAX_FALLBACK,
  SPECTRUM_HOVER_FETCH_DEBOUNCE_MS,
  SPECTRUM_HOVER_FETCH_MIN_DELTA_MS,
  SPECTRUM_LOADING_LABEL,
  SPECTRUM_NO_DATA_LABEL,
  SPECTRUM_RENDER_BARS,
  SpectrumLoadingState,
  SpectrumNoDataState,
  SpectrumZoomChart,
  TELEMETRY_HISTORY_PRESETS,
  TEMP_HALF_SPAN_MAX,
  TEMP_HALF_SPAN_MIN,
  TOP_TREND_CHART_HEIGHT,
  TREND_BUTTON_PAN_ACCELERATION_MS,
  TREND_BUTTON_PAN_BASE_WINDOWS_PER_SECOND,
  TREND_BUTTON_PAN_CLICK_RATIO,
  TREND_BUTTON_PAN_FRAME_MS,
  TREND_BUTTON_PAN_MAX_WINDOWS_PER_SECOND,
  TREND_LATEST_EPSILON_MS,
  TREND_MAX_GAP_STEP_RATIO,
  TREND_MAX_RENDER_POINTS,
  TREND_MIN_RENDER_POINTS,
  TREND_MIN_VIEW_WINDOW_MS,
  TREND_OVERVIEW_HEIGHT,
  TREND_OVERVIEW_MAX_POINTS,
  TREND_PAN_CLICK_SUPPRESS_MS,
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
  buildNullGapRanges,
  buildOverviewTelemetryRows,
  buildRollingRmsAccelRows,
  buildTiledTrendRows,
  clampAccelAmplitudeLimit,
  clampTempHalfSpan,
  clampTrendViewport,
  clipGapRangesToWindow,
  downsampleSpectrumChartData,
  formatAbsoluteAxisTime,
  formatByteSize,
  formatChartTime,
  formatDateInputLabel,
  formatDateInputValue,
  formatFrequencyHz,
  formatMonthKey,
  formatMonthLabel,
  formatOptionalValue,
  formatPeakSummary,
  formatTooltipDateTime,
  formatTrendAxisTime,
  getDefaultTrendViewWindowMs,
  getPrimaryWheelDelta,
  normalizeSpectrumUnit,
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
import type {
  AccelTrendMode,
  ButtonPanState,
  CalendarDayCell,
  ChartPanState,
  DenseTelemetryRow,
  DeviceDataSummary,
  HistoryPresetKey,
  HoverTelemetrySnapshot,
  SpectrumChartDataPoint,
  SpectrumHoverTarget,
  TelemetryAvailabilityDay,
  TrendGapSegment,
  TrendRow,
  TrendSeriesConfig,
  TrendViewport,
} from "./sensor-chart-modal/chart-parts";

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
  const modalLayout = useChartModalLayout();
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
      .flatMap((point): HoverTelemetrySnapshot[] => {
        const ts = Date.parse(point.receivedAt);
        if (!Number.isFinite(ts)) {
          return [];
        }

        return [{
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
        }];
      });

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
      .flatMap((point): DenseTelemetryRow[] => {
        const sourceTs = Date.parse(point.receivedAt);
        if (!Number.isFinite(sourceTs) || sourceTs < startMs || sourceTs > endMs) {
          return [];
        }

        return [{
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
        }];
      })
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
                      aria-label="Chuyển sang tháng trước"
                      title="Chuyển sang tháng trước"
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
                      aria-label="Chuyển sang tháng sau"
                      title="Chuyển sang tháng sau"
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
                        aria-pressed={active ? "true" : "false"}
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
                    ) : fftRenderX.length === 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 8,
                          overflow: "hidden",
                          pointerEvents: "none",
                        }}
                      >
                        <SpectrumNoDataState C={C} accentColor="#f87171" />
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
                      visibility: hoverSpectrumBusy || fftRenderX.length === 0 ? "hidden" : "visible",
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
                    ) : fftRenderY.length === 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 8,
                          overflow: "hidden",
                          pointerEvents: "none",
                        }}
                      >
                        <SpectrumNoDataState C={C} accentColor="#60a5fa" />
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
                      visibility: hoverSpectrumBusy || fftRenderY.length === 0 ? "hidden" : "visible",
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
                    ) : fftRenderZ.length === 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 8,
                          overflow: "hidden",
                          pointerEvents: "none",
                        }}
                      >
                        <SpectrumNoDataState C={C} accentColor="#a78bfa" />
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
                      visibility: hoverSpectrumBusy || fftRenderZ.length === 0 ? "hidden" : "visible",
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
