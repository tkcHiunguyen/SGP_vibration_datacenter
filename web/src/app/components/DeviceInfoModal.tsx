import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Clock3,
  Cpu,
  Loader2,
  MapPin,
  PencilLine,
  Radio,
  Save,
  Server,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Sensor } from "../data/sensors";
import { useTheme } from "../context/ThemeContext";
import { ConsoleButton } from "./ui/Button";
import { FormFieldShell, FormInput, FormSelect } from "./ui/Form";
import { ConfirmModal, Modal } from "./ui/Modal";
import type { ToastItem } from "./ui";

interface DeviceInfoModalProps {
  sensor: Sensor | null;
  onClose: () => void;
  onSensorUpdated?: (sensor: Sensor) => void;
  onSensorDeleted?: (deviceId: string) => void;
  onNotify?: (message: Omit<ToastItem, "id">) => void;
  initialMode?: "view" | "edit" | "delete";
}

type ZoneOption = {
  id: number;
  code: string;
  name: string;
};

type DetailItem = {
  icon: React.ReactNode;
  label: string;
  value: string;
};

type DetailSection = {
  title: string;
  items: DetailItem[];
};

type NotifyMessage = Omit<ToastItem, "id">;

function safeString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function parseZones(payload: unknown): ZoneOption[] {
  const root = asRecord(payload);
  const source = Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : [];
  return source
    .map((item) => asRecord(item))
    .map((item) => ({
      id: asNumber(item.id),
      code: safeString(item.code).trim(),
      name: safeString(item.name).trim(),
    }))
    .filter((zone) => zone.id > 0 && zone.code)
    .sort((left, right) => left.code.localeCompare(right.code, "vi"));
}

function DetailRow({ icon, label, value }: DetailItem) {
  const { C } = useTheme();
  return (
    <div
      className="device-info-detail-row"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 6px",
      }}
    >
      <div
        className="device-info-detail-label-wrap"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          color: C.textMuted,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span className="device-info-detail-icon" style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>
        <span className="device-info-detail-label" style={{ fontSize: "0.74rem" }}>{label}</span>
      </div>
      <span
        className="device-info-detail-value"
        style={{
          fontSize: "0.74rem",
          color: C.textBright,
          textAlign: "right",
          maxWidth: "58%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: 600,
        }}
      >
        {value || "--"}
      </span>
    </div>
  );
}

