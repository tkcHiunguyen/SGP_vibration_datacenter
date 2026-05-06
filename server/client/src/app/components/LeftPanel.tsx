import React, { useMemo, useState } from "react";
import {
  CloudUpload,
  Gauge,
  MapPinned,
  Pin,
  PinOff,
  RadioTower,
  SlidersHorizontal,
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
      return <Gauge size={15} strokeWidth={2.2} />;
    case "Update Center":
      return <CloudUpload size={15} strokeWidth={2.2} />;
    case "Quản lý khu vực":
      return <MapPinned size={15} strokeWidth={2.2} />;
    case "Cảm biến":
      return <RadioTower size={15} strokeWidth={2.2} />;
    case "Cài đặt":
      return <SlidersHorizontal size={15} strokeWidth={2.2} />;
    default:
      return <Gauge size={15} strokeWidth={2.2} />;
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
      aria-label="Điều hướng chính"
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(180deg, ${C.surface} 0%, ${C.bg} 100%)`,
        borderRight: `1px solid ${C.border}`,
        padding: "12px 9px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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

      <nav style={{ display: "grid", gap: 6, overflowY: "auto", paddingRight: 2 }}>
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
                minHeight: 40,
                borderRadius: 12,
                border: `1px solid ${isActive ? C.primary + "66" : isHovered ? C.primary + "33" : C.cardBorder}`,
                background: isActive
                  ? `linear-gradient(135deg, ${C.primaryBg}, ${C.card})`
                  : isHovered
                    ? C.primary + "0f"
                    : C.card,
                color: isActive ? C.primary : isHovered ? C.textBright : C.textBase,
                display: "grid",
                gridTemplateColumns: "28px minmax(0, 1fr) 24px",
                alignItems: "center",
                gap: 8,
                padding: "5px 7px 5px 8px",
                cursor: "pointer",
                userSelect: "none",
                outline: "none",
                boxShadow:
                  isActive || isHovered
                    ? `0 8px 18px ${C.primaryGlow}`
                    : "0 0 0 rgba(0,0,0,0)",
                transform: isActive ? "translateX(2px)" : isHovered ? "translateX(2px)" : "translateX(0)",
                transition:
                  "background 0.22s ease, border-color 0.22s ease, color 0.2s ease, box-shadow 0.24s ease, transform 0.22s ease",
                animation: "sidebarCardIn 280ms cubic-bezier(0.16, 1, 0.3, 1) both",
                animationDelay: `${Math.min(index * 35, 220)}ms`,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 9,
                  background: isActive ? C.primary + "20" : isHovered ? C.primary + "16" : C.surface,
                  border: `1px solid ${isActive ? C.primary + "55" : C.border}`,
                  color: isActive ? C.primary : C.textMuted,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: isActive ? `0 0 12px ${C.primaryGlow}` : "none",
                }}
              >
                {navIcon(label)}
              </div>

              <div style={{ minWidth: 0, display: "flex", alignItems: "center" }}>
                <span style={{ minWidth: 0, color: isActive ? C.textBright : "inherit", fontSize: "0.74rem", fontWeight: isActive ? 760 : 620, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                  width: 24,
                  height: 24,
                  borderRadius: 8,
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
      </nav>
    </aside>
  );
}
