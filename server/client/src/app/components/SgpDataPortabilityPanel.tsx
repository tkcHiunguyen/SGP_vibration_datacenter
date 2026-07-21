import { useState } from "react";
import { Download, Upload } from "lucide-react";

import { useTheme } from "../context/ThemeContext";
import { ExportJobPanel } from "./sgpdata/ExportJobPanel";
import { ImportJobHistory } from "./sgpdata/ImportJobHistory";
import { ImportJobProgress } from "./sgpdata/ImportJobProgress";
import { ImportUploadPanel } from "./sgpdata/ImportUploadPanel";
import { useImportJob } from "./sgpdata/hooks/useImportJob";
import type { SgpPortabilityMode } from "./sgpdata/types";

export function SgpDataPortabilityPanel({
  mode,
  allowModeSwitch = false,
}: {
  mode?: SgpPortabilityMode;
  allowModeSwitch?: boolean;
}) {
  const { C } = useTheme();
  const [internalMode, setInternalMode] = useState<SgpPortabilityMode>(mode ?? "export");
  const activeMode = mode ?? internalMode;
  const { job, history, pollError, track } = useImportJob();
  const importBusy = job?.status === "queued" || job?.status === "running" || job?.status === "validating";

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {allowModeSwitch ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <ModeButton active={activeMode === "export"} icon={<Download size={15} />} label="Export" detail="Tạo gói .sgpdata" onClick={() => setInternalMode("export")} />
          <ModeButton active={activeMode === "import"} icon={<Upload size={15} />} label="Import" detail="Upload một lần, theo dõi tiến trình" onClick={() => setInternalMode("import")} />
        </div>
      ) : null}

      <section style={{ border: `1px solid ${C.cardBorder}`, background: C.surface, borderRadius: 10, padding: 13, display: "grid", gap: 12, minWidth: 0 }}>
        {activeMode === "export" ? (
          <ExportJobPanel />
        ) : (
          <>
            <ImportUploadPanel busy={Boolean(importBusy)} onJobCreated={track} />
            {job ? <ImportJobProgress job={job} pollError={pollError} /> : null}
            <ImportJobHistory jobs={history} activeJobId={job?.jobId} />
          </>
        )}
      </section>
    </div>
  );

  function ModeButton({
    active,
    icon,
    label,
    detail,
    onClick,
  }: {
    active: boolean;
    icon: React.ReactNode;
    label: string;
    detail: string;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          border: `1px solid ${active ? C.primary : C.cardBorder}`,
          background: active ? C.primaryBg : C.card,
          color: active ? C.primary : C.textBase,
          borderRadius: 9,
          padding: "10px 12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 9,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ width: 31, height: 31, borderRadius: 8, display: "grid", placeItems: "center", border: `1px solid ${active ? C.primary : C.border}`, flexShrink: 0 }}>{icon}</span>
        <span style={{ minWidth: 0 }}>
          <strong style={{ color: active ? C.primary : C.textBright, display: "block", fontSize: "0.76rem" }}>{label}</strong>
          <span style={{ color: C.textMuted, display: "block", fontSize: "0.62rem", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
        </span>
      </button>
    );
  }
}
