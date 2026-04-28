import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { cx } from "./cx";

type ConsoleButtonVariant = "neutral" | "primary" | "danger";
type ConsoleButtonSize = "sm" | "md";

function getButtonPalette(
  C: ReturnType<typeof useTheme>["C"],
  variant: ConsoleButtonVariant,
) {
  if (variant === "primary") {
    return {
      bg: C.primaryBg,
      border: C.primary,
      text: C.primary,
      hoverBg: C.primary,
      hoverBorder: C.primary,
      hoverText: "#ffffff",
    };
  }

  if (variant === "danger") {
    return {
      bg: C.dangerBg,
      border: C.danger,
      text: C.danger,
      hoverBg: C.danger,
      hoverBorder: C.danger,
      hoverText: "#ffffff",
    };
  }

  return {
    bg: C.surface,
    border: C.border,
    text: C.textBase,
    hoverBg: C.primaryBg,
    hoverBorder: C.primary,
    hoverText: C.primary,
  };
}

export function ConsoleButton({
  children,
  variant = "neutral",
  size = "md",
  className,
  style,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ConsoleButtonVariant;
  size?: ConsoleButtonSize;
}) {
  const { C } = useTheme();
  const palette = getButtonPalette(C, variant);
  const sizeClass =
    size === "sm" ? "h-7 px-2.5 text-[0.68rem]" : "h-[34px] px-3 text-[0.72rem]";

  const cssVars = {
    "--cc-btn-bg": palette.bg,
    "--cc-btn-border": palette.border,
    "--cc-btn-text": palette.text,
    "--cc-btn-hover-bg": palette.hoverBg,
    "--cc-btn-hover-border": palette.hoverBorder,
    "--cc-btn-hover-text": palette.hoverText,
  } as React.CSSProperties;

  return (
    <button
      {...buttonProps}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-bold transition-colors duration-150",
        "border-[var(--cc-btn-border)] bg-[var(--cc-btn-bg)] text-[var(--cc-btn-text)]",
        "hover:border-[var(--cc-btn-hover-border)] hover:bg-[var(--cc-btn-hover-bg)] hover:text-[var(--cc-btn-hover-text)]",
        "disabled:cursor-not-allowed disabled:opacity-45",
        sizeClass,
        className,
      )}
      style={{ ...cssVars, ...style }}
    >
      {children}
    </button>
  );
}
