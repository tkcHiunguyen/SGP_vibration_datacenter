import React, { useEffect } from "react";
import { X } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { ConsoleButton } from "./Button";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
  zIndex = 90,
  disableClose = false,
  backdropBlur = 2,
  backdropClassName,
  cardClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  zIndex?: number;
  disableClose?: boolean;
  backdropBlur?: number;
  backdropClassName?: string;
  cardClassName?: string;
}) {
  const { C } = useTheme();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || disableClose) {
        return;
      }
      onClose();
    };

    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onEsc);
    };
  }, [disableClose, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className={backdropClassName ? `zone-modal-backdrop ${backdropClassName}` : "zone-modal-backdrop"}
        onClick={() => {
          if (!disableClose) {
            onClose();
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex,
          background: "rgba(0, 0, 0, 0.46)",
          backdropFilter: backdropBlur > 0 ? `blur(${backdropBlur}px)` : "none",
        }}
      />
      <div
        className={cardClassName ? `zone-modal-card ${cardClassName}` : "zone-modal-card"}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: zIndex + 1,
          width: `min(${width}px, calc(100vw - 30px))`,
          background: C.card,
          border: `1px solid ${C.cardBorder}`,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            background: C.surface,
            borderBottom: `1px solid ${C.border}`,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ color: C.textBright, fontSize: "0.88rem", fontWeight: 800 }}>{title}</div>
            {description ? (
              <div style={{ color: C.textMuted, fontSize: "0.7rem", marginTop: 3 }}>{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Đóng"
            disabled={disableClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: "transparent",
              border: `1px solid ${C.border}`,
              cursor: disableClose ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.14s, border-color 0.14s, transform 0.14s, box-shadow 0.14s",
              opacity: disableClose ? 0.5 : 1,
            }}
            onMouseEnter={(event) => {
              if (disableClose) {
                return;
              }
              event.currentTarget.style.background = "#ef444422";
              event.currentTarget.style.borderColor = "#ef4444";
              event.currentTarget.style.transform = "translateY(-1px)";
              event.currentTarget.style.boxShadow = "0 6px 14px rgba(239, 68, 68, 0.16)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
              event.currentTarget.style.borderColor = C.border;
              event.currentTarget.style.transform = "translateY(0)";
              event.currentTarget.style.boxShadow = "none";
            }}
            onMouseDown={(event) => {
              if (disableClose) {
                return;
              }
              event.currentTarget.style.transform = "translateY(0) scale(0.97)";
            }}
            onMouseUp={(event) => {
              if (disableClose) {
                return;
              }
              event.currentTarget.style.transform = "translateY(-1px)";
            }}
            aria-label="Đóng"
          >
            <X size={16} color={C.textMuted} strokeWidth={2.5} />
          </button>
        </div>

        <div style={{ padding: "14px" }}>{children}</div>

        {footer ? (
          <div
            style={{
              borderTop: `1px solid ${C.border}`,
              background: C.surface,
              padding: "10px 14px",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Xác nhận",
  cancelLabel = "Huỷ",
  busy = false,
  danger = false,
  zIndex = 92,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  zIndex?: number;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      disableClose={busy}
      zIndex={zIndex}
      width={440}
      footer={
        <>
          <ConsoleButton variant="neutral" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </ConsoleButton>
          <ConsoleButton
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </ConsoleButton>
        </>
      }
    >
      <div style={{ fontSize: "0.75rem", lineHeight: 1.5 }}>{description}</div>
    </Modal>
  );
}
