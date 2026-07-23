import { AlertTriangle, CheckCircle2, Circle, Clock3, Gauge, Loader2, Server } from "lucide-react";

import { useTheme } from "../../context/ThemeContext";
import { fmtCount, fmtDateTime, fmtDuration } from "./api";
import type { ImportJob, ImportStage } from "./types";

const STEPS: Array<{ stage: ImportStage; label: string }> = [
  { stage: "uploading", label: "Upload file" },
  { stage: "validating", label: "Kiểm tra checksum" },
  { stage: "importing_zones", label: "Khu vực" },
  { stage: "importing_devices", label: "Thiết bị" },
  { stage: "replacing_data", label: "Xóa dữ liệu cũ" },
  { stage: "importing_placement_configs", label: "Cấu hình vị trí" },
  { stage: "importing_telemetry", label: "Telemetry" },
  { stage: "importing_spectrum", label: "Phổ FFT" },
  { stage: "rebuilding_summaries", label: "Tổng hợp biểu đồ" },
  { stage: "completed", label: "Hoàn tất" },
];

const ORDER: ImportStage[] = [
  "uploading", "validating", "preview_ready", "queued", "importing_zones", "importing_devices", "replacing_data", "importing_placement_configs",
  "importing_telemetry", "importing_spectrum", "rebuilding_summaries", "completed",
];

function stepState(job: ImportJob, stage: ImportStage): "waiting" | "running" | "done" | "error" {
  if ((job.status === "failed" || job.status === "interrupted") && job.stage === stage) return "error";
  if (job.stage === stage) return job.status === "completed" ? "done" : "running";
  const current = ORDER.indexOf(job.stage);
  const target = ORDER.indexOf(stage);
  return current > target || job.status === "completed" ? "done" : "waiting";
}

export function ImportJobProgress({ job, pollError }: { job: ImportJob; pollError?: string }) {
  const { C } = useTheme();
  const terminalError = job.status === "failed" || job.status === "interrupted";
  const active = !terminalError && job.status !== "completed";
  return (
    <section className="sgpdata-job-card sgpdata-panel-enter" style={{ border: `1px solid ${terminalError ? C.danger : C.cardBorder}`, borderRadius: 10, background: C.card, padding: 13, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span>
          <strong style={{ color: C.textBright, fontSize: "0.82rem" }}>Tiến trình import</strong>
          <span style={{ color: C.textMuted, fontSize: "0.66rem", display: "block", marginTop: 3 }}>{job.fileName} · cập nhật {fmtDateTime(job.updatedAt)}</span>
        </span>
        <strong style={{ color: terminalError ? C.danger : C.primary, fontSize: "1rem" }}>{job.overallProgress ?? job.progress}%</strong>
      </div>

      <ProgressBar value={job.overallProgress ?? job.progress} color={terminalError ? C.danger : C.primary} background={C.surface} active={active} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8 }}>
        <Metric icon={<Gauge size={13} />} label="Đã xử lý" value={`${fmtCount(job.processedRecords)}/${fmtCount(job.totalRecords)}`} />
        <Metric icon={<CheckCircle2 size={13} />} label="Inserted / updated" value={`${fmtCount(job.inserted)} / ${fmtCount(job.updated)}`} />
        <Metric icon={<AlertTriangle size={13} />} label="Skipped / failed" value={`${fmtCount(job.skipped)} / ${fmtCount(job.failed)}`} />
        <Metric icon={<Server size={13} />} label="Thiết bị hiện tại" value={job.currentDeviceId ?? "--"} />
        <Metric icon={<Gauge size={13} />} label="Tốc độ" value={`${fmtCount(Math.round(job.recordsPerSecond || 0))} record/s`} />
        <Metric icon={<Clock3 size={13} />} label="Còn lại / đã chạy" value={`${fmtDuration(job.estimatedSecondsRemaining)} / ${fmtDuration(job.elapsedSeconds)}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 7 }}>
        {STEPS.filter((step) => step.stage !== "replacing_data" || job.mode === "replace").map((step) => {
          const state = stepState(job, step.stage);
          const color = state === "done" ? C.success : state === "running" ? C.primary : state === "error" ? C.danger : C.textDim;
          return (
            <div className={`sgpdata-step is-${state}`} key={step.stage} style={{ border: `1px solid ${state === "running" ? C.primary : C.border}`, borderRadius: 8, padding: "8px 9px", display: "flex", alignItems: "center", gap: 7, color }}>
              {state === "done" ? <CheckCircle2 size={14} /> : state === "running" ? <Loader2 size={14} style={{ animation: "webSpin 0.8s linear infinite" }} /> : state === "error" ? <AlertTriangle size={14} /> : <Circle size={14} />}
              <span style={{ fontSize: "0.67rem", fontWeight: 850 }}>{step.label}</span>
            </div>
          );
        })}
      </div>

      {job.devices && job.devices.length > 0 ? (
        <div style={{ display: "grid", gap: 7 }}>
          <strong style={{ color: C.textBase, fontSize: "0.7rem" }}>Theo từng thiết bị</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 7, maxHeight: 220, overflow: "auto" }}>
            {job.devices.map((device) => {
              const done = device.measurementsProcessed + device.spectrumProcessed;
              const total = device.measurementsTotal + device.spectrumTotal;
              const progress = total > 0 ? Math.round((done / total) * 100) : device.status === "completed" ? 100 : 0;
              return (
                <div className="sgpdata-metric-card" key={device.deviceId} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 9, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.textBright, fontSize: "0.68rem", fontWeight: 850 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{device.name || device.deviceId}</span><span>{progress}%</span>
                  </div>
                  <ProgressBar value={progress} color={device.status === "failed" ? C.danger : C.success} background={C.surface} compact active={device.status === "running"} />
                  <span style={{ color: C.textMuted, fontSize: "0.62rem" }}>{fmtCount(done)}/{fmtCount(total)} record · {device.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {job.events && job.events.length > 0 ? (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 9, display: "grid", gap: 5, maxHeight: 180, overflow: "auto" }}>
          <strong style={{ color: C.textBase, fontSize: "0.7rem" }}>Sự kiện gần nhất</strong>
          {[...job.events].reverse().map((event, index) => (
            <div key={`${event.at}-${index}`} style={{ display: "grid", gridTemplateColumns: "125px minmax(0, 1fr)", gap: 8, color: C.textMuted, fontSize: "0.63rem" }}>
              <span>{fmtDateTime(event.at)}</span><span style={{ color: C.textBase }}>{event.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {job.error || pollError ? (
        <div style={{ border: `1px solid ${C.danger}55`, background: C.dangerBg, color: C.danger, borderRadius: 8, padding: 9, fontSize: "0.7rem", fontWeight: 800 }}>
          {job.error || pollError}
        </div>
      ) : null}
    </section>
  );

  function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 9px", minWidth: 0 }}>
        <span style={{ color: C.textMuted, fontSize: "0.61rem", fontWeight: 800, display: "flex", gap: 5, alignItems: "center" }}>{icon}{label}</span>
        <strong style={{ color: C.textBright, fontSize: "0.74rem", display: "block", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</strong>
      </div>
    );
  }
}

function ProgressBar({ value, color, background, compact = false, active = false }: { value: number; color: string; background: string; compact?: boolean; active?: boolean }) {
  return (
    <div className="sgpdata-progress-track" style={{ height: compact ? 5 : 9, borderRadius: 999, background, overflow: "hidden" }}>
      <div className={`sgpdata-progress-fill${active ? " is-active" : ""}`} style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", backgroundColor: color }} />
    </div>
  );
}
