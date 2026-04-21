import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { cx } from "./cx";

type ShellProps = {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function FormFieldShell({ icon, children, className, style }: ShellProps) {
  const { C } = useTheme();
  return (
    <label
      className={cx("flex items-center gap-1.5 rounded-[9px] border px-2.5", className)}
      style={{
        borderColor: C.cardBorder,
        background: C.input,
        ...style,
      }}
    >
      {icon ? <span style={{ color: C.textMuted }}>{icon}</span> : null}
      {children}
    </label>
  );
}

export function FormInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    className?: string;
    style?: React.CSSProperties;
  },
) {
  const { C } = useTheme();
  const { className, style, ...rest } = props;
  return (
    <input
      {...rest}
      className={cx(
        "w-full border-none bg-transparent text-[0.74rem] outline-none",
        className,
      )}
      style={{ color: C.textBright, ...style }}
    />
  );
}

export function FormSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & {
    className?: string;
    style?: React.CSSProperties;
  },
) {
  const { C } = useTheme();
  const { className, style, ...rest } = props;
  return (
    <select
      {...rest}
      className={cx(
        "w-full border-none bg-transparent text-[0.72rem] outline-none",
        className,
      )}
      style={{ color: C.textBright, ...style }}
    />
  );
}

export function FormTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    className?: string;
    style?: React.CSSProperties;
  },
) {
  const { C } = useTheme();
  const { className, style, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cx(
        "w-full rounded-[9px] border px-2.5 py-2.5 text-[0.74rem] outline-none",
        className,
      )}
      style={{
        borderColor: C.cardBorder,
        background: C.input,
        color: C.textBright,
        ...style,
      }}
    />
  );
}