function EditDeviceModal({
  open,
  onClose,
  sensor,
  onSaved,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  sensor: Sensor;
  onSaved: (sensor: Sensor) => void;
  onNotify?: (message: NotifyMessage) => void;
}) {
  const { C } = useTheme();
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [nameDraft, setNameDraft] = useState(sensor.name || "");
  const [zoneDraft, setZoneDraft] = useState(sensor.zoneCode || "");
  const [editError, setEditError] = useState("");

  useEffect(() => {
    if (!open) {
      setSavingEdit(false);
      return;
    }
    setNameDraft(sensor.name || "");
    setZoneDraft(sensor.zoneCode || "");
    setEditError("");
  }, [open, sensor.id]);

  useEffect(() => {
    if (!open || zones.length > 0) {
      return;
    }
    void loadZoneOptions();
  }, [open, zones.length]);

  async function loadZoneOptions(): Promise<void> {
    setLoadingZones(true);
    setEditError("");

    try {
      const response = await fetch("/api/zones", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "zone_load_failed"));
      }
      setZones(parseZones(body));
    } catch (error) {
      setEditError(`Không tải được danh sách khu vực: ${safeString(error)}`);
    } finally {
      setLoadingZones(false);
    }
  }

  async function saveDeviceInfo(): Promise<void> {
    const nextName = nameDraft.trim();
    const nextZone = zoneDraft.trim();
    const saveStartedAt = Date.now();
    const minLoadingMs = 450;

    const waitForMinimumSpinnerDuration = async (): Promise<void> => {
      const elapsed = Date.now() - saveStartedAt;
      if (elapsed < minLoadingMs) {
        await new Promise((resolve) => setTimeout(resolve, minLoadingMs - elapsed));
      }
    };

    setSavingEdit(true);
    setEditError("");

    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(sensor.id)}`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: nextName,
          zone: nextZone,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "device_update_failed"));
      }

      await waitForMinimumSpinnerDuration();

      const selectedZone = zones.find((zone) => zone.code === nextZone);
      const updatedSensor: Sensor = {
        ...sensor,
        name: nextName || sensor.id,
        zoneCode: nextZone,
        zone: nextZone ? selectedZone?.code || nextZone : "--",
      };
      onSaved(updatedSensor);
      onNotify?.({
        type: "success",
        title: "Lưu thành công",
        text: `Đã cập nhật thông tin thiết bị ${updatedSensor.name}.`,
      });
      setSavingEdit(false);
      onClose();
    } catch (error) {
      await waitForMinimumSpinnerDuration();
      const text = `Không lưu được: ${safeString(error)}`;
      setEditError(text);
      onNotify?.({
        type: "warning",
        title: "Lưu thất bại",
        text,
      });
      setSavingEdit(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Chỉnh sửa thiết bị"
      description={`Cập nhật tên và khu vực cho ${sensor.name || sensor.id}`}
      width={520}
      zIndex={120}
      disableClose={savingEdit}
      backdropBlur={0}
      cardClassName="device-info-edit-modal"
      footer={
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ConsoleButton
            variant="neutral"
            size="sm"
            className="device-info-action-btn"
            onClick={onClose}
            disabled={savingEdit}
          >
            Huỷ
          </ConsoleButton>
          <ConsoleButton
            variant="primary"
            size="sm"
            className="device-info-action-btn"
            onClick={() => void saveDeviceInfo()}
            disabled={savingEdit || loadingZones}
          >
            {savingEdit ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {savingEdit ? "Đang lưu..." : "Lưu thay đổi"}
          </ConsoleButton>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ color: C.textMuted, fontSize: "0.7rem", fontWeight: 700 }}>Tên thiết bị</div>
          <FormFieldShell className="h-9">
            <FormInput
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              disabled={savingEdit}
              placeholder="Nhập tên thiết bị"
            />
          </FormFieldShell>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ color: C.textMuted, fontSize: "0.7rem", fontWeight: 700 }}>Khu vực</div>
          {loadingZones ? (
            <div
              style={{
                height: 36,
                borderRadius: 9,
                border: `1px solid ${C.cardBorder}`,
                background: C.input,
                color: C.textMuted,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "0 11px",
                fontSize: "0.72rem",
              }}
            >
              <Loader2 size={13} className="animate-spin" />
              Đang tải...
            </div>
          ) : (
            <FormFieldShell className="h-9">
              <FormSelect
                value={zoneDraft}
                onChange={(event) => setZoneDraft(event.target.value)}
                disabled={savingEdit}
                style={{ cursor: savingEdit ? "wait" : "pointer" }}
              >
                <option value="">Không chọn khu vực</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.code}>
                    {zone.code} - {zone.name}
                  </option>
                ))}
              </FormSelect>
            </FormFieldShell>
          )}
        </div>

        {editError ? (
          <div
            role="alert"
            style={{
              display: "inline-flex",
              alignItems: "flex-start",
              gap: 7,
              color: C.danger,
              background: C.dangerBg,
              border: `1px solid ${C.danger}40`,
              borderRadius: 8,
              padding: "8px 9px",
              fontSize: "0.72rem",
              lineHeight: 1.45,
            }}
          >
            <AlertTriangle size={14} strokeWidth={2.2} />
            <span>{editError}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function DeviceInfoModal({
  sensor,
  onClose,
  onSensorUpdated,
  onSensorDeleted,
  onNotify,
  initialMode = "view",
}: DeviceInfoModalProps) {
  const { C } = useTheme();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isQuickEdit = initialMode === "edit";
  const isQuickDelete = initialMode === "delete";
  const showMainModal = !isQuickEdit && !isQuickDelete;

  useEffect(() => {
    if (!sensor) {
      setEditOpen(false);
      setDeleteOpen(false);
      setDeleting(false);
      return;
    }
    setEditOpen(initialMode === "edit");
    setDeleteOpen(initialMode === "delete");
  }, [sensor?.id, initialMode]);

  if (!sensor) {
    return null;
  }

  const isOnline = sensor.online;
  const isAbnormal = sensor.status === "abnormal";

  const infoSections: DetailSection[] = [
    {
      title: "Thông tin chung",
      items: [
        { icon: <Server size={14} />, label: "UUID", value: sensor.uuid },
        { icon: <MapPin size={14} />, label: "Site", value: sensor.site },
        { icon: <MapPin size={14} />, label: "Zone", value: sensor.zone },
      ],
    },
    {
      title: "Phần cứng",
      items: [
        { icon: <Cpu size={14} />, label: "Sensor Version", value: sensor.sensorVersion },
        { icon: <Cpu size={14} />, label: "Firmware Version", value: sensor.firmwareVersion },
        { icon: <Radio size={14} />, label: "Signal", value: sensor.signal },
      ],
    },
    {
      title: "Thời gian",
      items: [
        { icon: <Clock3 size={14} />, label: "Uptime", value: sensor.uptime },
        { icon: <CalendarClock size={14} />, label: "Connected At", value: sensor.connectedAt },
        { icon: <CalendarClock size={14} />, label: "Last Heartbeat", value: sensor.lastHeartbeatAt },
      ],
    },
  ];

  async function handleDeleteDevice(): Promise<void> {
    if (deleting) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(sensor.id)}`, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "device_delete_failed"));
      }
      const payload = asRecord(body);
      const data = asRecord(payload.data);
      const telemetryDeleted = asNumber(data.telemetryDeleted);
      const telemetryDeletedLabel = new Intl.NumberFormat("vi-VN").format(telemetryDeleted);

      onNotify?.({
        type: "success",
        title: "Xoá thiết bị thành công",
        text: `Đã xoá: ${telemetryDeletedLabel} dữ liệu telemetry của thiết bị ${sensor.name || sensor.id}.`,
      });
      setDeleteOpen(false);
      onSensorDeleted?.(sensor.id);
      onClose();
    } catch (error) {
      onNotify?.({
        type: "warning",
        title: "Xoá thiết bị thất bại",
        text: `Không xoá được thiết bị: ${safeString(error)}`,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes deviceInfoBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes deviceInfoModalIn {
          from {
            opacity: 0;
            transform: translate(-50%, -48.5%) scale(0.975);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }

        @keyframes deviceInfoEnter {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .zone-modal-backdrop {
          animation: deviceInfoBackdropIn 150ms ease;
        }

        .zone-modal-card {
          animation: deviceInfoModalIn 170ms cubic-bezier(0.24, 0.82, 0.22, 1);
          will-change: transform, opacity;
        }

        .device-info-main-modal {
          width: min(540px, calc(100vw - 24px)) !important;
        }

        .device-info-shell {
          animation: deviceInfoEnter 160ms ease;
        }

        .device-info-pill {
          transition: transform 120ms ease, filter 120ms ease;
        }

        .device-info-pill:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
        }

        .device-info-cta {
          transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
        }

        .device-info-cta:hover {
          transform: translateY(-1px);
          filter: brightness(1.04);
          box-shadow: 0 8px 18px rgba(37, 99, 235, 0.18);
        }

        .device-info-cta:active {
          transform: translateY(0) scale(0.985);
        }

        .device-info-section {
          transition: border-color 140ms ease;
        }

        .device-info-section:hover {
          border-color: ${C.primary}44 !important;
        }

        .device-info-action-btn {
          transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease !important;
        }

        .device-info-action-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
          box-shadow: 0 6px 16px rgba(2, 6, 23, 0.14);
        }

        .device-info-action-btn:active {
          transform: translateY(0) scale(0.985);
          box-shadow: none;
        }

        @media (max-width: 1512px) {
          .device-info-main-modal {
            width: min(520px, calc(100vw - 20px)) !important;
          }

          .device-info-detail-value {
            max-width: 61% !important;
          }
        }

        @media (max-width: 1366px) {
          .device-info-main-modal {
            width: min(485px, calc(100vw - 16px)) !important;
          }

          .device-info-shell {
            gap: 11px !important;
          }

          .device-info-detail-row {
            align-items: flex-start !important;
            gap: 8px !important;
            padding: 9px 4px !important;
          }

          .device-info-detail-label,
          .device-info-detail-value {
            font-size: 0.71rem !important;
            line-height: 1.4;
          }

          .device-info-detail-value {
            max-width: 66% !important;
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
            overflow-wrap: anywhere;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .zone-modal-backdrop,
          .zone-modal-card,
          .device-info-shell {
            animation: none !important;
          }

          .device-info-pill,
          .device-info-cta,
          .device-info-section,
          .device-info-action-btn {
            transition: none !important;
            transform: none !important;
          }
        }
      `}</style>

      {showMainModal ? (
        <Modal
          open
          onClose={onClose}
          disableClose={deleting}
          title={sensor.name || sensor.id}
          description={`${sensor.id} • ${sensor.zone || "--"}`}
          width={540}
          backdropBlur={0}
          cardClassName="device-info-main-modal"
          footer={
            <div
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: C.textMuted, fontSize: "0.68rem", fontWeight: 600 }}>
                Cập nhật {sensor.lastUpdated} phút trước
              </span>
              <ConsoleButton
                variant="neutral"
                size="sm"
                className="device-info-action-btn"
                onClick={onClose}
                disabled={deleting}
              >
                Đóng
              </ConsoleButton>
            </div>
          }
        >
          <div className="device-info-shell" style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <div
                  className="device-info-pill"
                  style={{
                    height: 28,
                    padding: "0 10px",
                    borderRadius: 999,
                    border: `1px solid ${isOnline ? `${C.success}45` : C.border}`,
                    background: isOnline ? C.successBg : C.input,
                    color: isOnline ? C.success : C.textMuted,
                    fontSize: "0.67rem",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  {isOnline ? <Wifi size={12} strokeWidth={2.1} /> : <WifiOff size={12} strokeWidth={2.1} />}
                  {isOnline ? "Trực tuyến" : "Ngoại tuyến"}
                </div>

                <div
                  className="device-info-pill"
                  style={{
                    height: 28,
                    padding: "0 10px",
                    borderRadius: 999,
                    border: `1px solid ${isAbnormal ? `${C.danger}45` : `${C.primary}45`}`,
                    background: isAbnormal ? C.dangerBg : C.primaryBg,
                    color: isAbnormal ? C.danger : C.primary,
                    fontSize: "0.67rem",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  {isAbnormal ? <AlertTriangle size={12} strokeWidth={2.1} /> : <Activity size={12} strokeWidth={2.1} />}
                  {isAbnormal ? "Bất thường" : "Bình thường"}
                </div>
              </div>

              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                <ConsoleButton
                  variant="primary"
                  size="sm"
                  className="device-info-cta"
                  disabled={deleting}
                  onClick={() => setEditOpen(true)}
                >
                  <PencilLine size={13} />
                  Chỉnh sửa
                </ConsoleButton>
                <ConsoleButton
                  variant="danger"
                  size="sm"
                  className="device-info-cta"
                  disabled={deleting}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={13} />
                  Xoá thiết bị
                </ConsoleButton>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {infoSections.map((section, idx) => (
                <div
                  key={section.title}
                  className="device-info-section"
                  style={{ animation: "deviceInfoEnter 150ms ease both" }}
                >
                  {idx > 0 ? (
                    <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: 10 }} />
                  ) : null}
                  <div
                    style={{
                      color: C.textMuted,
                      fontSize: "0.63rem",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      marginBottom: 6,
                      padding: "0 6px",
                    }}
                  >
                    {section.title}
                  </div>
                  <div
                    style={{
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      background: C.card,
                      padding: "0 6px",
                    }}
                  >
                    {section.items.map((item, rowIdx) => (
                      <div
                        key={item.label}
                        style={rowIdx > 0 ? { borderTop: `1px solid ${C.border}` } : undefined}
                      >
                        <DetailRow icon={item.icon} label={item.label} value={item.value} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}

      <EditDeviceModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          if (isQuickEdit) {
            onClose();
          }
        }}
        sensor={sensor}
        onSaved={(updated) => onSensorUpdated?.(updated)}
        onNotify={onNotify}
      />

      <ConfirmModal
        open={deleteOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteOpen(false);
            if (isQuickDelete) {
              onClose();
            }
          }
        }}
        onConfirm={() => void handleDeleteDevice()}
        title="Xác nhận xoá thiết bị"
        description={
          <>
            Thiết bị <strong style={{ color: C.textBright }}>{sensor.name || sensor.id}</strong> sẽ bị
            lưu trữ và không còn hiển thị ở danh sách vận hành.
          </>
        }
        confirmLabel={deleting ? "Đang xoá..." : "Xoá thiết bị"}
        cancelLabel="Huỷ"
        busy={deleting}
        danger
        zIndex={123}
      />
    </>
  );
}
