import { AlertTriangle, CheckCircle2, Clock3, Loader2 } from "lucide-react";

import { useTheme } from "../../context/ThemeContext";
import { fmtDateTime } from "./api";
import type { ImportJob } from "./types";

export function ImportJobHistory({ jobs, activeJobId }: { jobs: ImportJob[]; activeJobId?: string }) {
  const { C } = useTheme();
  if (jobs.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong style={{ color: C.textBase, fontSize: "0.75rem" }}>Lịch sử import</strong>
      {jobs.slice(0, 10).map((job) => {
        const active = job.status === "queued" || job.status === "running" || job.status === "validating";
        const failed = job.status === "failed" || job.status === "interrupted";
        const color = failed ? C.danger : job.status === "completed" ? C.success : C.primary;
        return (
          <div key={job.jobId} style={{ border: `1px solid ${job.jobId === activeJobId ? C.primary : C.border}`, borderRadius: 8, padding: "8px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ minWidth: 0 }}>
              <strong style={{ color: C.textBright, fontSize: "0.75rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.fileName}</strong>
              <span style={{ color: C.textMuted, fontSize: "0.75rem" }}>{fmtDateTime(job.createdAt)} · {job.stage}</span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color, fontSize: "0.75rem", fontWeight: 850, flexShrink: 0 }}>
              {active ? <Loader2 size={13} style={{ animation: "webSpin 0.8s linear infinite" }} /> : failed ? <AlertTriangle size={13} /> : job.status === "completed" ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
              {job.overallProgress ?? job.progress}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
