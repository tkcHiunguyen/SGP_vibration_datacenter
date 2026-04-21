import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { cx } from "./cx";

export function ConsoleEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const { C } = useTheme();
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-2 px-3 py-6 text-center",
        className,
      )}
      style={{ color: C.textMuted }}
    >
      {icon ? <div style={{ color: C.textDim }}>{icon}</div> : null}
      <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>{title}</div>
      {description ? <div style={{ fontSize: "0.72rem" }}>{description}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

