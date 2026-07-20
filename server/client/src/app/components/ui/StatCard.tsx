import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { cx } from "./cx";

export function ConsoleStatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx("dc-stat-grid grid gap-2.5", className)}
    >
      {children}
    </div>
  );
}

export function ConsoleStatCard({
  label,
  value,
  color,
  bg,
  border,
  icon,
  caption,
  className,
  style,
}: {
  label: string;
  value: number | string;
  color: string;
  bg: string;
  border: string;
  icon?: React.ReactNode;
  caption?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { C } = useTheme();
  return (
    <article
      className={cx(
        "dc-stat-card rounded-xl border px-3 py-2.5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_22px_rgba(2,6,23,0.16)]",
        className,
      )}
      style={{ background: bg, borderColor: border, ...style }}
    >
      <div className="flex items-start gap-2.5">
        {icon ? (
          <div
            className="dc-stat-card-icon inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
            style={{ background: `${color}1A`, color }}
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <div
            className="dc-stat-card-label"
            style={{
              color: C.textMuted,
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
          <div
            className="dc-stat-card-value tabular-nums"
            style={{ color, fontSize: "1.2rem", fontWeight: 800, marginTop: 2, lineHeight: 1.15 }}
          >
            {value}
          </div>
          {caption ? (
            <div className="dc-stat-card-caption" style={{ color: C.textMuted, fontSize: "0.68rem", marginTop: 4 }}>
              {caption}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

