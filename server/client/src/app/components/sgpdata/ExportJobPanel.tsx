import { useEffect, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Database, Download, HardDriveDownload, Loader2, ShieldCheck } from "lucide-react";

import { useTheme } from "../../context/ThemeContext";
import { fmtBytes, fmtCount, fmtDateTime, requestJson } from "./api";
import { useExportJob } from "./hooks/useExportJob";
import type { ExportJob } from "./types";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

function startOfWeek(date: Date): Date {
  const offset = date.getDay() === 0 ? -6 : 1 - date.getDay();
  return startOfDay(addDays(date, offset));
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function directDownload(job: ExportJob): void {
  const anchor = document.createElement("a");
  anchor.href = `/api/sgpdata/export/jobs/${encodeURIComponent(job.jobId)}/download`;
  if (job.fileName) anchor.download = job.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ExportJobPanel() {
  const { C } = useTheme();
  const { job, history, pollError, track } = useExportJob();
  const downloadedRef = useRef(new Set<string>());
  const now = new Date();
  const [from, setFrom] = useState(localInput(startOfDay(now)));
  const [to, setTo] = useState(localInput(now));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (job?.status !== "completed" || downloadedRef.current.has(job.jobId)) return;
    downloadedRef.current.add(job.jobId);
    directDownload(job);
    setMessage(`Export hoàn tất: ${job.fileName ?? job.jobId}`);
  }, [job?.jobId, job?.status]);

  function preset(value: "today" | "yesterday" | "last-week" | "last-month" | "last-3-months"): void {
    const current = new Date();
    let start = startOfDay(current);
    let end = current;
    if (value === "yesterday") {
      start = startOfDay(addDays(current, -1));
      end = endOfDay(start);
    } else if (value === "last-week") {
      start = addDays(startOfWeek(current), -7);
      end = endOfDay(addDays(start, 6));
    } else if (value === "last-month") {
      start = new Date(current.getFullYear(), current.getMonth() - 1, 1, 0, 0, 0, 0);
      end = endOfDay(addDays(startOfMonth(current), -1));
    } else if (value === "last-3-months") {
      start = startOfDay(new Date(current.getFullYear(), current.getMonth() - 3, current.getDate()));
    }
    setFrom(localInput(start));
    setTo(localInput(end));
  }

  async function createJob(): Promise<void> {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!from || !to || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
      setError("Khoảng thời gian export không hợp lệ");
      return;
    }
    fromDate.setSeconds(0, 0);
    toDate.setSeconds(59, 999);
    setSubmitting(true);
    setError("");
    setMessage("Đang tạo job export...");
    try {
      const next = await requestJson<ExportJob>("/api/sgpdata/export/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date_from: fromDate.toISOString(), date_to: toDate.toISOString() }),
      });
      track(next);
      setMessage("Job export đã bắt đầu");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo job export");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    minHeight: 38,
    borderRadius: 8,
    border: `1px solid ${C.cardBorder}`,
    background: C.input,
    color: C.textBright,
    padding: "0 10px",
    fontSize: "0.72rem",
    outline: "none",
    minWidth: 0,
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
        <label style={{ display: "grid", gap: 5, color: C.textMuted, fontSize: "0.64rem", fontWeight: 800 }}>Từ ngày<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} style={inputStyle} /></label>
        <label style={{ display: "grid", gap: 5, color: C.textMuted, fontSize: "0.64rem", fontWeight: 800 }}>Đến ngày<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} style={inputStyle} /></label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {([['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['last-week', 'Tuần trước'], ['last-month', 'Tháng trước'], ['last-3-months', '3 tháng']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => preset(key)} style={{ border: `1px solid ${C.border}`, background: C.card, color: C.textBase, borderRadius: 7, minHeight: 30, padding: "0 9px", fontSize: "0.65rem", fontWeight: 800, cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        <Scope icon={<Database size={14} />} title="Telemetry" value="Xuất theo cursor/batch" />
        <Scope icon={<HardDriveDownload size={14} />} title="Spectrum" value="Đọc từng frame" />
        <Scope icon={<ShieldCheck size={14} />} title="Integrity" value="SHA-256 incremental" />
        <Scope icon={<CalendarClock size={14} />} title="Range" value={`${from.replace("T", " ")} → ${to.replace("T", " ")}`} />
      </div>
      <button type="button" disabled={active || submitting} onClick={() => void createJob()} style={{ minHeight: 38, borderRadius: 8, border: `1px solid ${C.primary}`, background: C.primary, color: "#fff", opacity: active || submitting ? 0.55 : 1, cursor: active || submitting ? "not-allowed" : "pointer", fontSize: "0.75rem", fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {active || submitting ? <Loader2 size={15} style={{ animation: "webSpin 0.8s linear infinite" }} /> : <Download size={15} />}
        {active ? "Đang export" : "Tạo job export"}
      </button>

      {job ? (
        <div style={{ border: `1px solid ${job.status === "failed" ? C.danger : C.cardBorder}`, borderRadius: 9, padding: 11, background: C.card, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><strong style={{ color: C.textBright, fontSize: "0.76rem" }}>{job.stage}</strong><strong style={{ color: job.status === "failed" ? C.danger : C.primary }}>{job.progress}%</strong></div>
          <div style={{ height: 8, borderRadius: 999, background: C.surface, overflow: "hidden" }}><div style={{ width: `${job.progress}%`, height: "100%", background: job.status === "completed" ? C.success : job.status === "failed" ? C.danger : C.primary, transition: "width 220ms ease" }} /></div>
          <div style={{ color: C.textMuted, fontSize: "0.65rem" }}>{job.fileName ?? job.jobId} · {fmtBytes(job.sizeBytes)}</div>
          {job.status === "completed" ? <button type="button" onClick={() => directDownload(job)} style={{ border: `1px solid ${C.success}`, background: C.successBg, color: C.success, borderRadius: 7, minHeight: 32, cursor: "pointer", fontWeight: 850 }}><Download size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />Tải lại file</button> : null}
          {job.error ? <div style={{ color: C.danger, fontSize: "0.68rem", fontWeight: 800 }}>{job.error}</div> : null}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          <strong style={{ color: C.textBase, fontSize: "0.7rem" }}>Lịch sử export</strong>
          {history.slice(0, 10).map((item) => (
            <div key={item.jobId} style={{ border: `1px solid ${item.jobId === job?.jobId ? C.primary : C.border}`, borderRadius: 8, padding: "8px 9px", display: "flex", justifyContent: "space-between", gap: 9 }}>
              <span style={{ minWidth: 0 }}><strong style={{ color: C.textBright, fontSize: "0.67rem", display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{item.fileName ?? item.stage}</strong><span style={{ color: C.textMuted, fontSize: "0.61rem" }}>{fmtDateTime(item.createdAt)}</span></span>
              <span style={{ color: item.status === "completed" ? C.success : item.status === "failed" ? C.danger : C.primary, fontSize: "0.65rem", fontWeight: 850 }}>{item.progress}%</span>
            </div>
          ))}
        </div>
      ) : null}
      {message ? <div style={{ color: C.textMuted, fontSize: "0.68rem" }}>{message}</div> : null}
      {error || pollError ? <div style={{ color: C.danger, fontSize: "0.7rem", fontWeight: 800 }}>{error || pollError}</div> : null}
    </div>
  );

  function Scope({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
    return <div style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 8, padding: "9px 10px" }}><span style={{ color: C.primary, display: "flex", alignItems: "center", gap: 5, fontSize: "0.64rem", fontWeight: 850 }}>{icon}{title}</span><strong style={{ color: C.textBright, fontSize: "0.69rem", display: "block", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</strong></div>;
  }
}
