import React from "react";
import {
  Activity, Bell, LayoutDashboard,
  Cpu, BarChart2, Settings, UploadCloud, MapPin,
  MonitorUp, PanelLeftClose, PanelLeftOpen, Sun, Moon,
} from "lucide-react";
import { Sensor } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";
import { useDisplayMode } from "../context/DisplayModeContext";

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

export function shouldShowNotificationDot(alertCount: number): boolean {
  return alertCount > 0;
}

export function TopHeader({ activeNav, onNavChange, navItems, sidebarOpen, onToggleSidebar, sensors, alertCount }: TopHeaderProps) {
  const { theme, toggleTheme, C } = useTheme();
  const { wallboard, autoDetected, manualOverride, toggleWallboard } = useDisplayMode();
  const derivedAlertCount = typeof alertCount === "number" ? alertCount : sensors.filter(s => s.status === "abnormal").length;
  const isDark = theme === "dark";

  return (
    <header className="dc-top-header" style={{
      background: C.headerBg,
      borderBottom: `1px solid ${C.border}`,
      boxShadow: isDark
        ? "0 1px 3px rgba(0,0,0,0.5)"
        : "0 1px 3px rgba(0,0,0,0.08)",
      flexShrink: 0,
      zIndex: 60,
      position: "relative",
    }}>
      <div className="dc-top-header-inner" style={{ display: "flex", alignItems: "center", gap: 0 }}>

        <button
          className="dc-header-icon-button"
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Ẩn menu" : "Hiện menu"}
          aria-label={sidebarOpen ? "Ẩn menu điều hướng" : "Hiện menu điều hướng"}
          style={{
            width: 34, height: 34, borderRadius: 8,
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
          <span style={{ position: "relative", width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <PanelLeftClose
              size={14}
              strokeWidth={2}
              style={{
                position: "absolute",
                opacity: sidebarOpen ? 1 : 0,
                transform: sidebarOpen ? "rotate(0deg) scale(1)" : "rotate(-45deg) scale(0.72)",
                transition: "opacity 0.18s ease, transform 0.18s ease",
              }}
            />
            <PanelLeftOpen
              size={14}
              strokeWidth={2}
              style={{
                position: "absolute",
                opacity: sidebarOpen ? 0 : 1,
                transform: sidebarOpen ? "rotate(45deg) scale(0.72)" : "rotate(0deg) scale(1)",
                transition: "opacity 0.18s ease, transform 0.18s ease",
              }}
            />
          </span>
        </button>

        {/* Brand */}
        <div className="dc-header-brand" style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 24, flexShrink: 0 }}>
          <div className="dc-header-brand-icon" style={{
            width: 28, height: 28, borderRadius: 8,
            background: C.primary,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Activity size={13} color="#fff" strokeWidth={2.5} />
          </div>
          <div className="dc-header-brand-copy">
            <div className="dc-header-brand-title" style={{ color: C.textBright, fontWeight: 700, fontSize: "0.83rem", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              SGP Vibration Datacenter
            </div>
            <div className="dc-header-subtitle" style={{ color: C.textDim, fontSize: "0.75rem", letterSpacing: "0.11em", textTransform: "uppercase", fontWeight: 600 }}>
              Hệ thống giám sát công nghiệp
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="dc-header-divider" style={{ width: 1, height: 22, background: C.border, marginRight: 20, flexShrink: 0 }} />

        {/* Nav */}
        <nav className="dc-header-nav" style={{ flex: 1, display: "flex", alignItems: "center", gap: 2, minWidth: 0, overflowX: "auto", scrollbarWidth: "thin", scrollbarColor: `${C.scrollbar} transparent` }}>
          {navItems.map((label) => {
            const isActive = activeNav === label;
            return (
              <button className="dc-header-nav-button" key={label} onClick={() => onNavChange(label)}
                type="button"
                aria-current={isActive ? "page" : undefined}
                style={{
                  height: 34, padding: "0 12px", borderRadius: 8,
                  background: isActive ? C.navActive : "transparent",
                  border: `1px solid ${isActive ? C.cardBorder : "transparent"}`,
                  color: isActive ? C.textBright : C.textMuted,
                  fontSize: "0.75rem", fontWeight: isActive ? 600 : 400,
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
        <div className="dc-header-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

          <div className="dc-header-alert-pill" role="status" aria-label={`${derivedAlertCount} cảnh báo`} style={{
            display: "flex", alignItems: "center", gap: 5,
            height: 30, padding: "0 10px", borderRadius: 8,
            background: C.dangerBg, border: `1px solid ${C.danger}22`,
          }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Bell size={12} color={C.danger} strokeWidth={2} />
              {shouldShowNotificationDot(derivedAlertCount) ? (
                <span
                  data-ux="notification-dot"
                  aria-hidden="true"
                  style={{
                    position: "absolute", top: -2, right: -2, width: 5, height: 5,
                    borderRadius: "50%", background: C.danger,
                    border: `1px solid ${C.headerBg}`,
                  }}
                />
              ) : null}
            </span>
            <span className="dc-header-alert-label" style={{ color: C.danger, fontSize: "0.75rem", fontWeight: 600 }}>
              {derivedAlertCount} cảnh báo
            </span>
          </div>

          <div style={{ width: 1, height: 18, background: C.border }} />

          <button
            type="button"
            className="dc-wallboard-toggle"
            aria-pressed={wallboard}
            aria-label={`${wallboard ? "Tắt" : "Bật"} chế độ Wallboard 5 mét`}
            title={`${wallboard ? "Tắt" : "Bật"} chế độ Wallboard 5m${manualOverride === null && autoDetected ? " (đang tự động)" : ""}`}
            onClick={toggleWallboard}
            style={{
              minWidth: 34,
              height: 34,
              padding: "0 9px",
              borderRadius: 8,
              background: wallboard ? C.primaryBg : C.card,
              border: `1px solid ${wallboard ? C.primary : C.cardBorder}`,
              color: wallboard ? C.primary : C.textMuted,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <MonitorUp size={13} strokeWidth={2.2} />
            <span className="dc-wallboard-toggle-label">5m</span>
          </button>

          {/* Theme toggle */}
          <button className="dc-header-icon-button" type="button" onClick={toggleTheme} title={isDark ? "Chế độ sáng" : "Chế độ tối"} aria-label={isDark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
            style={{
              width: 34, height: 34, borderRadius: 8,
              background: C.card, border: `1px solid ${C.cardBorder}`,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
            }}>
            {isDark
              ? <Sun  size={13} color={C.warning} strokeWidth={2} />
              : <Moon size={13} color={C.textMuted} strokeWidth={2} />}
          </button>

          <div className="dc-header-user-button" title="Tài khoản hiện tại" style={{
            display: "flex", alignItems: "center", gap: 6,
            height: 34, padding: "0 8px", borderRadius: 8,
            background: C.card, border: `1px solid ${C.cardBorder}`,
          }}>
            <div className="dc-header-user-avatar" style={{
              width: 20, height: 20, borderRadius: 6,
              background: C.primary,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: isDark ? "#07111f" : "#fff", fontSize: "0.75rem", fontWeight: 700,
            }}>QT</div>
            <span className="dc-header-user-name" style={{ color: C.textBase, fontSize: "0.75rem", fontWeight: 500 }}>Quản trị</span>
          </div>
        </div>
      </div>
    </header>
  );
}
