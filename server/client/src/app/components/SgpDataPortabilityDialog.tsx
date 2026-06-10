import React, { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  HardDriveDownload,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";

type Mode = "export" | "import";
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
  fileName?: string;
  devices?: ImportBucket;
  measurements?: ImportBucket;
  spectrum?: ImportBucket;
  placementConfigs?: { written?: number; skipped?: number };
};

function fmtDateTime(value?: string): string {
  if (!value) return "--";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("vi-VN");
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

export function SgpDataPortabilityDialog({ onClose }: { onClose: () => void }) {
  const { C } = useTheme();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<Mode>("export");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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

  const exportDisabled = status === "loading" || !from || !to;

  function reset(nextMode = mode): void {
    setMode(nextMode);
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
    setMessage("Đang đóng gói dữ liệu...");
    try {
      const query = new URLSearchParams();
      query.set("date_from", new Date(from).toISOString());
      query.set("date_to", new Date(to).toISOString());
      const response = await fetch(`/api/sgpdata/export?${query}`);
      if (!response.ok) throw new Error(await readError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const name = match?.[1] || `sgp-data-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.sgpdata`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("success");
      setMessage(`Đã tải ${name} (${fmtBytes(blob.size)}).`);
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
    height: 38,
    borderRadius: 8,
    border: `1px solid ${C.cardBorder}`,
    background: C.input,
    color: C.textBright,
    padding: "0 11px",
    fontSize: "0.75rem",
    outline: "none",
    minWidth: 0,
  };
  const iconButton: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.textBase,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  };
  const primaryButton: React.CSSProperties = {
    height: 38,
    borderRadius: 8,
    border: `1px solid ${C.primary}`,
    background: C.primary,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "0 14px",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 800,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 130,
        background: "rgba(2,6,23,0.55)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        style={{
          width: "min(900px, 100%)",
          maxHeight: "min(720px, 92vh)",
          overflow: "hidden",
          borderRadius: 12,
          border: `1px solid ${C.cardBorder}`,
          background: C.card,
          boxShadow: "0 26px 80px rgba(2,6,23,0.52)",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom: `1px solid ${C.border}`,
            background: C.headerBg,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: C.primaryBg, color: C.primary, display: "grid", placeItems: "center", border: `1px solid ${C.primary}24` }}>
              <FileArchive size={18} strokeWidth={2.1} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.textBright, fontSize: "0.96rem", fontWeight: 900 }}>Gói dữ liệu .sgpdata</div>
              <div style={{ color: C.textMuted, fontSize: "0.7rem", marginTop: 2 }}>Telemetry, spectrum, manifest, cấu hình vị trí</div>
            </div>
          </div>
          <button onClick={onClose} style={iconButton} aria-label="Đóng">
            <X size={15} />
          </button>
        </header>

        <div style={{ minHeight: 0, overflow: "auto", padding: 16, display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <ModeButton active={mode === "export"} icon={<Download size={14} />} label="Export" detail="Production -> file" onClick={() => reset("export")} />
            <ModeButton active={mode === "import"} icon={<Upload size={14} />} label="Import" detail="File -> máy dev" onClick={() => reset("import")} />
          </div>

          {mode === "export" ? (
            <section style={sectionStyle()}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                <Field label="Từ ngày">
                  <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Đến ngày">
                  <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <ScopeItem icon={<Database size={14} />} title="Telemetry" value="raw history" />
                <ScopeItem icon={<HardDriveDownload size={14} />} title="Spectrum" value="file phổ" />
                <ScopeItem icon={<CalendarClock size={14} />} title="Range" value={from && to ? `${fmtDateTime(from)} - ${fmtDateTime(to)}` : "--"} />
              </div>
            </section>
          ) : (
            <section style={sectionStyle()}>
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
                  borderRadius: 10,
                  border: `1.5px dashed ${dragActive ? C.primary : C.cardBorder}`,
                  background: dragActive ? C.primaryBg : C.surface,
                  padding: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  cursor: "pointer",
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".sgpdata,application/octet-stream,application/zip"
                  onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, color: C.primary, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Upload size={17} strokeWidth={2.1} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: C.textBright, fontSize: "0.82rem", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {file ? file.name : "Chọn file .sgpdata"}
                    </div>
                    <div style={{ color: C.textMuted, fontSize: "0.7rem", marginTop: 3 }}>
                      {file ? fmtBytes(file.size) : "Kéo thả hoặc bấm để chọn file"}
                    </div>
                  </div>
                </div>
                <span style={{ color: C.primary, fontSize: "0.68rem", fontWeight: 850, flexShrink: 0 }}>Browse</span>
              </div>

              {preview ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
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
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 16px",
            borderTop: `1px solid ${C.border}`,
            background: C.headerBg,
            flexWrap: "wrap",
          }}
        >
          <StatusBanner />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {mode === "import" ? (
              <button
                disabled={!file || status === "loading"}
                onClick={() => runPreview()}
                style={{ ...secondaryButtonStyle(), opacity: !file || status === "loading" ? 0.5 : 1 }}
              >
                Preview
              </button>
            ) : null}
            <button
              disabled={mode === "export" ? exportDisabled : !file || !preview || status === "loading"}
              onClick={mode === "export" ? runExport : runImport}
              style={{
                ...primaryButton,
                opacity: mode === "export" ? (exportDisabled ? 0.55 : 1) : !file || !preview || status === "loading" ? 0.55 : 1,
                cursor: status === "loading" ? "wait" : "pointer",
              }}
            >
              {status === "loading" ? <Loader2 size={14} style={{ animation: "webSpin 0.8s linear infinite" }} /> : mode === "export" ? <Download size={14} /> : <Upload size={14} />}
              {mode === "export" ? "Tải .sgpdata" : "Import"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  function sectionStyle(): React.CSSProperties {
    return {
      borderRadius: 10,
      border: `1px solid ${C.border}`,
      background: C.surface,
      padding: 14,
      display: "grid",
      gap: 14,
    };
  }

  function secondaryButtonStyle(): React.CSSProperties {
    return {
      height: 38,
      borderRadius: 8,
      border: `1px solid ${C.cardBorder}`,
      background: C.card,
      color: C.textBase,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 13px",
      cursor: "pointer",
      fontSize: "0.74rem",
      fontWeight: 800,
    };
  }

  function ModeButton({ active, icon, label, detail, onClick }: { active: boolean; icon: React.ReactNode; label: string; detail: string; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        style={{
          borderRadius: 10,
          border: `1px solid ${active ? C.primary : C.border}`,
          background: active ? C.primaryBg : C.surface,
          color: active ? C.primary : C.textBase,
          minHeight: 58,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: active ? C.card : C.card, border: `1px solid ${active ? `${C.primary}40` : C.border}` }}>
          {icon}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 900 }}>{label}</span>
          <span style={{ display: "block", color: C.textMuted, fontSize: "0.66rem", marginTop: 2 }}>{detail}</span>
        </span>
      </button>
    );
  }

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <label style={{ display: "grid", gap: 6, color: C.textMuted, fontSize: "0.68rem", fontWeight: 800 }}>
        {label}
        {children}
      </label>
    );
  }

  function ScopeItem({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
    return (
      <div style={{ minWidth: 0, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, padding: "10px 11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: C.primary, fontSize: "0.68rem", fontWeight: 850 }}>
          {icon}
          {title}
        </div>
        <div style={{ color: C.textBase, fontSize: "0.7rem", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>
          {value}
        </div>
      </div>
    );
  }

  function MiniStat({ label, value }: { label: string; value: string }) {
    return (
      <div style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, padding: "10px 11px", minWidth: 0 }}>
        <div style={{ color: C.textMuted, fontSize: "0.6rem", fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
        <div style={{ color: C.textBright, fontSize: "0.95rem", fontWeight: 900, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={value}>
          {value}
        </div>
      </div>
    );
  }

  function DevicePreview({ devices }: { devices: Array<Record<string, unknown>> }) {
    if (devices.length === 0) return null;
    return (
      <div style={{ borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden", background: C.card }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.1fr) minmax(120px, 1fr) minmax(90px, 0.8fr)", gap: 10, padding: "8px 10px", borderBottom: `1px solid ${C.border}`, color: C.textMuted, fontSize: "0.62rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <span>Device</span>
          <span>Name</span>
          <span>Zone</span>
        </div>
        <div style={{ maxHeight: 168, overflow: "auto" }}>
          {devices.slice(0, 12).map((device, index) => (
            <div key={`${String(device.deviceId ?? index)}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.1fr) minmax(120px, 1fr) minmax(90px, 0.8fr)", gap: 10, padding: "9px 10px", borderTop: index === 0 ? "none" : `1px solid ${C.border}`, color: C.textBase, fontSize: "0.72rem" }}>
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
      return <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>{mode === "export" ? "Chọn khoảng thời gian export." : "Chọn file để preview."}</div>;
    }
    const palette =
      status === "error"
        ? { fg: C.danger, bg: C.dangerBg, icon: <AlertTriangle size={14} /> }
        : status === "success"
          ? { fg: C.success, bg: C.successBg, icon: <CheckCircle2 size={14} /> }
          : { fg: C.textBase, bg: C.surface, icon: <Loader2 size={14} style={{ animation: "webSpin 0.8s linear infinite" }} /> };
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: 520, borderRadius: 8, background: palette.bg, color: palette.fg, padding: "8px 10px", fontSize: "0.72rem", fontWeight: 750 }}>
        {palette.icon}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message}</span>
      </div>
    );
  }
}
