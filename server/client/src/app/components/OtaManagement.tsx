import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileCode2,
  Loader2,
  RefreshCw,
  Send,
  ServerCrash,
  UploadCloud,
  Wifi,
  WifiOff,
  XCircle,
  ZapOff,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";

// ─── Types ───────────────────────────────────────────────────────────────────
type OtaCommandType = "ota" | "ota_from_url";
type OtaPhase = "queued" | "in_progress" | "await_reboot_confirm" | "confirmed" | "failed" | "timeout";

type DeviceItem = {
  deviceId: string;
  online: boolean;
  socketConnected: boolean;
  metadata: Record<string, unknown>;
};

type UploadResult = {
  fileName: string;
  originalName: string;
  sizeBytes: number;
  url: string;
  uploadedAt: string;
};

type DispatchItem = {
  deviceId: string;
  status: "accepted" | "failed";
  commandId?: string;
  reason?: string;
};

type DispatchResult = {
  runId: string;
  commandType: OtaCommandType;
  total: number;
  accepted: number;
  failed: number;
  startedAt: string;
  items: DispatchItem[];
};

type ProgressRow = {
  deviceId: string;
  commandId?: string;
  phase: OtaPhase;
  phaseLabel: string;
  ackStatus: string;
  ackDetail: string;
};

type JsonResult = { ok: boolean; status: number; payload: unknown };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return !v || typeof v !== "object" || Array.isArray(v) ? {} : (v as Record<string, unknown>);
}
function asArray(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function firstArray(...vs: unknown[]): unknown[] { for (const v of vs) if (Array.isArray(v)) return v; return []; }
function toText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) { const p = Number(v); if (Number.isFinite(p)) return p; }
  return 0;
}
function safeLabel(v: unknown, fb = "-"): string { return toText(v) || fb; }
function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}
async function requestJson(url: string, init?: RequestInit): Promise<JsonResult> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let payload: unknown = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
    return { ok: res.ok, status: res.status, payload };
  } catch (e) { return { ok: false, status: 0, payload: { error: String(e) } }; }
}
function parseDevices(payload: unknown): DeviceItem[] {
  const root = asRecord(payload);
  const list = firstArray(root.data, root.items, root.results, payload);
  return list.map(asRecord).map((item) => {
    const online = Boolean(item.online);
    const scRaw = item.socketConnected ?? item.socket_connected;
    const sc = typeof scRaw === "boolean" ? scRaw : online;
    return { deviceId: toText(item.deviceId || item.device_id || item.id), online, socketConnected: sc, metadata: asRecord(item.metadata) };
  }).filter((d) => Boolean(d.deviceId) && d.online && d.socketConnected);
}
function extractFw(m: Record<string, unknown>): string {
  return toText(m.firmwareVersion) || toText(m.version_firmware) || toText(m.firmware) || "";
}
function extractDispatch(payload: unknown): DispatchResult | null {
  const root = asRecord(payload);
  const data = asRecord(root.data || payload);
  const runId = toText(data.runId);
  if (!runId) return null;
  return {
    runId,
    commandType: (toText(data.commandType) as OtaCommandType) || "ota",
    total: toNumber(data.total), accepted: toNumber(data.accepted), failed: toNumber(data.failed),
    startedAt: toText(data.startedAt) || new Date().toISOString(),
    items: asArray(data.items).map(asRecord).map((i): DispatchItem => ({
      deviceId: toText(i.deviceId),
      status: toText(i.status) === "accepted" ? "accepted" : "failed",
      commandId: toText(i.commandId) || undefined,
      reason: toText(i.reason) || undefined,
    })).filter((i) => Boolean(i.deviceId)),
  };
}
function derivePhase(cmdStatus: string, ackStatus: string): { phase: OtaPhase; label: string } {
  const cs = cmdStatus.toLowerCase(), as_ = ackStatus.toLowerCase();
  if (cs === "timeout") return { phase: "timeout", label: "timeout" };
  if (as_ === "failed" || as_ === "busy") return { phase: "failed", label: as_ || "failed" };
  if (as_ === "skipped") return { phase: "confirmed", label: "skipped" };
  if (as_ === "success") return { phase: "confirmed", label: "confirmed" };
  if (as_ === "queued" || cs === "sent") return { phase: "queued", label: "queued" };
  if (["accepted", "downloading", "updating", "acked"].includes(as_) || cs === "acked") return { phase: "in_progress", label: as_ || "in_progress" };
  return { phase: "in_progress", label: as_ || cs || "in_progress" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepBadge({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  const { C } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: done ? C.success : active ? C.primary : C.surface,
        border: `1.5px solid ${done ? C.success : active ? C.primary : C.border}`,
        transition: "all 0.3s",
        boxShadow: active ? `0 0 12px ${C.primary}44` : done ? `0 0 8px ${C.success}33` : "none",
      }}>
        {done
          ? <CheckCircle2 size={13} color="#fff" strokeWidth={2.5} />
          : <span style={{ color: active ? "#fff" : C.textMuted, fontSize: "0.68rem", fontWeight: 800 }}>{num}</span>
        }
      </div>
      <span style={{ color: active ? C.textBright : done ? C.textBase : C.textMuted, fontSize: "0.74rem", fontWeight: active ? 700 : 500 }}>
        {label}
      </span>
    </div>
  );
}

