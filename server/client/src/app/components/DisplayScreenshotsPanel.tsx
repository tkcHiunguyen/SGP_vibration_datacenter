import { useCallback, useEffect, useState } from "react";
import { Camera, Monitor, RefreshCw, X } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

type DisplayScreenshotView = {
  clientId: string;
  displayName: string;
  capturedAt: string;
  receivedAt: string;
  sizeBytes: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  pagePath: string;
  clientIp?: string;
  url: string;
};

function parseDisplayScreenshots(value: unknown): DisplayScreenshotView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is DisplayScreenshotView => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const record = item as Record<string, unknown>;
    return typeof record.clientId === "string"
      && typeof record.displayName === "string"
      && typeof record.capturedAt === "string"
      && typeof record.receivedAt === "string"
      && typeof record.sizeBytes === "number"
      && typeof record.viewportWidth === "number"
      && typeof record.viewportHeight === "number"
      && typeof record.devicePixelRatio === "number"
      && typeof record.pagePath === "string"
      && typeof record.url === "string";
  });
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("vi-VN") : value;
}

export function DisplayScreenshotsPanel() {
  const { C } = useTheme();
  const [items, setItems] = useState<DisplayScreenshotView[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestingRefresh, setRequestingRefresh] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DisplayScreenshotView | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const response = await fetch("/api/display-clients/screenshots", {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("display_screenshot_list_failed");
      }
      setItems(parseDisplayScreenshots((payload as Record<string, unknown>).data));
      setError("");
    } catch {
      setError("Không thể tải danh sách ảnh màn hình từ server.");
    } finally {
      setLoading(false);
    }
  }, []);

  const requestClientRefresh = useCallback(async () => {
    setRequestingRefresh(true);
    try {
      const response = await fetch("/api/display-clients/refresh", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("display_refresh_request_failed");
      }
      setError("");
    } catch {
      setError("Không thể gửi yêu cầu refresh tới client.");
    } finally {
      setRequestingRefresh(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ color: C.textBright, fontSize: "0.82rem", fontWeight: 900 }}>Màn hình client</div>
          <div style={{ color: C.textMuted, fontSize: "0.75rem", marginTop: 3 }}>
            Ảnh giao diện được gửi tự động khi dashboard mở trên từng máy.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void requestClientRefresh()}
          disabled={loading || requestingRefresh}
          style={{
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.textBase,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: loading || requestingRefresh ? "wait" : "pointer",
            fontSize: "0.75rem",
            fontWeight: 800,
          }}
        >
          <RefreshCw size={13} style={{ opacity: loading || requestingRefresh ? 0.55 : 1 }} />
          {requestingRefresh ? "Đang gửi..." : "Refresh client"}
        </button>
      </div>

      {error ? (
        <div style={{ border: `1px solid ${C.danger}55`, background: C.dangerBg, color: C.danger, borderRadius: 8, padding: "10px 12px", fontSize: "0.75rem" }}>
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div style={{ minHeight: 180, border: `1px dashed ${C.border}`, borderRadius: 10, display: "grid", placeItems: "center", color: C.textMuted, textAlign: "center", padding: 20 }}>
          <div>
            <Monitor size={32} strokeWidth={1.5} />
            <div style={{ marginTop: 8, fontSize: "0.75rem", fontWeight: 800 }}>Chưa có client nào gửi ảnh.</div>
            <div style={{ marginTop: 4, fontSize: "0.75rem" }}>Mở dashboard trên màn hình cần giám sát và chờ khoảng 5 giây.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 12 }}>
          {items.map((item) => (
            <button
              key={item.clientId}
              type="button"
              onClick={() => setSelected(item)}
              style={{
                padding: 0,
                overflow: "hidden",
                borderRadius: 10,
                border: `1px solid ${C.border}`,
                background: C.surface,
                color: C.textBase,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ aspectRatio: "16 / 9", background: "#05070d", borderBottom: `1px solid ${C.border}` }}>
                <img src={item.url} alt={`Màn hình ${item.displayName}`} style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />
              </div>
              <div style={{ padding: 10 }}>
                <div style={{ color: C.textBright, fontSize: "0.75rem", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.displayName}
                </div>
                <div style={{ color: C.textMuted, fontSize: "0.75rem", marginTop: 5 }}>
                  {item.clientIp || "IP chưa xác định"} · {item.viewportWidth}×{item.viewportHeight} · DPR {item.devicePixelRatio}
                </div>
                <div style={{ color: C.textMuted, fontSize: "0.75rem", marginTop: 4 }}>
                  {formatTime(item.capturedAt)} · {(item.sizeBytes / 1024).toFixed(0)} KB
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Ảnh màn hình ${selected.displayName}`}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2, 6, 15, 0.88)", display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto" }}
        >
          <div style={{ minHeight: 52, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.textBright, fontSize: "0.78rem", fontWeight: 900 }}>{selected.displayName}</div>
              <div style={{ color: C.textMuted, fontSize: "0.75rem", marginTop: 3 }}>{selected.clientIp || "IP chưa xác định"} · {selected.pagePath}</div>
            </div>
            <button
              type="button"
              aria-label="Đóng ảnh màn hình"
              onClick={() => setSelected(null)}
              style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.textBase, display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <X size={15} />
            </button>
          </div>
          <div style={{ minHeight: 0, padding: 16, display: "grid", placeItems: "center" }}>
            <img src={selected.url} alt={`Ảnh màn hình ${selected.displayName}`} style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 18px 48px rgba(0,0,0,0.38)" }} />
          </div>
          <div style={{ minHeight: 38, padding: "8px 14px", background: C.surface, borderTop: `1px solid ${C.border}`, color: C.textMuted, fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span><Camera size={12} style={{ verticalAlign: "-2px", marginRight: 5 }} />Chụp lúc {formatTime(selected.capturedAt)}</span>
            <span>{selected.viewportWidth}×{selected.viewportHeight} · {(selected.sizeBytes / 1024).toFixed(0)} KB</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
