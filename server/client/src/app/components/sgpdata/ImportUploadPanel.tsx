import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileArchive, Loader2, ShieldCheck, Upload } from "lucide-react";

import { useTheme } from "../../context/ThemeContext";
import { fmtBytes, fmtCount, requestJson } from "./api";
import type { ImportJob, ImportMode, Preview } from "./types";

function parseUploadResponse(xhr: XMLHttpRequest): ImportJob {
  let parsed: { data?: ImportJob; error?: string } | ImportJob;
  try {
    parsed = JSON.parse(xhr.responseText) as { data?: ImportJob; error?: string } | ImportJob;
  } catch {
    throw new Error(xhr.responseText || `Upload thất bại (${xhr.status})`);
  }
  if (xhr.status < 200 || xhr.status >= 300) {
    throw new Error("error" in parsed && parsed.error ? parsed.error : `Upload thất bại (${xhr.status})`);
  }
  return "data" in parsed && parsed.data ? parsed.data : parsed as ImportJob;
}

export function ImportUploadPanel({
  busy,
  onJobCreated,
}: {
  busy: boolean;
  onJobCreated: (job: ImportJob) => void;
}) {
  const { C } = useTheme();
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploadId, setUploadId] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [checksumInvalid, setChecksumInvalid] = useState(false);
  const replaceAvailable = Boolean(preview?.metadata.dateFrom && preview?.metadata.dateTo);

  useEffect(() => () => xhrRef.current?.abort(), []);

  function chooseFile(next: File | null): void {
    xhrRef.current?.abort();
    setFile(next);
    setPreview(null);
    setUploadId("");
    setMode("merge");
    setUploadProgress(0);
    setMessage("");
    setError("");
    setChecksumInvalid(false);
    if (next) uploadOnce(next);
  }

  function uploadOnce(next: File): void {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    setUploading(true);
    setMessage("Đang upload file lên server...");
    const body = new FormData();
    body.append("file", next);
    xhr.open("POST", "/api/sgpdata/import/uploads");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setUploadProgress(progress);
      if (progress === 100) setMessage("Upload xong, server đang kiểm tra checksum và nội dung...");
    };
    xhr.onerror = () => {
      setUploading(false);
      setError("Mất kết nối trong lúc upload file");
    };
    xhr.onabort = () => setUploading(false);
    xhr.onload = () => {
      setUploading(false);
      try {
        const job = parseUploadResponse(xhr);
        setUploadProgress(100);
        setUploadId(job.uploadId);
        setPreview(job.preview ?? null);
        setMessage("File hợp lệ. Chọn chế độ và bắt đầu import.");
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : "Không thể kiểm tra file";
        setChecksumInvalid(detail.includes("sgpdata_checksum_mismatch"));
        setError(
          detail.includes("sgpdata_checksum_mismatch")
            ? "Checksum SHA-256 không hợp lệ; file có thể đã bị sửa hoặc bị cắt."
            : detail.includes("sgpdata_v1_unsupported")
              ? "File .sgpdata v1 không còn được hỗ trợ. Hãy tạo lại file bằng phiên bản export hiện tại."
              : detail,
        );
      }
    };
    xhr.send(body);
  }

  async function startImport(): Promise<void> {
    if (!uploadId || busy || submitting) return;
    setSubmitting(true);
    setError("");
    setMessage("Đang đưa job vào hàng đợi...");
    try {
      const job = await requestJson<ImportJob>("/api/sgpdata/import/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId, mode }),
      });
      onJobCreated(job);
      setMessage("Job đã bắt đầu. Bạn có thể reload trang mà không mất tiến trình.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể bắt đầu import");
    } finally {
      setSubmitting(false);
    }
  }

  const stats = preview?.metadata;
  const uploadBusy = uploading || (uploadProgress === 100 && !preview && !error);
  return (
    <div className="sgpdata-panel-enter" style={{ display: "grid", gap: 12 }}>
      <label
        className={`dc-file-drop-zone sgpdata-drop-zone${dragActive ? " is-active" : ""}`}
        htmlFor="sgpdata-import-file"
        onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          chooseFile(event.dataTransfer.files?.[0] ?? null);
        }}
        style={{
          borderRadius: 10,
          border: `1.5px dashed ${dragActive ? C.primary : C.cardBorder}`,
          background: dragActive ? C.primaryBg : C.surface,
          color: C.primary,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: uploading ? "wait" : "pointer",
          minWidth: 0,
        }}
      >
        <input
          id="sgpdata-import-file"
          className="dc-file-input-native"
          type="file"
          accept=".sgpdata,application/octet-stream,application/zip"
          aria-label="Chọn file .sgpdata để nhập dữ liệu"
          disabled={uploading}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />
        <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <span style={{ width: 38, height: 38, borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, color: C.primary, display: "grid", placeItems: "center", flexShrink: 0 }}>
            {uploading ? <Loader2 size={17} style={{ animation: "webSpin 0.8s linear infinite" }} /> : <Upload size={17} />}
          </span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: "block", color: C.textBright, fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file?.name ?? "Chọn file .sgpdata"}
            </strong>
            <span style={{ color: C.textMuted, fontSize: "0.75rem" }}>{file ? fmtBytes(file.size) : "Kéo thả hoặc bấm để chọn"}</span>
          </span>
        </span>
        <span style={{ color: C.primary, fontSize: "0.75rem", fontWeight: 850 }}>Browse</span>
      </label>

      {file ? (
        <div style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 9, padding: 11, display: "grid", gap: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: C.textBase, fontSize: "0.75rem", fontWeight: 800 }}>
            <span>{uploadProgress < 100 ? "Tiến trình upload" : preview ? "Upload và kiểm tra hoàn tất" : "Đang kiểm tra trên server"}</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="sgpdata-progress-track" style={{ height: 8, borderRadius: 999, background: C.surface, overflow: "hidden" }}>
            <div className={`sgpdata-progress-fill${uploadBusy ? " is-active" : ""}`} style={{ width: `${uploadProgress}%`, height: "100%", backgroundColor: preview ? C.success : C.primary }} />
          </div>
        </div>
      ) : null}

      {stats ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 8 }}>
            <MiniStat icon={<FileArchive size={14} />} label="Thiết bị" value={fmtCount(stats.deviceCount)} />
            <MiniStat icon={<FileArchive size={14} />} label="Khu vực" value={fmtCount(stats.zoneCount)} />
            <MiniStat icon={<FileArchive size={14} />} label="Cấu hình vị trí" value={fmtCount(stats.placementConfigCount)} />
            <MiniStat icon={<FileArchive size={14} />} label="Điểm đo" value={fmtCount(stats.measurementCount)} />
            <MiniStat icon={<FileArchive size={14} />} label="Phổ FFT" value={fmtCount(stats.spectrumCount)} />
            <MiniStat icon={<ShieldCheck size={14} />} label="Checksum" value={stats.checksumValid ? "Hợp lệ" : "Không hợp lệ"} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["merge", "replace"] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={value === "replace" && !replaceAvailable}
                onClick={() => setMode(value)}
                className="sgpdata-action-button"
                style={{
                  minHeight: 34,
                  borderRadius: 8,
                  border: `1px solid ${mode === value ? C.primary : C.cardBorder}`,
                  background: mode === value ? C.primaryBg : C.card,
                  color: mode === value ? C.primary : C.textBase,
                  padding: "0 12px",
                  cursor: value === "replace" && !replaceAvailable ? "not-allowed" : "pointer",
                  opacity: value === "replace" && !replaceAvailable ? 0.5 : 1,
                  fontSize: "0.75rem",
                  fontWeight: 850,
                }}
              >
                {value === "merge" ? "Bổ sung dữ liệu" : "Thay thế dữ liệu"}
              </button>
            ))}
          </div>
          {mode === "replace" ? (
            <div style={{ border: `1px solid ${C.danger}55`, background: C.dangerBg, color: C.danger, borderRadius: 8, padding: 10, fontSize: "0.75rem", fontWeight: 800 }}>
              Dữ liệu cũ của các thiết bị trong đúng khoảng thời gian của file sẽ bị xóa trước khi import.
            </div>
          ) : null}
          {!replaceAvailable ? (
            <div style={{ color: C.textMuted, fontSize: "0.75rem", fontWeight: 700 }}>
              File không có khoảng thời gian nên chỉ có thể bổ sung dữ liệu an toàn.
            </div>
          ) : null}
          <button
            className="sgpdata-action-button"
            type="button"
            disabled={!uploadId || busy || submitting}
            onClick={() => void startImport()}
            style={{
              minHeight: 38,
              borderRadius: 8,
              border: `1px solid ${C.primary}`,
              background: C.primary,
              color: "#fff",
              cursor: !uploadId || busy || submitting ? "not-allowed" : "pointer",
              opacity: !uploadId || busy || submitting ? 0.55 : 1,
              fontSize: "0.76rem",
              fontWeight: 900,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {submitting ? <Loader2 size={15} style={{ animation: "webSpin 0.8s linear infinite" }} /> : <CheckCircle2 size={15} />}
            {busy ? "Đang có job import chạy" : "Bắt đầu import từ file đã upload"}
          </button>
        </>
      ) : null}

      {checksumInvalid ? (
        <div style={{ border: `1px solid ${C.danger}55`, background: C.dangerBg, color: C.danger, borderRadius: 8, padding: 10, display: "flex", alignItems: "center", gap: 7, fontSize: "0.75rem", fontWeight: 850 }}>
          <ShieldCheck size={15} /> Checksum: không hợp lệ
        </div>
      ) : null}

      {message ? <div style={{ color: C.textMuted, fontSize: "0.75rem" }}>{message}</div> : null}
      {error ? <div style={{ color: C.danger, fontSize: "0.75rem", fontWeight: 800 }}>{error}</div> : null}
    </div>
  );

  function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
      <div className="sgpdata-metric-card" style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 8, padding: "9px 10px", minWidth: 0 }}>
        <span style={{ color: C.textMuted, fontSize: "0.75rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>{icon}{label}</span>
        <strong style={{ color: C.textBright, fontSize: "0.82rem", display: "block", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</strong>
      </div>
    );
  }
}
