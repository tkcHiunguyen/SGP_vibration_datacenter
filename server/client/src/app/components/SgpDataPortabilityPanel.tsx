import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileArchive,
  HardDriveDownload,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";

export type SgpPortabilityMode = "export" | "import";
type Status = "idle" | "loading" | "success" | "error";
type Preview = {
  manifest?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dateRange?: { from?: string; to?: string };
  devices?: Array<Record<string, unknown>>;
  measurements?: number;
  spectra?: number;
  summary?: Record<string, unknown>;
  file?: { name?: string; sizeBytes?: number };
};
type ImportBucket = { inserted?: number; updated?: number; skipped?: number };
type ImportResult = {
  devices?: ImportBucket;
  measurements?: ImportBucket;
  spectrum?: ImportBucket;
};
type ExportJobStatus = "queued" | "running" | "completed" | "failed";
type ExportJob = {
  jobId: string;
  status: ExportJobStatus;
  progress: number;
  stage: string;
  createdAt: string;
  updatedAt: string;
  range?: { from?: string; to?: string };
  deviceId?: string;
  fileName?: string;
  sizeBytes?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  manifest?: {
    deviceCount?: number;
    measurementCount?: number;
    spectrumFrameCount?: number;
    placementConfigCount?: number;
  };
};
type ExportJobListResponse = { items?: ExportJob[] };

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;
const EXPORT_JOB_STORAGE_KEY = "sgp:data-export-job";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 0, 0);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), 0, 0);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1, 0, 0, 0, 0);
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, mondayOffset));
}

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDateTimeInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatTimeValue(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function combineDateTime(date: Date, timeValue: string): Date {
  const [hourRaw, minuteRaw] = timeValue.split(":");
  const hour = Math.max(0, Math.min(23, Number(hourRaw) || 0));
  const minute = Math.max(0, Math.min(59, Number(minuteRaw) || 0));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function sameDay(left: Date, right: Date): boolean {
  return dayKey(left) === dayKey(right);
}

function monthLabel(date: Date): string {
  return `Tháng ${date.getMonth() + 1} ${date.getFullYear()}`;
}

function formatShortRange(from: string, to: string): string {
  if (!from || !to) return "Chọn khoảng thời gian export";
  return `${fmtCompactDateTime(from)} - ${fmtCompactDateTime(to)}`;
}

function buildMonthCells(monthDate: Date): Date[] {
  const first = startOfMonth(monthDate);
  const firstDay = first.getDay();
  const leadingDays = firstDay === 0 ? 6 : firstDay - 1;
  const gridStart = addDays(first, -leadingDays);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function fmtDateTime(value?: string): string {
  if (!value) return "--";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("vi-VN");
}

function fmtCompactDateTime(value?: string | Date): string {
  if (!value) return "--";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("vi-VN") : "--";
}

function fmtBytes(bytes: unknown): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function bucketTotal(bucket?: ImportBucket): number {
  return (bucket?.inserted ?? 0) + (bucket?.updated ?? 0);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || text;
  } catch {
    return text;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await readError(response));
  const parsed = (await response.json()) as { ok?: boolean; data?: T } | T;
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

function readStoredExportJobId(): string | null {
  try {
    return window.localStorage.getItem(EXPORT_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeExportJobId(jobId: string): void {
  try {
    window.localStorage.setItem(EXPORT_JOB_STORAGE_KEY, jobId);
  } catch {
    // Ignore storage failures; the server job still continues.
  }
}

function clearStoredExportJobId(jobId?: string): void {
  try {
    if (!jobId || window.localStorage.getItem(EXPORT_JOB_STORAGE_KEY) === jobId) {
      window.localStorage.removeItem(EXPORT_JOB_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

function isExportJobActive(job?: ExportJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function sortExportJobs(jobs: ExportJob[]): ExportJob[] {
  return [...jobs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function isExportJobNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("sgpdata_export_job_not_found");
}

export function SgpDataPortabilityPanel({
  mode,
  allowModeSwitch = false,
}: {
  mode?: SgpPortabilityMode;
  allowModeSwitch?: boolean;
}) {
  const { C } = useTheme();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rangePickerRef = useRef<HTMLDivElement | null>(null);
  const downloadedExportJobIdsRef = useRef<Set<string>>(new Set());
  const [internalMode, setInternalMode] = useState<SgpPortabilityMode>(mode ?? "export");
  const activeMode = mode ?? internalMode;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [startCursorMonth, setStartCursorMonth] = useState(() => startOfMonth(new Date()));
  const [endCursorMonth, setEndCursorMonth] = useState(() => startOfMonth(new Date()));
  const [draftStartDate, setDraftStartDate] = useState<Date | null>(null);
  const [draftEndDate, setDraftEndDate] = useState<Date | null>(null);
  const [draftStartTime, setDraftStartTime] = useState("00:00");
  const [draftEndTime, setDraftEndTime] = useState("23:59");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const previewStats = useMemo(() => {
    const meta = preview?.metadata ?? preview?.manifest ?? preview?.summary ?? {};
    return {
      measurements: preview?.measurements ?? meta.measurements ?? meta.measurementCount,
      spectra: preview?.spectra ?? meta.spectra ?? meta.spectrumCount,
      devices: preview?.devices?.length ?? meta.devices ?? meta.deviceCount,
      from: preview?.dateRange?.from ?? meta.dateFrom ?? meta.from,
      to: preview?.dateRange?.to ?? meta.dateTo ?? meta.to,
    };
  }, [preview]);
  const sharedExportBusy = exportJobs.some(isExportJobActive);

  useEffect(() => {
    if (!mode) return;
    setStatus("idle");
    setMessage("");
    setPreview(null);
    setDragActive(false);
    if (mode === "export") {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [mode]);

  useEffect(() => {
    if (activeMode !== "export" || exportJob) return;
    const storedJobId = readStoredExportJobId();
    if (!storedJobId) return;
    let cancelled = false;
    void fetchExportJob(storedJobId)
      .then((job) => {
        if (cancelled) return;
        setExportJob(job);
        upsertExportJob(job);
        if (job.status === "queued" || job.status === "running") {
          setStatus("loading");
          setMessage(job.stage || "Đang export dữ liệu...");
        } else if (job.status === "failed") {
          setStatus("error");
          setMessage(job.error || "Export thất bại");
          clearStoredExportJobId(job.jobId);
        }
      })
      .catch(() => clearStoredExportJobId(storedJobId));
    return () => {
      cancelled = true;
    };
  }, [activeMode, exportJob]);

  useEffect(() => {
    if (activeMode !== "export") return;
    void refreshExportJobs();
  }, [activeMode]);

  useEffect(() => {
    if (activeMode !== "export" || !sharedExportBusy) return;
    const timer = window.setInterval(() => void refreshExportJobs(), 1500);
    return () => window.clearInterval(timer);
  }, [activeMode, sharedExportBusy]);

  useEffect(() => {
    if (activeMode !== "export" || !exportJob || exportJob.status === "completed" || exportJob.status === "failed") return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const nextJob = await fetchExportJob(exportJob.jobId);
        if (cancelled) return;
        setExportJob(nextJob);
        upsertExportJob(nextJob);
        if (nextJob.status === "queued" || nextJob.status === "running") {
          setStatus("loading");
          setMessage(nextJob.stage || "Đang export dữ liệu...");
          timer = window.setTimeout(poll, 1200);
        } else if (nextJob.status === "completed") {
          setStatus("success");
          setMessage(`Export xong: ${nextJob.fileName ?? nextJob.jobId}`);
        } else {
          setStatus("error");
          setMessage(nextJob.error || "Export thất bại");
          clearStoredExportJobId(nextJob.jobId);
        }
      } catch (error) {
        if (cancelled) return;
        if (isExportJobNotFoundError(error)) {
          clearStoredExportJobId(exportJob.jobId);
          setExportJob(null);
          setStatus("idle");
          setMessage("Job export cũ không còn. Tạo job export mới.");
          void refreshExportJobs();
          return;
        }
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Không đọc được trạng thái export");
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeMode, exportJob?.jobId, exportJob?.status]);

  useEffect(() => {
    if (activeMode !== "export" || !exportJob || exportJob.status !== "completed") return;
    if (downloadedExportJobIdsRef.current.has(exportJob.jobId)) return;
    downloadedExportJobIdsRef.current.add(exportJob.jobId);
    void handleExportJobDownload(exportJob);
  }, [activeMode, exportJob]);

  useEffect(() => {
    if (!rangePickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rangePickerRef.current?.contains(target)) {
        return;
      }
      setRangePickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRangePickerOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [rangePickerOpen]);

  const exportBusy = isExportJobActive(exportJob);
  const exportDisabled = exportBusy || status === "loading" || !from || !to;
  const importDisabled = status === "loading" || !file || !preview;

  function setPanelMode(nextMode: SgpPortabilityMode): void {
    if (!mode) setInternalMode(nextMode);
    setStatus("idle");
    setMessage("");
    setPreview(null);
    setDragActive(false);
    if (nextMode === "export") {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function chooseFile(nextFile: File | null): void {
    setFile(nextFile);
    setPreview(null);
    setMessage("");
    setStatus("idle");
    if (nextFile) void runPreview(nextFile);
  }

  function openRangePicker(): void {
    const parsedFrom = parseLocalDateTime(from);
    const parsedTo = parseLocalDateTime(to);
    const now = new Date();
    const initialStart = parsedFrom ?? startOfDay(now);
    const initialEnd = parsedTo ?? now;
    setDraftStartDate(startOfDay(initialStart));
    setDraftEndDate(startOfDay(initialEnd));
    setDraftStartTime(formatTimeValue(initialStart));
    setDraftEndTime(formatTimeValue(initialEnd));
    setStartCursorMonth(startOfMonth(initialStart));
    setEndCursorMonth(startOfMonth(initialEnd));
    setRangePickerOpen(true);
  }

  function applyPreset(preset: "today" | "yesterday" | "this-week" | "last-week" | "this-month" | "last-month" | "last-3-months" | "ytd"): void {
    const now = new Date();
    let start = startOfDay(now);
    let end = now;

    if (preset === "yesterday") {
      const yesterday = addDays(now, -1);
      start = startOfDay(yesterday);
      end = endOfDay(yesterday);
    } else if (preset === "this-week") {
      start = startOfWeek(now);
      end = now;
    } else if (preset === "last-week") {
      start = addDays(startOfWeek(now), -7);
      end = endOfDay(addDays(start, 6));
    } else if (preset === "this-month") {
      start = startOfMonth(now);
      end = now;
    } else if (preset === "last-month") {
      start = addMonths(startOfMonth(now), -1);
      end = endOfDay(addDays(startOfMonth(now), -1));
    } else if (preset === "last-3-months") {
      start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()));
      end = now;
    } else if (preset === "ytd") {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      end = now;
    }

    setDraftStartDate(startOfDay(start));
    setDraftEndDate(startOfDay(end));
    setDraftStartTime(formatTimeValue(start));
    setDraftEndTime(formatTimeValue(end));
    setStartCursorMonth(startOfMonth(start));
    setEndCursorMonth(startOfMonth(end));
  }

  function selectCalendarDay(day: Date, target: "start" | "end"): void {
    const selected = startOfDay(day);
    if (target === "start") {
      setDraftStartDate(selected);
      return;
    }
    setDraftEndDate(selected);
  }

  function applyDateRange(): void {
    if (!draftStartDate) {
      setStatus("error");
      setMessage("Chọn ngày bắt đầu export.");
      return;
    }
    const start = combineDateTime(draftStartDate, draftStartTime);
    const end = combineDateTime(draftEndDate ?? draftStartDate, draftEndTime);
    if (end.getTime() < start.getTime()) {
      setStatus("error");
      setMessage("Thời gian kết thúc phải sau thời gian bắt đầu.");
      return;
    }
    setFrom(formatLocalDateTimeInput(start));
    setTo(formatLocalDateTimeInput(end));
    setStatus("idle");
    setMessage("");
    setRangePickerOpen(false);
  }

  async function fetchExportJob(jobId: string): Promise<ExportJob> {
    return requestJson<ExportJob>(`/api/sgpdata/export/jobs/${encodeURIComponent(jobId)}`);
  }

  async function fetchExportJobs(): Promise<ExportJob[]> {
    const result = await requestJson<ExportJobListResponse>("/api/sgpdata/export/jobs?limit=20");
    return sortExportJobs(result.items ?? []);
  }

  function upsertExportJob(job: ExportJob): void {
    setExportJobs((current) => sortExportJobs([job, ...current.filter((item) => item.jobId !== job.jobId)]).slice(0, 20));
  }

  async function refreshExportJobs(): Promise<void> {
    try {
      const jobs = await fetchExportJobs();
      setExportJobs(jobs);
      setExportJob((current) => {
        if (!current) return current;
        return jobs.find((job) => job.jobId === current.jobId) ?? current;
      });
    } catch {
      // Keep current UI state; direct job polling still reports actionable errors.
    }
  }

  async function downloadExportJob(job: ExportJob): Promise<void> {
    const response = await fetch(`/api/sgpdata/export/jobs/${encodeURIComponent(job.jobId)}/download`);
    if (!response.ok) throw new Error(await readError(response));
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const name = match?.[1] || job.fileName || `sgp-data-${job.jobId}.sgpdata`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    clearStoredExportJobId(job.jobId);
    setStatus("success");
    setMessage(`Đã tải ${name} (${fmtBytes(blob.size)}).`);
  }

  async function handleExportJobDownload(job: ExportJob): Promise<void> {
    try {
      await downloadExportJob(job);
    } catch (error) {
      downloadedExportJobIdsRef.current.delete(job.jobId);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Không tải được file export");
    }
  }

  async function runExport(): Promise<void> {
    if (!from || !to) {
      setStatus("error");
      setMessage("Chọn đủ Từ ngày và Đến ngày.");
      return;
    }
    if (new Date(from).getTime() > new Date(to).getTime()) {
      setStatus("error");
      setMessage("Từ ngày phải nhỏ hơn hoặc bằng Đến ngày.");
      return;
    }
    setStatus("loading");
    setMessage("Đang tạo job export...");
    try {
      const job = await requestJson<ExportJob>("/api/sgpdata/export/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date_from: new Date(from).toISOString(),
          date_to: new Date(to).toISOString(),
        }),
      });
      setExportJob(job);
      upsertExportJob(job);
      storeExportJobId(job.jobId);
      setMessage(job.stage || "Đang export dữ liệu...");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Export thất bại");
    }
  }

  async function runPreview(nextFile = file): Promise<void> {
    if (!nextFile) return;
    setStatus("loading");
    setMessage("Đang kiểm tra file...");
    setPreview(null);
    try {
      const body = new FormData();
      body.append("file", nextFile);
      const result = await requestJson<Preview>("/api/sgpdata/import/preview", { method: "POST", body });
      setPreview(result);
      setStatus("success");
      setMessage("File hợp lệ.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Preview thất bại");
    }
  }

  async function runImport(): Promise<void> {
    if (!file) return;
    setStatus("loading");
    setMessage("Đang nhập dữ liệu...");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await requestJson<ImportResult>("/api/sgpdata/import", { method: "POST", body });
      const deviceCount = bucketTotal(result.devices);
      const measurementCount = bucketTotal(result.measurements);
      const spectrumCount = bucketTotal(result.spectrum);
      setStatus("success");
      setMessage(`Import xong: ${deviceCount} thiết bị, ${measurementCount} điểm đo, ${spectrumCount} phổ.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Import thất bại");
    }
  }

  const inputStyle: React.CSSProperties = {
    height: 34,
    borderRadius: 7,
    border: `1px solid ${C.cardBorder}`,
    background: C.input,
    color: C.textBright,
    padding: "0 10px",
    fontSize: "0.72rem",
    outline: "none",
    minWidth: 0,
  };

  const primaryButton: React.CSSProperties = {
    height: 34,
    borderRadius: 7,
    border: `1px solid ${C.primary}`,
    background: C.primary,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "0 12px",
    cursor: "pointer",
    fontSize: "0.72rem",
    fontWeight: 850,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {allowModeSwitch ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <ModeButton active={activeMode === "export"} icon={<Download size={14} />} label="Export" detail="Tạo gói .sgpdata" onClick={() => setPanelMode("export")} />
          <ModeButton active={activeMode === "import"} icon={<Upload size={14} />} label="Import" detail="Kiểm tra và merge" onClick={() => setPanelMode("import")} />
        </div>
      ) : null}

      {activeMode === "export" ? (
        <section style={sectionStyle()}>
          {allowModeSwitch ? <PanelTitle icon={<Download size={15} />} title="Xuất dữ liệu" value=".sgpdata package" /> : null}
          <div ref={rangePickerRef} style={{ position: "relative", minWidth: 0 }}>
            <button
              type="button"
              onClick={openRangePicker}
              style={{
                width: "100%",
                minHeight: 40,
                borderRadius: 8,
                border: `1px solid ${rangePickerOpen ? C.primary : C.cardBorder}`,
                background: C.card,
                color: C.textBright,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "0 12px",
                cursor: "pointer",
                boxShadow: rangePickerOpen ? `0 0 0 3px ${C.primaryBg}` : "none",
                textAlign: "left",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <CalendarClock size={15} color={C.primary} strokeWidth={2.1} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.76rem", fontWeight: 850 }}>
                  {formatShortRange(from, to)}
                </span>
              </span>
              <ChevronDown size={15} color={C.textMuted} strokeWidth={2.2} style={{ flexShrink: 0 }} />
            </button>
            {rangePickerOpen ? <DateRangePickerPopover /> : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <ScopeItem icon={<Database size={14} />} title="Telemetry" value="Điểm đo lịch sử" />
            <ScopeItem icon={<HardDriveDownload size={14} />} title="Spectrum" value="Phổ FFT đã lưu" />
            <ScopeItem icon={<ShieldCheck size={14} />} title="Integrity" value="SHA-256 manifest" />
            <ScopeItem icon={<CalendarClock size={14} />} title="Range" value={from && to ? formatShortRange(from, to) : "--"} />
          </div>
          {exportJob ? <ExportProgressCard job={exportJob} /> : null}
          {exportJobs.length > 0 ? <ExportJobList jobs={exportJobs} activeJobId={exportJob?.jobId} /> : null}
        </section>
      ) : (
        <section style={sectionStyle()}>
          {allowModeSwitch ? <PanelTitle icon={<Upload size={15} />} title="Nhập dữ liệu" value="Preview trước khi merge" /> : null}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              chooseFile(event.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => fileRef.current?.click()}
            style={{
              borderRadius: 8,
              border: `1.5px dashed ${dragActive ? C.primary : C.cardBorder}`,
              background: dragActive ? C.primaryBg : C.surface,
              padding: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              cursor: "pointer",
              minWidth: 0,
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".sgpdata,application/octet-stream,application/zip"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ width: 34, height: 34, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.primary, display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Upload size={16} strokeWidth={2.1} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", color: C.textBright, fontSize: "0.78rem", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file ? file.name : "Chọn file .sgpdata"}
                </span>
                <span style={{ display: "block", color: C.textMuted, fontSize: "0.66rem", marginTop: 3 }}>
                  {file ? fmtBytes(file.size) : "Kéo thả hoặc bấm để chọn"}
                </span>
              </span>
            </div>
            <span style={{ color: C.primary, fontSize: "0.66rem", fontWeight: 850, flexShrink: 0 }}>Browse</span>
          </div>

          {preview ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8 }}>
                <MiniStat label="Thiết bị" value={fmtCount(previewStats.devices)} />
                <MiniStat label="Điểm đo" value={fmtCount(previewStats.measurements)} />
                <MiniStat label="Phổ" value={fmtCount(previewStats.spectra)} />
                <MiniStat label="Dung lượng" value={fmtBytes(preview.file?.sizeBytes ?? file?.size)} />
              </div>
              <DevicePreview devices={preview.devices ?? []} />
            </>
          ) : null}
        </section>
      )}

      <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <StatusBanner />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {activeMode === "import" ? (
            <button
              disabled={!file || status === "loading"}
              onClick={() => runPreview()}
              style={{ ...secondaryButtonStyle(), opacity: !file || status === "loading" ? 0.5 : 1 }}
            >
              Preview
            </button>
          ) : null}
          <button
            disabled={activeMode === "export" ? exportDisabled : importDisabled}
            onClick={activeMode === "export" ? runExport : runImport}
            style={{
              ...primaryButton,
              opacity: activeMode === "export" ? (exportDisabled ? 0.55 : 1) : importDisabled ? 0.55 : 1,
              cursor: status === "loading" ? "wait" : "pointer",
            }}
          >
            {status === "loading" ? <Loader2 size={14} style={{ animation: "webSpin 0.8s linear infinite" }} /> : activeMode === "export" ? <Download size={14} /> : <Upload size={14} />}
            {activeMode === "export" ? (exportBusy ? "Đang export" : "Tạo job export") : "Import"}
          </button>
        </div>
      </footer>
    </div>
  );

  function DateRangePickerPopover() {
    const presets: Array<{ key: Parameters<typeof applyPreset>[0]; label: string }> = [
      { key: "today", label: "Hôm nay" },
      { key: "yesterday", label: "Hôm qua" },
      { key: "this-week", label: "Tuần này" },
      { key: "last-week", label: "Tuần trước" },
      { key: "this-month", label: "Tháng này" },
      { key: "last-month", label: "Tháng trước" },
      { key: "last-3-months", label: "3 tháng gần nhất" },
      { key: "ytd", label: "Từ đầu năm" },
    ];
    const startPreview = draftStartDate ? combineDateTime(draftStartDate, draftStartTime) : null;
    const endPreview = draftEndDate ? combineDateTime(draftEndDate, draftEndTime) : draftStartDate ? combineDateTime(draftStartDate, draftEndTime) : null;
    const invalidDraftRange = Boolean(startPreview && endPreview && endPreview.getTime() < startPreview.getTime());

    return (
      <div
        style={{
          position: "absolute",
          zIndex: 40,
          top: "calc(100% + 8px)",
          left: 0,
          width: "min(760px, calc(100vw - 74px))",
          borderRadius: 10,
          border: `1px solid ${C.cardBorder}`,
          background: C.card,
          boxShadow: "0 22px 60px rgba(2, 6, 23, 0.42)",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "170px minmax(0, 1fr)",
        }}
      >
        <div style={{ borderRight: `1px solid ${C.border}`, padding: 10, display: "grid", alignContent: "start", gap: 5, background: C.headerBg }}>
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset.key)}
              style={{
                minHeight: 32,
                border: "none",
                borderRadius: 7,
                background: "transparent",
                color: C.textBase,
                cursor: "pointer",
                textAlign: "left",
                padding: "0 9px",
                fontSize: "0.72rem",
                fontWeight: 820,
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = C.surface;
                event.currentTarget.style.color = C.textBright;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
                event.currentTarget.style.color = C.textBase;
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div style={{ padding: 12, display: "grid", gap: 12, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <CalendarMonth
              monthDate={startCursorMonth}
              target="start"
              onPrev={() => setStartCursorMonth((current) => addMonths(current, -1))}
              onNext={() => setStartCursorMonth((current) => addMonths(current, 1))}
            />
            <CalendarMonth
              monthDate={endCursorMonth}
              target="end"
              onPrev={() => setEndCursorMonth((current) => addMonths(current, -1))}
              onNext={() => setEndCursorMonth((current) => addMonths(current, 1))}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, alignItems: "end" }}>
            <Field label="Bắt đầu">
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 82px", gap: 7 }}>
                <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: C.textBase, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {startPreview ? fmtCompactDateTime(startPreview) : "--"}
                </div>
                <input type="time" value={draftStartTime} onChange={(event) => setDraftStartTime(event.target.value)} style={inputStyle} />
              </div>
            </Field>
            <Field label="Kết thúc">
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 82px", gap: 7 }}>
                <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: C.textBase, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {endPreview ? fmtCompactDateTime(endPreview) : "--"}
                </div>
                <input type="time" value={draftEndTime} onChange={(event) => setDraftEndTime(event.target.value)} style={inputStyle} />
              </div>
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ color: invalidDraftRange ? C.danger : C.textMuted, fontSize: "0.66rem", fontWeight: 800 }}>
              {invalidDraftRange ? "Ngày kết thúc phải sau ngày bắt đầu." : "Lịch trái chọn bắt đầu, lịch phải chọn kết thúc."}
            </span>
            <button type="button" onClick={() => setRangePickerOpen(false)} style={secondaryButtonStyle()}>Huỷ</button>
            <button type="button" disabled={invalidDraftRange} onClick={applyDateRange} style={{ ...primaryButton, opacity: invalidDraftRange ? 0.55 : 1, cursor: invalidDraftRange ? "not-allowed" : "pointer" }}>Apply</button>
          </div>
        </div>
      </div>
    );
  }

  function CalendarMonth({
    monthDate,
    target,
    onPrev,
    onNext,
  }: {
    monthDate: Date;
    target: "start" | "end";
    onPrev: () => void;
    onNext: () => void;
  }) {
    const cells = buildMonthCells(monthDate);
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ height: 32, display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 28px", alignItems: "center", gap: 4 }}>
          <button type="button" onClick={onPrev} style={calendarNavButtonStyle()} aria-label={target === "start" ? "Lùi tháng bắt đầu" : "Lùi tháng kết thúc"}>
            <ChevronLeft size={14} strokeWidth={2.2} />
          </button>
          <div style={{ minWidth: 0, textAlign: "center" }}>
            <div style={{ color: C.textBright, fontSize: "0.76rem", fontWeight: 900 }}>{monthLabel(monthDate)}</div>
            <div style={{ color: C.textMuted, fontSize: "0.56rem", fontWeight: 850, marginTop: 1 }}>{target === "start" ? "Ngày bắt đầu" : "Ngày kết thúc"}</div>
          </div>
          <button type="button" onClick={onNext} style={calendarNavButtonStyle()} aria-label={target === "start" ? "Tiến tháng bắt đầu" : "Tiến tháng kết thúc"}>
            <ChevronRight size={14} strokeWidth={2.2} />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginTop: 6 }}>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} style={{ color: C.textMuted, fontSize: "0.6rem", fontWeight: 900, textAlign: "center", height: 22, lineHeight: "22px" }}>{label}</div>
          ))}
          {cells.map((day) => <CalendarDay key={`${target}-${monthLabel(monthDate)}-${dayKey(day)}`} day={day} monthDate={monthDate} target={target} />)}
        </div>
      </div>
    );
  }

  function CalendarDay({ day, monthDate, target }: { day: Date; monthDate: Date; target: "start" | "end" }) {
    const inMonth = day.getMonth() === monthDate.getMonth();
    const startSelected = draftStartDate ? sameDay(day, draftStartDate) : false;
    const endSelected = draftEndDate ? sameDay(day, draftEndDate) : false;
    const today = sameDay(day, new Date());
    const selected = inMonth && (target === "start" ? startSelected : endSelected);
    const rangeStart = draftStartDate?.getTime() ?? null;
    const rangeEnd = draftEndDate?.getTime() ?? null;
    const inRange = inMonth && rangeStart !== null && rangeEnd !== null && rangeEnd >= rangeStart && day.getTime() > rangeStart && day.getTime() < rangeEnd;
    const rangeFill = "rgba(96, 165, 250, 0.18)";
    return (
      <button
        type="button"
        disabled={!inMonth}
        onClick={() => selectCalendarDay(day, target)}
        style={{
          height: 30,
          minWidth: 0,
          borderRadius: selected ? 7 : 6,
          border: today && !selected && inMonth ? `1px solid ${C.primary}` : "1px solid transparent",
          background: selected ? C.primary : inRange ? rangeFill : "transparent",
          boxShadow: inRange && !selected ? `inset 0 0 0 1px ${rangeFill}` : "none",
          color: selected ? "#fff" : inRange ? C.primary : inMonth ? C.textBright : C.textDim,
          cursor: inMonth ? "pointer" : "default",
          fontSize: "0.72rem",
          fontWeight: selected ? 900 : 760,
          opacity: inMonth ? 1 : 0.38,
        }}
      >
        {day.getDate()}
      </button>
    );
  }

  function calendarNavButtonStyle(): React.CSSProperties {
    return {
      width: 28,
      height: 28,
      borderRadius: 7,
      border: `1px solid ${C.border}`,
      background: C.surface,
      color: C.textBase,
      display: "grid",
      placeItems: "center",
      cursor: "pointer",
    };
  }

  function sectionStyle(): React.CSSProperties {
    return {
      borderRadius: 8,
      border: `1px solid ${C.border}`,
      background: C.surface,
      padding: 12,
      display: "grid",
      gap: 12,
      minWidth: 0,
    };
  }

  function secondaryButtonStyle(): React.CSSProperties {
    return {
      height: 34,
      borderRadius: 7,
      border: `1px solid ${C.cardBorder}`,
      background: C.card,
      color: C.textBase,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 12px",
      cursor: "pointer",
      fontSize: "0.72rem",
      fontWeight: 850,
    };
  }

  function ModeButton({ active, icon, label, detail, onClick }: { active: boolean; icon: React.ReactNode; label: string; detail: string; onClick: () => void }) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          borderRadius: 8,
          border: `1px solid ${active ? C.primary : C.border}`,
          background: active ? C.primaryBg : C.surface,
          color: active ? C.primary : C.textBase,
          minHeight: 52,
          padding: "9px 10px",
          display: "flex",
          alignItems: "center",
          gap: 9,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center", background: C.card, border: `1px solid ${active ? `${C.primary}40` : C.border}` }}>
          {icon}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 900 }}>{label}</span>
          <span style={{ display: "block", color: C.textMuted, fontSize: "0.64rem", marginTop: 2 }}>{detail}</span>
        </span>
      </button>
    );
  }

  function PanelTitle({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center", color: C.primary, background: C.card, border: `1px solid ${C.border}`, flexShrink: 0 }}>{icon}</span>
          <span style={{ color: C.textBright, fontSize: "0.82rem", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        <span style={{ color: C.textMuted, fontSize: "0.64rem", fontWeight: 850, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
      </div>
    );
  }

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <label style={{ display: "grid", gap: 6, color: C.textMuted, fontSize: "0.66rem", fontWeight: 850 }}>
        {label}
        {children}
      </label>
    );
  }

  function ScopeItem({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
    return (
      <div style={{ minWidth: 0, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, padding: "9px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: C.primary, fontSize: "0.66rem", fontWeight: 850 }}>
          {icon}
          {title}
        </div>
        <div style={{ color: C.textBase, fontSize: "0.69rem", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>
          {value}
        </div>
      </div>
    );
  }

  function exportStatusLabel(status: ExportJobStatus): string {
    if (status === "queued") return "Chờ";
    if (status === "running") return "Đang chạy";
    if (status === "completed") return "Xong";
    return "Lỗi";
  }

  function ExportJobList({ jobs, activeJobId }: { jobs: ExportJob[]; activeJobId?: string }) {
    return (
      <div style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, overflow: "hidden", minWidth: 0 }}>
        <div style={{ minHeight: 34, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: `1px solid ${C.border}` }}>
          <span style={{ color: C.textBright, fontSize: "0.72rem", fontWeight: 900 }}>Job export chung</span>
          <span style={{ color: C.textMuted, fontSize: "0.62rem", fontWeight: 850 }}>{jobs.length} job</span>
        </div>
        <div style={{ display: "grid", gap: 0 }}>
          {jobs.slice(0, 6).map((job, index) => {
            const completed = job.status === "completed";
            const failed = job.status === "failed";
            const active = isExportJobActive(job);
            const fg = failed ? C.danger : completed ? C.success : C.primary;
            const rangeLabel = job.range?.from && job.range?.to ? formatShortRange(job.range.from, job.range.to) : "--";
            return (
              <div key={job.jobId} style={{ padding: "9px 10px", borderTop: index === 0 ? "none" : `1px solid ${C.border}`, display: "grid", gap: 7, background: job.jobId === activeJobId ? C.primaryBg : "transparent" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: fg, flexShrink: 0 }} />
                      <span style={{ color: C.textBright, fontSize: "0.7rem", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={job.fileName ?? job.stage}>
                        {job.fileName ?? job.stage}
                      </span>
                    </div>
                    <div style={{ color: failed ? C.danger : C.textMuted, fontSize: "0.62rem", fontWeight: 760, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={failed ? job.error : rangeLabel}>
                      {failed ? job.error || "Export thất bại" : rangeLabel}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                    <span style={{ color: fg, fontSize: "0.66rem", fontWeight: 900 }}>{exportStatusLabel(job.status)} · {Math.round(job.progress)}%</span>
                    {active ? <Loader2 size={13} color={fg} style={{ animation: "webSpin 0.8s linear infinite" }} /> : null}
                    {completed ? (
                      <button type="button" onClick={() => void handleExportJobDownload(job)} style={{ ...secondaryButtonStyle(), height: 28, padding: "0 9px", fontSize: "0.64rem" }}>
                        <Download size={12} />
                        Tải
                      </button>
                    ) : null}
                  </div>
                </div>
                <div style={{ height: 5, borderRadius: 999, background: C.surface, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, job.progress))}%`, background: fg, transition: "width 180ms ease" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: "0.6rem", fontWeight: 760, minWidth: 0 }}>
                  <span>{fmtDateTime(job.updatedAt)}</span>
                  <span>{job.sizeBytes ? fmtBytes(job.sizeBytes) : "--"}</span>
                  {job.manifest ? <span>{fmtCount(job.manifest.measurementCount)} điểm đo</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function ExportProgressCard({ job }: { job: ExportJob }) {
    const completed = job.status === "completed";
    const failed = job.status === "failed";
    const running = job.status === "queued" || job.status === "running";
    const fg = failed ? C.danger : completed ? C.success : C.primary;
    const bg = failed ? C.dangerBg : completed ? C.successBg : C.primaryBg;
    const manifest = job.manifest;
    return (
      <div style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, padding: 11, display: "grid", gap: 9, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center", background: bg, color: fg, flexShrink: 0 }}>
              {running ? <Loader2 size={14} style={{ animation: "webSpin 0.8s linear infinite" }} /> : completed ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", color: C.textBright, fontSize: "0.76rem", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {completed ? job.fileName ?? "Export hoàn tất" : failed ? "Export thất bại" : "Export đang chạy"}
              </span>
              <span style={{ display: "block", color: failed ? C.danger : C.textMuted, fontSize: "0.64rem", fontWeight: 800, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {failed ? job.error || "Không tạo được gói dữ liệu" : job.stage}
              </span>
            </span>
          </div>
          <span style={{ color: fg, fontSize: "0.78rem", fontWeight: 950, flexShrink: 0 }}>{Math.max(0, Math.min(100, Math.round(job.progress)))}%</span>
        </div>
        <div style={{ height: 7, borderRadius: 999, overflow: "hidden", background: C.surface, border: `1px solid ${C.border}` }}>
          <div style={{ height: "100%", width: `${Math.max(4, Math.min(100, job.progress))}%`, background: fg, transition: "width 180ms ease" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: "0.64rem", fontWeight: 800, minWidth: 0 }}>
            <span>{job.sizeBytes ? fmtBytes(job.sizeBytes) : "--"}</span>
            {manifest ? <span>{fmtCount(manifest.measurementCount)} điểm đo</span> : null}
            {manifest ? <span>{fmtCount(manifest.spectrumFrameCount)} phổ</span> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {failed ? (
              <button
                type="button"
                onClick={() => {
                  clearStoredExportJobId(job.jobId);
                  setExportJob(null);
                  setStatus("idle");
                  setMessage("");
                }}
                style={secondaryButtonStyle()}
              >
                Đóng
              </button>
            ) : null}
            {completed ? (
              <button type="button" onClick={() => void handleExportJobDownload(job)} style={secondaryButtonStyle()}>
                <Download size={13} />
                Tải lại
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function MiniStat({ label, value }: { label: string; value: string }) {
    return (
      <div style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, padding: "9px 10px", minWidth: 0 }}>
        <div style={{ color: C.textMuted, fontSize: "0.58rem", fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
        <div style={{ color: C.textBright, fontSize: "0.9rem", fontWeight: 900, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={value}>
          {value}
        </div>
      </div>
    );
  }

  function DevicePreview({ devices }: { devices: Array<Record<string, unknown>> }) {
    if (devices.length === 0) return null;
    return (
      <div style={{ borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden", background: C.card }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1.1fr) minmax(110px, 1fr) minmax(80px, 0.8fr)", gap: 10, padding: "8px 10px", borderBottom: `1px solid ${C.border}`, color: C.textMuted, fontSize: "0.6rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <span>Device</span>
          <span>Name</span>
          <span>Zone</span>
        </div>
        <div style={{ maxHeight: 150, overflow: "auto" }}>
          {devices.slice(0, 12).map((device, index) => (
            <div key={`${String(device.deviceId ?? index)}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1.1fr) minmax(110px, 1fr) minmax(80px, 0.8fr)", gap: 10, padding: "8px 10px", borderTop: index === 0 ? "none" : `1px solid ${C.border}`, color: C.textBase, fontSize: "0.7rem" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.textBright, fontWeight: 800 }}>{String(device.deviceId ?? "--")}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(device.name ?? "--")}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(device.zone ?? "--")}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function StatusBanner() {
    if (!message) {
      return <div style={{ color: C.textMuted, fontSize: "0.68rem", fontWeight: 750 }}>{activeMode === "export" ? "Chọn khoảng thời gian export." : "Chọn file để preview."}</div>;
    }
    const palette =
      status === "error"
        ? { fg: C.danger, bg: C.dangerBg, icon: <AlertTriangle size={14} /> }
        : status === "success"
          ? { fg: C.success, bg: C.successBg, icon: <CheckCircle2 size={14} /> }
          : { fg: C.textBase, bg: C.surface, icon: <Loader2 size={14} style={{ animation: "webSpin 0.8s linear infinite" }} /> };
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, maxWidth: 520, borderRadius: 7, background: palette.bg, color: palette.fg, padding: "7px 9px", fontSize: "0.7rem", fontWeight: 800 }}>
        {palette.icon}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message}</span>
      </div>
    );
  }
}
