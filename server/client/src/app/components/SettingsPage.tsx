import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Database, Download, Settings, Upload } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { ConsolePage, ConsolePageHeader, ConsolePanel } from "./ui";
import { SgpDataPortabilityPanel } from "./SgpDataPortabilityPanel";

type SettingsKey = "data-import" | "data-export";
type SettingsItem = {
  key: SettingsKey;
  title: string;
  detail: string;
  icon: React.ReactNode;
  status: string;
};

export function SettingsPage() {
  const { C } = useTheme();
  const [activeKey, setActiveKey] = useState<SettingsKey>("data-import");
  const [dataOpen, setDataOpen] = useState(true);

  const items = useMemo<SettingsItem[]>(() => [
    {
      key: "data-import",
      title: "Nhập dữ liệu",
      detail: "Preview file và merge theo UUID",
      icon: <Upload size={15} strokeWidth={2.1} />,
      status: "Import",
    },
    {
      key: "data-export",
      title: "Xuất dữ liệu",
      detail: "Tạo gói .sgpdata theo khoảng thời gian",
      icon: <Download size={15} strokeWidth={2.1} />,
      status: "Export",
    },
  ], []);
  const activeItem = items.find((item) => item.key === activeKey) ?? items[0];

  return (
    <ConsolePage
      className="settings-page-root dc-page-canvas"
    >
      <ConsolePageHeader
        icon={<Settings size={17} strokeWidth={2.1} />}
        title="Cài đặt"
        subtitle="Quản lý dữ liệu hệ thống."
      />

      <div
        className="settings-layout"
        style={{
          minWidth: 0,
        }}
      >
        <ConsolePanel style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 12px 10px", borderBottom: `1px solid ${C.border}`, background: C.headerBg }}>
            <div style={{ color: C.textBright, fontSize: "0.8rem", fontWeight: 900 }}>Mục cài đặt</div>
            <div style={{ color: C.textMuted, fontSize: "0.66rem", marginTop: 3 }}>Data</div>
          </div>
          <div style={{ display: "grid", gap: 10, padding: 10 }}>
            <DataGroup />
          </div>
        </ConsolePanel>

        <ConsolePanel style={{ padding: 0, overflow: "visible", minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "13px 14px",
              borderBottom: `1px solid ${C.border}`,
              background: C.headerBg,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, display: "grid", placeItems: "center", background: C.primaryBg, color: C.primary, border: `1px solid ${C.primary}28`, flexShrink: 0 }}>
                {activeItem.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: C.textBright, fontSize: "0.9rem", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeItem.title}</div>
                <div style={{ color: C.textMuted, fontSize: "0.68rem", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeItem.detail}</div>
              </div>
            </div>
            <span style={{ borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, color: C.textBase, padding: "4px 8px", fontSize: "0.62rem", fontWeight: 850, flexShrink: 0 }}>
              {activeItem.status}
            </span>
          </div>

          <div style={{ padding: 14, minWidth: 0 }}>
            <SgpDataPortabilityPanel mode={activeKey === "data-export" ? "export" : "import"} />
          </div>
        </ConsolePanel>
      </div>
    </ConsolePage>
  );

  function DataGroup() {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <button
          type="button"
          onClick={() => setDataOpen((current) => !current)}
          style={{
            width: "100%",
            height: 42,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.textBright,
            display: "grid",
            gridTemplateColumns: "30px minmax(0, 1fr) 16px",
            alignItems: "center",
            gap: 9,
            padding: "0 9px",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ width: 30, height: 30, borderRadius: 7, display: "grid", placeItems: "center", background: C.card, border: `1px solid ${C.border}`, color: C.primary }}>
            <Database size={15} strokeWidth={2.1} />
          </span>
          <span style={{ minWidth: 0, fontSize: "0.78rem", fontWeight: 900 }}>Data</span>
          {dataOpen ? <ChevronDown size={15} strokeWidth={2.2} /> : <ChevronRight size={15} strokeWidth={2.2} />}
        </button>
        {dataOpen ? (
          <div style={{ display: "grid", gap: 6, paddingLeft: 12 }}>
            {items.map((item) => (
              <SettingsNavItem key={item.key} item={item} active={item.key === activeKey} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function SettingsNavItem({ item, active }: { item: SettingsItem; active: boolean }) {
    return (
      <button
        type="button"
        onClick={() => setActiveKey(item.key)}
        style={{
          width: "100%",
          minHeight: 58,
          borderRadius: 8,
          border: `1px solid ${active ? C.primary : C.border}`,
          background: active ? C.primaryBg : C.surface,
          color: active ? C.primary : C.textBase,
          display: "grid",
          gridTemplateColumns: "30px minmax(0, 1fr) 14px",
          alignItems: "center",
          gap: 9,
          padding: "8px 9px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ width: 30, height: 30, borderRadius: 7, display: "grid", placeItems: "center", background: C.card, border: `1px solid ${active ? `${C.primary}40` : C.border}`, flexShrink: 0 }}>
          {item.icon}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", color: active ? C.textBright : C.textBase, fontSize: "0.74rem", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
          <span style={{ display: "block", color: C.textMuted, fontSize: "0.62rem", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.detail}</span>
        </span>
        <ChevronRight size={14} strokeWidth={2.2} style={{ color: active ? C.primary : C.textDim }} />
      </button>
    );
  }
}
