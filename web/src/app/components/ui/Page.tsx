import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { cx } from "./cx";

export function ConsolePage({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-3.5", className)} style={style}>
      {children}
    </div>
  );
}

export function ConsolePanel({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { C } = useTheme();
  return (
    <section
      className={cx("rounded-xl border", className)}
      style={{
        background: C.card,
        borderColor: C.cardBorder,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function ConsolePageHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const { C } = useTheme();
  return (
    <ConsolePanel className={cx("px-4 py-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {icon ? <span style={{ color: C.primary }}>{icon}</span> : null}
            <h2 style={{ color: C.textBright, margin: 0, fontSize: "1rem", fontWeight: 800 }}>
              {title}
            </h2>
          </div>
          {subtitle ? (
            <p style={{ color: C.textMuted, margin: "6px 0 0", fontSize: "0.74rem" }}>{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </ConsolePanel>
  );
}