function PhasePill({ phase, label }: { phase: OtaPhase; label: string }) {
  const { C } = useTheme();
  const map: Record<OtaPhase, { bg: string; color: string; icon: React.ReactNode }> = {
    queued:               { bg: C.warningBg,  color: C.warning, icon: <Loader2 size={10} /> },
    in_progress:          { bg: C.primaryBg,  color: C.primary, icon: <Loader2 size={10} className="animate-spin" /> },
    await_reboot_confirm: { bg: C.warningBg,  color: C.warning, icon: <RefreshCw size={10} /> },
    confirmed:            { bg: C.successBg,  color: C.success, icon: <CheckCircle2 size={10} /> },
    failed:               { bg: C.dangerBg,   color: C.danger,  icon: <XCircle size={10} /> },
    timeout:              { bg: C.dangerBg,   color: C.danger,  icon: <ZapOff size={10} /> },
  };
  const s = map[phase] || map.in_progress;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 7px", borderRadius: 99,
      background: s.bg, color: s.color,
      fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.04em",
    }}>
      {s.icon} {label}
    </span>
  );
}

function StatCard({
  value,
  label,
  color,
  icon,
  className,
}: {
  value: number;
  label: string;
  color: string;
  icon: React.ReactNode;
  className?: string;
}) {
  const { C } = useTheme();
  return (
    <div
      className={className}
      style={{
      flex: 1, minWidth: 80,
      background: C.surface, border: `1px solid ${color}33`,
      borderRadius: 10, padding: "10px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ color: C.textMuted, fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      </div>
      <div style={{ color, fontSize: "1.5rem", fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function OtaManagement() {
  const { C } = useTheme();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedBin, setUploadedBin] = useState<UploadResult | null>(null);
  const [uploadMsg, setUploadMsg] = useState("");

  const [deviceSearch, setDeviceSearch] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [onlineDevices, setOnlineDevices] = useState<DeviceItem[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);

  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const [progressRows, setProgressRows] = useState<ProgressRow[]>([]);
  const [progressMsg, setProgressMsg] = useState("");

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    if (!q) return onlineDevices;
    return onlineDevices.filter((d) => {
      const hay = [d.deviceId, toText(d.metadata.name), toText(d.metadata.site), toText(d.metadata.zone), extractFw(d.metadata)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [deviceSearch, onlineDevices]);

  const summary = useMemo(() => {
    const s = { total: progressRows.length, queued: 0, inProgress: 0, confirmed: 0, failed: 0, timeout: 0, awaitReboot: 0 };
    for (const r of progressRows) {
      if (r.phase === "queued") s.queued++;
      else if (r.phase === "confirmed") s.confirmed++;
      else if (r.phase === "failed") s.failed++;
      else if (r.phase === "timeout") s.timeout++;
      else if (r.phase === "await_reboot_confirm") s.awaitReboot++;
      else s.inProgress++;
    }
    const terminal = s.confirmed + s.failed + s.timeout;
    const pct = s.total > 0 ? Math.round((terminal / s.total) * 100) : 0;
    return { ...s, terminal, percent: pct, done: s.total > 0 && terminal >= s.total };
  }, [progressRows]);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    const r = await requestJson("/api/devices?status=online");
    setLoadingDevices(false);
    if (!r.ok) { setOnlineDevices([]); return; }
    const devs = parseDevices(r.payload);
    setOnlineDevices(devs);
    setSelectedDeviceIds((p) => p.filter((id) => devs.some((d) => d.deviceId === id)));
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const uploadBin = useCallback(async (fileOverride?: File) => {
    const fileToUpload = fileOverride ?? selectedFile;
    if (!fileToUpload) { setUploadMsg("Chọn file .bin trước."); return; }
    if (!fileToUpload.name.toLowerCase().endsWith(".bin")) { setUploadMsg("Chỉ chấp nhận file .bin."); return; }
    setUploading(true); setUploadMsg("Đang upload...");
    const fd = new FormData(); fd.append("file", fileToUpload, fileToUpload.name);
    const r = await requestJson("/api/ota/upload-bin", { method: "POST", body: fd });
    setUploading(false);
    if (!r.ok) { setUploadedBin(null); setUploadMsg(`Upload thất bại (HTTP ${r.status}).`); return; }
    const root = asRecord(r.payload), data = asRecord(root.data || r.payload);
    const u: UploadResult = { fileName: toText(data.fileName), originalName: toText(data.originalName) || fileToUpload.name, sizeBytes: toNumber(data.sizeBytes), url: toText(data.url), uploadedAt: toText(data.uploadedAt) || new Date().toISOString() };
    if (!u.fileName || !u.url) { setUploadedBin(null); setUploadMsg("Dữ liệu upload không hợp lệ."); return; }
    setSelectedFile(fileToUpload);
    setUploadedBin(u); setUploadMsg("");
  }, [selectedFile]);

  const handlePickedFile = useCallback((file: File | null) => {
    if (!file) {
      return;
    }

    const shouldAutoUpload = Boolean(uploadedBin);
    setSelectedFile(file);
    setUploadMsg("");

    if (shouldAutoUpload) {
      setUploadedBin(null);
      void uploadBin(file);
    }
  }, [uploadedBin, uploadBin]);

  const toggleDevice = useCallback((id: string) => {
    setSelectedDeviceIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }, []);

  const startOta = useCallback(async () => {
    if (!uploadedBin?.url) { setProgressMsg("Upload file .bin trước."); return; }
    if (selectedDeviceIds.length === 0) { setProgressMsg("Chọn ít nhất 1 thiết bị."); return; }
    setDispatching(true); setProgressMsg("Đang gửi lệnh OTA...");
    const r = await requestJson("/api/ota/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceIds: selectedDeviceIds, commandType: "ota_from_url", otaUrl: uploadedBin.url }) });
    setDispatching(false);
    if (!r.ok) { setDispatchResult(null); setProgressRows([]); setProgressMsg(`Gửi thất bại (HTTP ${r.status}).`); return; }
    const parsed = extractDispatch(r.payload);
    if (!parsed) { setDispatchResult(null); setProgressRows([]); setProgressMsg("Phản hồi không hợp lệ."); return; }
    setDispatchResult(parsed);
    setProgressRows(parsed.items.map((i) => ({ deviceId: i.deviceId, commandId: i.commandId, phase: i.status === "accepted" ? "in_progress" : "failed", phaseLabel: i.status === "accepted" ? "in_progress" : "failed", ackStatus: "-", ackDetail: i.reason || "" })));
    setProgressMsg(`Đã gửi: ${parsed.accepted} accepted · ${parsed.failed} failed`);
  }, [selectedDeviceIds, uploadedBin?.url]);

  const refreshProgress = useCallback(async () => {
    if (!dispatchResult) return;
    const cmdIds = dispatchResult.items.map((i) => i.commandId).filter((v): v is string => Boolean(v));
    const lookup =
      cmdIds.length
        ? await requestJson("/api/commands/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandIds: cmdIds }) })
        : { ok: true, status: 200, payload: { data: [] } };
    if (!lookup.ok) return;
    const cmdMap = new Map<string, Record<string, unknown>>();
    asArray(asRecord(lookup.payload).data || lookup.payload).map(asRecord).forEach((i) => { const id = toText(i.commandId); if (id) cmdMap.set(id, i); });
    const rows: ProgressRow[] = dispatchResult.items.map((item) => {
      if (item.status === "failed" || !item.commandId) return { deviceId: item.deviceId, commandId: item.commandId, phase: "failed" as OtaPhase, phaseLabel: "failed", ackStatus: "-", ackDetail: item.reason || "not_connected" };
      const cmd = cmdMap.get(item.commandId);
      if (!cmd) return { deviceId: item.deviceId, commandId: item.commandId, phase: "queued" as OtaPhase, phaseLabel: "queued", ackStatus: "-", ackDetail: "waiting" };
      const ackStatus = toText(cmd.ackStatus || cmd.status) || "-";
      const pr = derivePhase(toText(cmd.status), toText(cmd.ackStatus));
      return { deviceId: item.deviceId, commandId: item.commandId, phase: pr.phase, phaseLabel: pr.label, ackStatus, ackDetail: toText(cmd.ackDetail) };
    });
    setProgressRows(rows);
  }, [dispatchResult]);

  useEffect(() => {
    if (!dispatchResult) return;
    void refreshProgress();
    const t = window.setInterval(() => void refreshProgress(), 2000);
    return () => window.clearInterval(t);
  }, [dispatchResult, refreshProgress]);

  useEffect(() => { if (dispatchResult && summary.done) setProgressMsg("OTA hoàn tất."); }, [dispatchResult, summary.done]);

  const step1Done = Boolean(uploadedBin);
  const step2Done = selectedDeviceIds.length > 0;
  const otaRunning = dispatching || Boolean(dispatchResult && !summary.done);
  const failedTotal = summary.failed + summary.timeout;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="ota-page-root"
      style={{
      flex: 1, overflowY: "auto", padding: "24px 28px 40px",
      scrollbarWidth: "thin", scrollbarColor: `${C.scrollbar} transparent`,
      background: C.bg,
    }}>
      <style>{`
        @keyframes otaFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes otaDotPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }

        .ota-page-root {
          animation: otaFadeUp 260ms ease;
        }

        .ota-hero {
          animation: otaFadeUp 320ms ease both;
        }

        .ota-panel {
          animation: otaFadeUp 360ms ease both;
          transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
        }

        .ota-panel:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 26px rgba(2, 6, 23, 0.14);
        }

        .ota-action-btn {
          transition: transform 130ms ease, filter 130ms ease;
        }

        .ota-action-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
        }

        .ota-device-row {
          animation: otaFadeUp 300ms ease both;
          transition: background-color 140ms ease, transform 140ms ease;
        }

        .ota-device-row:hover {
          transform: translateX(2px);
          background: rgba(96, 165, 250, 0.08) !important;
        }

        .ota-online-dot {
          animation: otaDotPulse 2.2s ease-in-out infinite;
        }

        .ota-stat-card {
          transition: transform 140ms ease;
        }

        .ota-stat-card:hover {
          transform: translateY(-1px);
        }

        .ota-main-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          align-items: start;
        }

        @media (max-width: 1120px) {
          .ota-main-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ota-page-root,
          .ota-hero,
          .ota-panel,
          .ota-device-row {
            animation: none !important;
          }

          .ota-panel,
          .ota-action-btn,
          .ota-device-row,
          .ota-stat-card {
            transition: none !important;
          }
        }
      `}</style>
      {/* ── Page header ── */}
      <div className="ota-hero" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: `linear-gradient(135deg, ${C.primary}22 0%, ${C.primaryDim}11 100%)`,
              border: `1px solid ${C.primary}33`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 16px ${C.primaryGlow}`,
            }}>
              <UploadCloud size={16} color={C.primary} strokeWidth={2} />
            </div>
            <div>
              <h1 style={{ color: C.textBright, fontSize: "1.05rem", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
                Update Center
              </h1>
              <div style={{ color: C.textMuted, fontSize: "0.66rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
                Over-the-Air firmware update
              </div>
            </div>
          </div>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StepBadge num={1} label="Firmware" active={!step1Done} done={step1Done} />
          <ChevronRight size={12} color={C.textDim} />
          <StepBadge num={2} label="Thiết bị" active={step1Done && !step2Done} done={step2Done} />
          <ChevronRight size={12} color={C.textDim} />
          <StepBadge num={3} label="Triển khai" active={step1Done && step2Done} done={Boolean(dispatchResult && summary.done)} />
        </div>
      </div>

      {/* ── Main 2-col grid ── */}
      <div className="ota-main-grid">

        {/* ── LEFT: Firmware + Deploy ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Firmware card */}
          <div className="ota-panel" style={{
            background: C.card, border: `1px solid ${C.cardBorder}`,
            borderRadius: 14, overflow: "hidden",
          }}>
            {/* Card header */}
            <div style={{
              padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", gap: 8,
              background: `linear-gradient(90deg, ${C.primary}08 0%, transparent 100%)`,
            }}>
              <FileCode2 size={13} color={C.primary} strokeWidth={2} />
              <span style={{ color: C.textBright, fontSize: "0.78rem", fontWeight: 700 }}>Firmware Binary</span>
              {step1Done && (
                <span style={{
                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 99, background: C.successBg,
                  color: C.success, fontSize: "0.62rem", fontWeight: 700,
                }}>
                  <CheckCircle2 size={10} /> Đã sẵn sàng
                </span>
              )}
            </div>

            <div style={{ padding: 16 }}>
              {/* Drop zone */}
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0] || null;
                  handlePickedFile(f);
                }}
                style={{
                  display: "block", cursor: "pointer",
                  border: `2px dashed ${dragOver ? C.primary : step1Done ? C.success + "66" : C.border}`,
                  borderRadius: 12,
                  background: dragOver ? C.primaryBg : step1Done ? C.successBg : C.surface,
                  padding: "20px 16px", textAlign: "center",
                  transition: "all 0.2s",
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12, margin: "0 auto 10px",
                  background: step1Done ? C.success + "18" : C.primary + "14",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {step1Done
                    ? <CheckCircle2 size={18} color={C.success} strokeWidth={2} />
                    : <UploadCloud size={18} color={C.primary} strokeWidth={1.8} />
                  }
                </div>

                {step1Done ? (
                  <>
                    <div style={{ color: C.success, fontSize: "0.78rem", fontWeight: 700 }}>{uploadedBin!.fileName}</div>
                    <div style={{ color: C.textMuted, fontSize: "0.68rem", marginTop: 3 }}>
                      {formatBytes(uploadedBin!.sizeBytes)} · Click để thay file
                    </div>
                  </>
                ) : selectedFile ? (
                  <>
                    <div style={{ color: C.textBright, fontSize: "0.78rem", fontWeight: 700 }}>{selectedFile.name}</div>
                    <div style={{ color: C.textMuted, fontSize: "0.68rem", marginTop: 3 }}>{formatBytes(selectedFile.size)} · Sẵn sàng upload</div>
                  </>
                ) : (
                  <>
                    <div style={{ color: C.textBase, fontSize: "0.78rem", fontWeight: 600 }}>Kéo thả file .bin vào đây</div>
                    <div style={{ color: C.textMuted, fontSize: "0.68rem", marginTop: 3 }}>hoặc click để chọn file</div>
                  </>
                )}
                <input
                  type="file"
                  accept=".bin"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    handlePickedFile(file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {/* Upload row */}
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="ota-action-btn"
                  onClick={() => void uploadBin()}
                  disabled={!selectedFile || uploading || Boolean(uploadedBin)}
                  style={{
                    flex: 1, height: 34, borderRadius: 9,
                    background: uploadedBin ? C.successBg : C.primary,
                    border: `1px solid ${uploadedBin ? C.success + "44" : C.primary}`,
                    color: uploadedBin ? C.success : "#fff",
                    fontSize: "0.76rem", fontWeight: 700,
                    cursor: !selectedFile || uploading || Boolean(uploadedBin) ? "not-allowed" : "pointer",
                    opacity: !selectedFile || uploading ? 0.5 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    fontFamily: "inherit", transition: "all 0.2s",
                    boxShadow: uploadedBin ? "none" : `0 0 16px ${C.primary}33`,
                  }}
                >
                  {uploading
                    ? <><Loader2 size={13} className="animate-spin" /> Đang upload...</>
                    : uploadedBin
                      ? <><CheckCircle2 size={13} /> Đã upload</>
                      : <><UploadCloud size={13} /> Upload lên server</>
                  }
                </button>

                {(uploadedBin || selectedFile) && (
                  <button
                    className="ota-action-btn"
                    onClick={() => { setSelectedFile(null); setUploadedBin(null); setUploadMsg(""); }}
                    onMouseEnter={(e) => {
                      const btn = e.currentTarget;
                      btn.style.background = C.dangerBg;
                      btn.style.borderColor = `${C.danger}44`;
                      btn.style.color = C.danger;
                    }}
                    onMouseLeave={(e) => {
                      const btn = e.currentTarget;
                      btn.style.background = "transparent";
                      btn.style.borderColor = C.border;
                      btn.style.color = C.textMuted;
                    }}
                    style={{
                      height: 34, padding: "0 12px", borderRadius: 9,
                      background: "transparent", border: `1px solid ${C.border}`,
                      color: C.textMuted, fontSize: "0.72rem", fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease",
                    }}>
                    Xoá
                  </button>
                )}
              </div>

              {uploadMsg && (
                <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 8, background: C.dangerBg, border: `1px solid ${C.danger}33`, color: C.danger, fontSize: "0.71rem" }}>
                  {uploadMsg}
                </div>
              )}

              {/* URL info */}
              {uploadedBin && (
                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: C.surface, border: `1px solid ${C.border}` }}>
                  <div style={{ color: C.textDim, fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Firmware URL</div>
                  <div style={{ color: C.textMuted, fontSize: "0.67rem", wordBreak: "break-all", lineHeight: 1.5 }}>{uploadedBin.url}</div>
                </div>
              )}
            </div>
          </div>

          {/* Deploy card */}
          <div className="ota-panel" style={{ animationDelay: "70ms", background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{
              padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", gap: 8,
              background: `linear-gradient(90deg, ${C.primary}08 0%, transparent 100%)`,
            }}>
              <Send size={13} color={C.primary} strokeWidth={2} />
              <span style={{ color: C.textBright, fontSize: "0.78rem", fontWeight: 700 }}>Triển khai</span>
            </div>

            <div style={{ padding: 16 }}>
              {/* Summary pills */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ padding: "4px 10px", borderRadius: 99, background: C.primaryBg, border: `1px solid ${C.primary}22`, color: C.primary, fontSize: "0.68rem", fontWeight: 700 }}>
                  <Cpu size={10} style={{ display: "inline", marginRight: 4 }} />
                  {selectedDeviceIds.length} thiết bị đã chọn
                </div>
                {uploadedBin && (
                  <div style={{ padding: "4px 10px", borderRadius: 99, background: C.successBg, border: `1px solid ${C.success}22`, color: C.success, fontSize: "0.68rem", fontWeight: 700 }}>
                    {formatBytes(uploadedBin.sizeBytes)}
                  </div>
                )}
              </div>

              {/* CTA button */}
              <button
                className="ota-action-btn"
                onClick={() => void startOta()}
                disabled={dispatching || !step1Done || !step2Done}
                style={{
                  width: "100%", height: 40, borderRadius: 10,
                  background: dispatching || !step1Done || !step2Done
                    ? C.surface
                    : `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryDim} 100%)`,
                  border: `1px solid ${dispatching || !step1Done || !step2Done ? C.border : C.primary}`,
                  color: dispatching || !step1Done || !step2Done ? C.textMuted : "#fff",
                  fontSize: "0.8rem", fontWeight: 800, cursor: dispatching || !step1Done || !step2Done ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  fontFamily: "inherit", letterSpacing: "0.02em",
                  boxShadow: !dispatching && step1Done && step2Done ? `0 4px 20px ${C.primary}44` : "none",
                  transition: "all 0.2s",
                }}
              >
                {dispatching
                  ? <><Loader2 size={14} className="animate-spin" /> Đang gửi lệnh OTA...</>
                  : <><Send size={14} /> Bắt đầu cập nhật hàng loạt</>
                }
              </button>

              {/* Progress msg */}
              {progressMsg && (
                <div style={{ marginTop: 10, color: C.textMuted, fontSize: "0.7rem", textAlign: "center" }}>{progressMsg}</div>
              )}

              {/* Stats */}
              {dispatchResult && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ height: 1, background: C.border, marginBottom: 14 }} />

                  {/* Progress bar */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ color: C.textMuted, fontSize: "0.66rem", fontWeight: 600 }}>Tiến trình</span>
                      <span style={{ color: otaRunning ? C.primary : failedTotal > 0 ? C.warning : C.success, fontSize: "0.7rem", fontWeight: 800 }}>
                        {summary.percent}%
                      </span>
                    </div>
                    <div style={{ height: 6, background: C.surface, borderRadius: 99, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 99, transition: "width 0.6s ease",
                        width: `${summary.percent}%`,
                        background: otaRunning
                          ? `linear-gradient(90deg, ${C.primary}, ${C.primaryDim})`
                          : failedTotal > 0
                            ? `linear-gradient(90deg, ${C.success}, ${C.warning})`
                            : `linear-gradient(90deg, ${C.success}, ${C.success}88)`,
                        boxShadow: `0 0 8px ${otaRunning ? C.primary : C.success}44`,
                      }} />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <StatCard className="ota-stat-card" value={summary.confirmed} label="Thành công" color={C.success} icon={<CheckCircle2 size={11} strokeWidth={2.5} />} />
                    <StatCard className="ota-stat-card" value={summary.inProgress + summary.queued} label="Đang chạy" color={C.primary} icon={<Loader2 size={11} />} />
                    <StatCard className="ota-stat-card" value={failedTotal} label="Lỗi" color={C.danger} icon={<XCircle size={11} />} />
                  </div>

                  {summary.done && (
                    <div style={{
                      marginTop: 10, padding: "8px 12px", borderRadius: 9,
                      background: failedTotal > 0 ? C.warningBg : C.successBg,
                      border: `1px solid ${failedTotal > 0 ? C.warning : C.success}33`,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      {failedTotal > 0
                        ? <ServerCrash size={14} color={C.warning} />
                        : <CheckCircle2 size={14} color={C.success} />
                      }
                      <span style={{ color: failedTotal > 0 ? C.warning : C.success, fontSize: "0.72rem", fontWeight: 700 }}>
                        {failedTotal > 0 ? `Hoàn tất — ${failedTotal} thiết bị gặp lỗi` : "Tất cả thiết bị cập nhật thành công!"}
                      </span>
                    </div>
                  )}

                  <div style={{ marginTop: 8, color: C.textDim, fontSize: "0.6rem" }}>
                    Run ID: {dispatchResult.runId}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Device list ── */}
        <div className="ota-panel" style={{ animationDelay: "120ms", background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Header */}
          <div style={{
            padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
            background: `linear-gradient(90deg, ${C.primary}08 0%, transparent 100%)`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Wifi size={13} color={C.primary} strokeWidth={2} />
              <span style={{ color: C.textBright, fontSize: "0.78rem", fontWeight: 700 }}>Thiết bị online</span>
              <span style={{
                marginLeft: "auto", padding: "2px 8px", borderRadius: 99,
                background: C.primaryBg, border: `1px solid ${C.primary}22`,
                color: C.primary, fontSize: "0.62rem", fontWeight: 700,
              }}>{onlineDevices.length} online</span>
            </div>

            {/* Search + actions */}
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{
                flex: 1, display: "flex", alignItems: "center", gap: 7,
                height: 32, padding: "0 10px", borderRadius: 8,
                border: `1px solid ${C.border}`, background: C.input,
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input
                  placeholder="Tìm deviceId, tên, zone, firmware..."
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.textBright, fontSize: "0.72rem", fontFamily: "inherit" }}
                />
              </div>
              <button
                className="ota-action-btn"
                onClick={() => void loadDevices()}
                disabled={loadingDevices}
                onMouseEnter={(e) => {
                  if (loadingDevices) {
                    return;
                  }
                  const btn = e.currentTarget;
                  btn.style.background = C.primaryBg;
                  btn.style.borderColor = `${C.primary}44`;
                  btn.style.color = C.primary;
                }}
                onMouseLeave={(e) => {
                  const btn = e.currentTarget;
                  btn.style.background = C.surface;
                  btn.style.borderColor = C.border;
                  btn.style.color = C.textMuted;
                }}
                style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted }}>
                {loadingDevices ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              </button>
            </div>

            {/* Bulk select */}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="ota-action-btn" onClick={() => setSelectedDeviceIds(filteredDevices.map((d) => d.deviceId))}
                style={{ padding: "3px 10px", height: 26, borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface, color: C.textMuted, fontSize: "0.65rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Chọn tất cả ({filteredDevices.length})
              </button>
              <button className="ota-action-btn" onClick={() => setSelectedDeviceIds([])}
                style={{ padding: "3px 10px", height: 26, borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface, color: C.textMuted, fontSize: "0.65rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Bỏ chọn
              </button>
              {selectedDeviceIds.length > 0 && (
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", padding: "3px 10px", borderRadius: 7, background: C.primaryBg, color: C.primary, fontSize: "0.65rem", fontWeight: 700 }}>
                  ✓ {selectedDeviceIds.length} đã chọn
                </span>
              )}
            </div>
          </div>

          {/* Device rows */}
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 520, scrollbarWidth: "thin", scrollbarColor: `${C.scrollbar} transparent` }}>
            {filteredDevices.length === 0 ? (
              <div style={{ padding: "48px 20px", textAlign: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <WifiOff size={18} color={C.textDim} strokeWidth={1.5} />
                </div>
                <div style={{ color: C.textBase, fontSize: "0.8rem", fontWeight: 700, marginBottom: 4 }}>Không có thiết bị online</div>
                <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>Kiểm tra kết nối hoặc thay đổi bộ lọc</div>
              </div>
            ) : (
              filteredDevices.map((device, idx) => {
                const checked = selectedDeviceIds.includes(device.deviceId);
                const m = device.metadata;
                const fw = extractFw(m);
                const progressRow = progressRows.find((r) => r.deviceId === device.deviceId);

                return (
                  <label className="ota-device-row" key={device.deviceId}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 16px", cursor: "pointer",
                      borderBottom: idx < filteredDevices.length - 1 ? `1px solid ${C.border}` : "none",
                      background: checked ? C.primaryBg : "transparent",
                      transition: "background 0.15s",
                      animationDelay: `${Math.min(idx * 0.018, 0.24)}s`,
                    }}>
                    {/* Custom checkbox */}
                    <div style={{
                      width: 16, height: 16, borderRadius: 5, flexShrink: 0,
                      border: `1.5px solid ${checked ? C.primary : C.border}`,
                      background: checked ? C.primary : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.15s",
                      boxShadow: checked ? `0 0 6px ${C.primary}44` : "none",
                    }}>
                      {checked && <svg width="9" height="9" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <input type="checkbox" checked={checked} onChange={() => toggleDevice(device.deviceId)} style={{ display: "none" }} />

                    {/* Device icon */}
                    <div style={{
                      width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                      background: checked ? C.primary + "18" : C.surface,
                      border: `1px solid ${checked ? C.primary + "33" : C.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Cpu size={14} color={checked ? C.primary : C.textMuted} strokeWidth={1.8} />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ color: C.textBright, fontSize: "0.75rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {device.deviceId}
                        </span>
                        {/* Online dot */}
                        <span className="ota-online-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: C.success, flexShrink: 0, boxShadow: `0 0 5px ${C.success}88` }} />
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {toText(m.name) && <span style={{ color: C.textMuted, fontSize: "0.65rem" }}>{toText(m.name)}</span>}
                        {toText(m.zone) && <span style={{ color: C.textDim, fontSize: "0.65rem" }}>· {toText(m.zone)}</span>}
                      </div>
                    </div>

                    {/* Right: fw + phase */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      {fw && (
                        <span style={{
                          padding: "2px 7px", borderRadius: 99,
                          background: C.surface, border: `1px solid ${C.border}`,
                          color: C.textMuted, fontSize: "0.6rem", fontWeight: 700,
                          letterSpacing: "0.04em",
                        }}>fw {fw}</span>
                      )}
                      {progressRow && <PhasePill phase={progressRow.phase} label={progressRow.phaseLabel} />}
                    </div>
                  </label>
                );
              })
            )}
          </div>

          {/* Footer */}
          {dispatchResult && progressRows.length > 0 && (
            <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.border}`, background: C.surface }}>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {[
                  { phase: "confirmed" as OtaPhase, count: summary.confirmed, color: C.success },
                  { phase: "in_progress" as OtaPhase, count: summary.inProgress, color: C.primary },
                  { phase: "queued" as OtaPhase, count: summary.queued, color: C.warning },
                  { phase: "failed" as OtaPhase, count: failedTotal, color: C.danger },
                ].filter((s) => s.count > 0).map(({ phase, count, color }) => (
                  <span key={phase} style={{ display: "flex", alignItems: "center", gap: 5, color, fontSize: "0.68rem", fontWeight: 700 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
                    {phase === "confirmed" ? "Thành công" : phase === "in_progress" ? "Đang chạy" : phase === "queued" ? "Chờ" : "Lỗi"}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
