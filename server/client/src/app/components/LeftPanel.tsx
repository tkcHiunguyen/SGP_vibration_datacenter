import React, { useMemo, useState } from "react";
import {
  BarChart2,
  Cpu,
  LayoutDashboard,
  MapPin,
  Pin,
  PinOff,
  Settings,
  UploadCloud,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";

interface LeftPanelProps {
  activeNav: string;
  onNavChange: (label: string) => void;
  navItems: string[];
  pinnedNavItems: string[];
  onTogglePin: (label: string) => void;
}

function navIcon(label: string): React.ReactNode {
  switch (label) {
    case "Tổng quan":
      return <LayoutDashboard size={14} strokeWidth={2.2} />;
    case "Update Center":
      return <UploadCloud size={14} strokeWidth={2.2} />;
    case "Quản lý khu vực":
      return <MapPin size={14} strokeWidth={2.2} />;
    case "Phân tích":
      return <BarChart2 size={14} strokeWidth={2.2} />;
    case "Cảm biến":
      return <Cpu size={14} strokeWidth={2.2} />;
    case "Cài đặt":
      return <Settings size={14} strokeWidth={2.2} />;
    default:
      return <LayoutDashboard size={14} strokeWidth={2.2} />;
  }
}

export function LeftPanel({
  activeNav,
  onNavChange,
  navItems,
  pinnedNavItems,
  onTogglePin,
}: LeftPanelProps) {
  const { C } = useTheme();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const pinnedSet = useMemo(() => new Set(pinnedNavItems), [pinnedNavItems]);

  return (
    <aside
      style={{
        width: "100%",
        height: "100%",
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        padding: "18px 12px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          color: C.textDim,
          fontSize: "0.56rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Điều hướng
      </div>

      <style>
        {`
          @keyframes sidebarCardIn {
            from {
              opacity: 0;
              transform: translateX(-8px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
        `}
      </style>

      <div style={{ display: "grid", gap: 8, overflowY: "auto", paddingRight: 2 }}>
        {navItems.map((label, index) => {
          const isActive = activeNav === label;
          const isPinned = pinnedSet.has(label);
          const isHovered = hoveredItem === label;
          return (
            <div
              key={label}
              role="button"
              tabIndex={0}
              onClick={() => onNavChange(label)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onNavChange(label);
                }
              }}
              onMouseEnter={() => setHoveredItem(label)}
              onMouseLeave={() => setHoveredItem((current) => (current === label ? null : current))}
              style={{
                width: "100%",
                height: 38,
                borderRadius: 10,
                border: `1px solid ${isActive ? C.primary + "55" : isHovered ? C.primary + "33" : C.cardBorder}`,
                background: isActive ? C.primaryBg : isHovered ? C.primary + "0f" : C.card,
                color: isActive ? C.primary : isHovered ? C.textBright : C.textBase,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 8px 0 10px",
                cursor: "pointer",
                userSelect: "none",
                outline: "none",
                boxShadow:
                  isActive || isHovered
                    ? `0 6px 16px ${C.primaryGlow}`
                    : "0 0 0 rgba(0,0,0,0)",
                transform: isActive ? "translateX(2px)" : isHovered ? "translateX(3px)" : "translateX(0)",
                transition:
                  "background 0.22s ease, border-color 0.22s ease, color 0.2s ease, box-shadow 0.24s ease, transform 0.22s ease",
                animation: "sidebarCardIn 280ms cubic-bezier(0.16, 1, 0.3, 1) both",
                animationDelay: `${Math.min(index * 35, 220)}ms`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.75rem",
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                {navIcon(label)}
                <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {label}
                </span>
              </div>

              <button
                type="button"
                title={isPinned ? "Bỏ ghim" : "Ghim mục này"}
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin(label);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 9,
                  border: `1px solid ${isPinned ? C.warning + "66" : isHovered ? C.primary + "40" : C.cardBorder}`,
                  background: isPinned ? C.warningBg : isHovered ? C.primary + "14" : "transparent",
                  color: isPinned ? C.warning : isHovered ? C.primary : C.textMuted,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition:
                    "background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.22s ease",
                  transform: isPinned ? "rotate(-16deg) scale(1.05)" : isHovered ? "scale(1.04)" : "scale(1)",
                }}
              >
                {isPinned ? <Pin size={13} strokeWidth={2.2} /> : <PinOff size={13} strokeWidth={2.2} />}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
