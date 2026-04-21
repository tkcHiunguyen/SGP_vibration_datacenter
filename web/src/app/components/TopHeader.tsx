import React from "react";
import {
  Activity, Bell, ChevronDown, LayoutDashboard,
  Cpu, BarChart2, Settings, Search, AlertCircle, UploadCloud, MapPin,
  Menu, Sun, Moon,
} from "lucide-react";
import { Sensor } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";

function navIcon(label: string): React.ReactNode {
  switch (label) {
    case "Tổng quan":
      return <LayoutDashboard size={13} strokeWidth={2} />;
    case "Update Center":
      return <UploadCloud size={13} strokeWidth={2} />;
    case "Quản lý khu vực":
      return <MapPin size={13} strokeWidth={2} />;
    case "Cảm biến":
      return <Cpu size={13} strokeWidth={2} />;
    case "Phân tích":
      return <BarChart2 size={13} strokeWidth={2} />;
    case "Cài đặt":
      return <Settings size={13} strokeWidth={2} />;
    default:
      return <LayoutDashboard size={13} strokeWidth={2} />;
  }
}

interface TopHeaderProps {
  activeNav: string;
  onNavChange: (label: string) => void;
  navItems: string[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  sensors: Sensor[];
  alertCount?: number;
}

export function TopHeader({ activeNav, onNavChange, navItems, sidebarOpen, onToggleSidebar, sensors, alertCount }: TopHeaderProps) {
  const { theme, toggleTheme, C } = useTheme();
  const derivedAlertCount = typeof alertCount === "number" ? alertCount : sensors.filter(s => s.status === "abnormal").length;
  const isDark = theme === "dark";

  return (
    <header style={{
      background: C.headerBg,
      borderBottom: `1px solid ${C.border}`,
      boxShadow: isDark
        ? "0 1px 3px rgba(0,0,0,0.5)"
        : "0 1px 3px rgba(0,0,0,0.08)",
      flexShrink: 0,
      zIndex: 30,
      position: "relative",
    }}>
      <div style={{ padding: "0 20px", height: 54, display: "flex", alignItems: "center", gap: 0 }}>

        {/* Hamburger */}
        <button
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Ẩn menu" : "Hiện menu"}
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: "transparent",
            border: `1px solid ${C.border}`,
            cursor: "pointer", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginRight: 12, transition: "background 0.15s, border-color 0.15s",
            color: C.textMuted,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.card; (e.currentTarget as HTMLElement).style.borderColor = C.cardBorder; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
        >
          <Menu size={13} strokeWidth={2} />
        </button>

        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 28, flexShrink: 0 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryDim} 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 14px ${C.primaryGlow}`,
            flexShrink: 0,
          }}>
            <Activity size={13} color="#fff" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ color: C.textBright, fontWeight: 700, fontSize: "0.83rem", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              SGP Vibration Datacenter
            </div>
            <div style={{ color: C.textDim, fontSize: "0.53rem", letterSpacing: "0.11em", textTransform: "uppercase", fontWeight: 600 }}>
              Hệ thống giám sát công nghiệp
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 22, background: C.border, marginRight: 20, flexShrink: 0 }} />

        {/* Nav */}
        <nav style={{ flex: 1, display: "flex", alignItems: "center", gap: 2, minWidth: 0, overflowX: "auto", scrollbarWidth: "thin", scrollbarColor: `${C.scrollbar} transparent` }}>
          {navItems.map((label) => {
            const isActive = activeNav === label;
            return (
              <button key={label} onClick={() => onNavChange(label)}
                style={{
                  height: 30, padding: "0 12px", borderRadius: 8,
                  background: isActive ? C.navActive : "transparent",
                  border: `1px solid ${isActive ? C.cardBorder : "transparent"}`,
                  color: isActive ? C.textBright : C.textMuted,
                  fontSize: "0.74rem", fontWeight: isActive ? 600 : 400,
                  cursor: "pointer", transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0,
                }}
                onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = C.textBase; (e.currentTarget as HTMLElement).style.background = C.navActive + "80"; } }}
                onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = C.textMuted; (e.currentTarget as HTMLElement).style.background = "transparent"; } }}
              >
                <span style={{ color: isActive ? C.primary : "inherit" }}>{navIcon(label)}</span>
                {label}
              </button>
            );
          })}
        </nav>

        {/* Right */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            height: 30, padding: "0 10px", borderRadius: 8, width: 148,
            background: C.input, border: `1px solid ${C.border}`,
          }}>
            <Search size={11} color={C.textMuted} strokeWidth={2} />
            <span style={{ color: C.textMuted, fontSize: "0.72rem" }}>Tìm kiếm…</span>
            <span style={{ marginLeft: "auto", background: C.surface, border: `1px solid ${C.border}`, color: C.textDim, fontSize: "0.55rem", borderRadius: 4, padding: "1px 4px", fontWeight: 600 }}>⌘K</span>
          </div>

          {/* Bell */}
          <button style={{
            width: 30, height: 30, borderRadius: 8,
            background: C.card, border: `1px solid ${C.cardBorder}`,
            cursor: "pointer", position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Bell size={13} color={C.textMuted} strokeWidth={2} />
            <span style={{
              position: "absolute", top: 6, right: 6, width: 6, height: 6,
              borderRadius: "50%", background: C.danger,
              border: `1.5px solid ${C.headerBg}`,
            }} />
          </button>

          {/* Alert pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            height: 30, padding: "0 10px", borderRadius: 8,
            background: C.dangerBg, border: `1px solid ${C.danger}22`,
          }}>
            <AlertCircle size={12} color={C.danger} strokeWidth={2} />
            <span style={{ color: C.danger, fontSize: "0.7rem", fontWeight: 600 }}>
              {derivedAlertCount} cảnh báo
            </span>
          </div>

          <div style={{ width: 1, height: 18, background: C.border }} />

          {/* Theme toggle */}
          <button onClick={toggleTheme} title={isDark ? "Chế độ sáng" : "Chế độ tối"}
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: C.card, border: `1px solid ${C.cardBorder}`,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
            }}>
            {isDark
              ? <Sun  size={13} color={C.warning} strokeWidth={2} />
              : <Moon size={13} color={C.textMuted} strokeWidth={2} />}
          </button>

          {/* User */}
          <button style={{
            display: "flex", alignItems: "center", gap: 6,
            height: 30, padding: "0 8px", borderRadius: 8,
            background: C.card, border: `1px solid ${C.cardBorder}`,
            cursor: "pointer",
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: 6,
              background: `linear-gradient(135deg, ${C.primary}, ${C.primaryDim})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "0.53rem", fontWeight: 700,
            }}>QT</div>
            <span style={{ color: C.textBase, fontSize: "0.73rem", fontWeight: 500 }}>Quản trị</span>
            <ChevronDown size={10} color={C.textMuted} strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  );
}
