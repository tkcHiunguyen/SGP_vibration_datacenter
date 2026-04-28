import React from "react";

export type ToastItem = {
  id: number;
  text: string;
  title?: string;
  type: "success" | "warning";
  closing?: boolean;
};

export function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="dc-toast-stack" aria-live="polite" aria-atomic="false">
      {items.map((toast) => (
        <ToastItemView key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItemView({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className={`dc-toast dc-toast--${toast.type}${toast.closing ? " is-leaving" : ""}`}
      role="status"
    >
      <div className={`dc-toast__icon dc-toast__icon--${toast.type}`} aria-hidden="true">
        {toast.type === "success" ? "✓" : "!"}
      </div>
      <div className="dc-toast__body">
        <div className="dc-toast__title">
          {toast.title ||
            (toast.type === "success" ? "Thiết bị kết nối" : "Thiết bị ngắt kết nối")}
        </div>
        <div className="dc-toast__content">{toast.text}</div>
      </div>
      <button
        type="button"
        className="dc-toast__close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Đóng thông báo"
      >
        ×
      </button>
    </div>
  );
}

