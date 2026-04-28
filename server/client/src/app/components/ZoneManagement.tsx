import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  Layers,
  MapPin,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import {
  ConfirmModal,
  ConsoleButton,
  ConsoleEmptyState,
  ConsolePage,
  ConsolePageHeader,
  ConsolePanel,
  ConsoleStatCard,
  ConsoleStatGrid,
  FormFieldShell,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  type ToastItem,
} from "./ui";

type ZoneItem = {
  id: number;
  code: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

type ZoneFormState = {
  name: string;
  description: string;
};

type ZoneListMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ZoneSummary = {
  total: number;
  withDescription: number;
  updatedToday: number;
  latestUpdatedAt?: string;
};

type ZoneDeleteImpact = {
  zoneId: number;
  zoneCode: string;
  deviceCount: number;
  deviceIds: string[];
};

type DescriptionFilter = "all" | "with-description" | "without-description";
type SortOption = "updated-desc" | "name-asc" | "code-asc";

const PAGE_SIZE = 8;

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

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseZones(payload: unknown): ZoneItem[] {
  const root = asRecord(payload);
  const data = root.data;
  const source = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];

  return source
    .map((item) => asRecord(item))
    .map((item) => ({
      id: asNumber(item.id) ?? 0,
      code: safeString(item.code).trim(),
      name: safeString(item.name).trim(),
      description: safeString(item.description).trim() || undefined,
      createdAt: safeString(item.createdAt || item.created_at),
      updatedAt: safeString(item.updatedAt || item.updated_at),
    }))
    .filter((item) => item.id > 0 && item.code && item.name)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function parseZoneListMeta(payload: unknown): ZoneListMeta {
  const root = asRecord(payload);
  return {
    total: asNumber(root.total) ?? 0,
    page: asNumber(root.page) ?? 1,
    pageSize: asNumber(root.pageSize) ?? PAGE_SIZE,
    totalPages: asNumber(root.totalPages) ?? 1,
  };
}

function parseZoneSummary(payload: unknown): ZoneSummary {
  const root = asRecord(payload);
  return {
    total: asNumber(root.total) ?? 0,
    withDescription: asNumber(root.withDescription) ?? 0,
    updatedToday: asNumber(root.updatedToday) ?? 0,
    latestUpdatedAt: safeString(root.latestUpdatedAt).trim() || undefined,
  };
}

function formatDateTime(value: string): string {
  if (!value) {
    return "-";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(parsed));
}

export function ZoneManagement({ onNotify }: { onNotify?: (message: Omit<ToastItem, "id">) => void }) {
  const { C } = useTheme();
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [summary, setSummary] = useState<ZoneSummary>({
    total: 0,
    withDescription: 0,
    updatedToday: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingDeleteImpact, setLoadingDeleteImpact] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<ZoneDeleteImpact | null>(null);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [descriptionFilter, setDescriptionFilter] = useState<DescriptionFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("updated-desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalZones, setTotalZones] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<ZoneFormState>({
    name: "",
    description: "",
  });

  const [deleteCandidate, setDeleteCandidate] = useState<ZoneItem | null>(null);
  const hasMountedRef = useRef(false);

  const isEditing = editingZoneId !== null;

  async function loadZones(useFullLoading = false): Promise<void> {
    if (useFullLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    setError("");

    try {
      const params = new URLSearchParams();
      const searchValue = search.trim();
      if (searchValue) {
        params.set("search", searchValue);
      }
      params.set("descriptionFilter", descriptionFilter);
      params.set("sortBy", sortBy);
      params.set("page", String(currentPage));
      params.set("pageSize", String(PAGE_SIZE));

      const response = await fetch(`/api/zones?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(payload).error || "zone_load_failed"));
      }
      const root = asRecord(payload);
      const items = parseZones(root.data);
      const meta = parseZoneListMeta(root.meta);
      const nextSummary = parseZoneSummary(root.summary);

      setZones(items);
      setSummary(nextSummary);
      setTotalPages(Math.max(1, meta.totalPages));
      setTotalZones(Math.max(0, meta.total));
      if (meta.page && meta.page !== currentPage) {
        setCurrentPage(meta.page);
      }
    } catch (loadError) {
      setError(`Không tải được danh sách khu vực: ${safeString(loadError)}`);
    } finally {
      if (useFullLoading) {
        setLoading(false);
      }
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const isInitial = !hasMountedRef.current;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
    }
    void loadZones(isInitial);
  }, [search, descriptionFilter, sortBy, currentPage]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (deleteCandidate && !deleting && !loadingDeleteImpact) {
        setDeleteCandidate(null);
        setDeleteImpact(null);
        return;
      }

      if (formOpen && !saving) {
        setFormOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [deleteCandidate, deleting, formOpen, loadingDeleteImpact, saving]);

  const latestUpdatedAtText = summary.latestUpdatedAt
    ? formatDateTime(summary.latestUpdatedAt)
    : "-";

  function openCreateModal(): void {
    setEditingZoneId(null);
    setFormError("");
    setForm({ name: "", description: "" });
    setFormOpen(true);
  }

  function openEditModal(zone: ZoneItem): void {
    setEditingZoneId(zone.id);
    setFormError("");
    setForm({
      name: zone.name,
      description: zone.description || "",
    });
    setFormOpen(true);
  }

  function closeFormModal(): void {
    if (saving) {
      return;
    }
    setFormOpen(false);
  }

  async function submitForm(): Promise<void> {
    const name = form.name.trim();
    if (!name) {
      setFormError("Tên khu vực là bắt buộc.");
      return;
    }

    const payload = {
      name,
      description: form.description.trim() || undefined,
    };

    setSaving(true);
    setFormError("");

    try {
      const response = await fetch(editingZoneId ? `/api/zones/${editingZoneId}` : "/api/zones", {
        method: editingZoneId ? "PUT" : "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "zone_save_failed"));
      }

      await loadZones(false);
      setFormOpen(false);
      onNotify?.({
        type: "success",
        title: isEditing ? "Cập nhật thành công" : "Tạo khu vực thành công",
        text: isEditing
          ? `Đã cập nhật khu vực "${name}".`
          : `Đã tạo khu vực "${name}".`,
      });
    } catch (submitError) {
      const text = `Lưu khu vực thất bại: ${safeString(submitError)}`;
      setFormError(text);
      onNotify?.({
        type: "warning",
        title: "Lưu khu vực thất bại",
        text,
      });
    } finally {
      setSaving(false);
    }
  }

  async function loadDeleteImpact(zone: ZoneItem): Promise<void> {
    setLoadingDeleteImpact(true);
    setDeleteImpact(null);
    try {
      const response = await fetch(`/api/zones/${zone.id}/impact`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(safeString(asRecord(body).error || "zone_impact_failed"));
      }
      const data = asRecord(asRecord(body).data);
      setDeleteImpact({
        zoneId: asNumber(data.zoneId) ?? zone.id,
        zoneCode: safeString(data.zoneCode).trim() || zone.code,
        deviceCount: asNumber(data.deviceCount) ?? 0,
        deviceIds: Array.isArray(data.deviceIds)
          ? data.deviceIds.map((item) => safeString(item).trim()).filter(Boolean).slice(0, 100)
          : [],
      });
    } catch (impactError) {
      setDeleteImpact({
        zoneId: zone.id,
        zoneCode: zone.code,
        deviceCount: 0,
        deviceIds: [],
      });
      setError(`Không lấy được thông tin ảnh hưởng: ${safeString(impactError)}`);
    } finally {
      setLoadingDeleteImpact(false);
    }
  }

  function openDeleteModal(zone: ZoneItem): void {
    setDeleteCandidate(zone);
    setDeleteImpact(null);
    void loadDeleteImpact(zone);
  }

  async function deleteZone(): Promise<void> {
    if (!deleteCandidate) {
      return;
    }

    setDeleting(true);
    setError("");

    try {
      const shouldForceDelete = (deleteImpact?.deviceCount ?? 0) > 0;
      const response = await fetch(
        shouldForceDelete
          ? `/api/zones/${deleteCandidate.id}?force=true`
          : `/api/zones/${deleteCandidate.id}`,
        {
        method: "DELETE",
        headers: { Accept: "application/json" },
        },
      );

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error("Khu vực đang chứa thiết bị. Vui lòng xác nhận xoá cưỡng bức.");
        }
        throw new Error(safeString(asRecord(body).error || "zone_delete_failed"));
      }

      const data = asRecord(asRecord(body).data);
      const impactedDeviceCount = asNumber(data.impactedDeviceCount) ?? 0;
      setDeleteCandidate(null);
      setDeleteImpact(null);
      await loadZones(false);
      onNotify?.({
        type: "success",
        title: "Xoá khu vực thành công",
        text:
          impactedDeviceCount > 0
            ? `Đã xoá khu vực và bỏ gán ${impactedDeviceCount} thiết bị liên quan.`
            : "Đã xoá khu vực khỏi hệ thống.",
      });
    } catch (deleteError) {
      const text = `Xoá khu vực thất bại: ${safeString(deleteError)}`;
      setError(text);
      onNotify?.({
        type: "warning",
        title: "Xoá khu vực thất bại",
        text,
      });
    } finally {
      setDeleting(false);
    }
  }

  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const summaryCards = [
    {
      key: "total",
      title: "Tổng khu vực",
      value: summary.total,
      caption: "Số khu vực đang có trong hệ thống",
      icon: <Layers size={14} strokeWidth={2.2} />,
      tone: C.primary,
    },
    {
      key: "described",
      title: "Có mô tả",
      value: summary.withDescription,
      caption: "Khu vực đã bổ sung thông tin vận hành",
      icon: <FileText size={14} strokeWidth={2.2} />,
      tone: C.success,
    },
    {
      key: "updated",
      title: "Cập nhật hôm nay",
      value: summary.updatedToday,
      caption: `Lần cập nhật gần nhất: ${latestUpdatedAtText}`,
      icon: <Clock3 size={14} strokeWidth={2.2} />,
      tone: C.warning,
    },
  ];

  return (
    <ConsolePage className="zone-page-root">
      <style>{`
        @keyframes zoneFadeUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes zoneScaleIn {
          from {
            opacity: 0;
            transform: translate(-50%, -46%) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }

        @keyframes zoneBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .zone-page-root {
          animation: zoneFadeUp 260ms ease;
        }

        .zone-animate-panel {
          animation: zoneFadeUp 340ms ease both;
        }

        .zone-stat-card {
          animation: zoneFadeUp 420ms ease both;
          transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
        }

        .zone-stat-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 24px rgba(2, 6, 23, 0.16);
        }

        .zone-table-row {
          transition: background-color 140ms ease;
        }

        .zone-table-row:hover {
          background: rgba(96, 165, 250, 0.08);
        }

        .zone-action-btn {
          transition: transform 120ms ease, filter 120ms ease;
        }

        .zone-action-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.03);
        }

        .zone-modal-backdrop {
          animation: zoneBackdropIn 180ms ease;
        }

        .zone-modal-card {
          animation: zoneScaleIn 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        @media (prefers-reduced-motion: reduce) {
          .zone-page-root,
          .zone-animate-panel,
          .zone-stat-card,
          .zone-modal-backdrop,
          .zone-modal-card {
            animation: none !important;
          }

          .zone-stat-card,
          .zone-action-btn,
          .zone-table-row {
            transition: none !important;
          }
        }
      `}</style>
      <ConsolePageHeader
        className="zone-animate-panel"
        icon={<MapPin size={16} strokeWidth={2.2} />}
        title="Quản lý khu vực"
        subtitle="Quản trị danh sách khu vực dùng cho thiết bị, lọc nhanh và cập nhật tập trung."
        actions={
          <>
            <ConsoleButton
              variant="neutral"
              onClick={() => void loadZones(false)}
              disabled={loading || refreshing || saving || deleting}
            >
              <RefreshCcw size={12} strokeWidth={2.2} />
              {refreshing ? "Đang tải..." : "Tải lại"}
            </ConsoleButton>
            <ConsoleButton variant="primary" onClick={openCreateModal}>
              <Plus size={13} strokeWidth={2.4} />
              Thêm khu vực
            </ConsoleButton>
          </>
        }
      />

      <ConsoleStatGrid className="zone-animate-panel">
        {summaryCards.map((card) => (
          <ConsoleStatCard
            key={card.key}
            className="zone-stat-card"
            label={card.title}
            value={card.value}
            color={card.tone}
            bg={C.card}
            border={C.cardBorder}
            icon={card.icon}
            caption={card.caption}
            style={{
              animationDelay:
                card.key === "total" ? "40ms" : card.key === "described" ? "90ms" : "140ms",
            }}
          />
        ))}
      </ConsoleStatGrid>

      <ConsolePanel
        className="zone-animate-panel"
        style={{
          padding: "12px 13px",
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <FormFieldShell
            className="h-[34px] flex-[1_1_320px] min-w-[220px]"
            icon={<Search size={13} strokeWidth={2.2} />}
            style={{ gap: 7 }}
          >
            <FormInput
              type="text"
              placeholder="Tìm theo mã, tên, mô tả..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCurrentPage(1);
              }}
            />
          </FormFieldShell>

          <FormFieldShell
            className="h-[34px] flex-[1_1_210px] min-w-[190px]"
            icon={<Filter size={12} strokeWidth={2.2} />}
            style={{ gap: 7 }}
          >
            <FormSelect
              value={descriptionFilter}
              onChange={(event) => {
                setDescriptionFilter(event.target.value as DescriptionFilter);
                setCurrentPage(1);
              }}
              className="cursor-pointer"
            >
              <option value="all">Tất cả mô tả</option>
              <option value="with-description">Đã có mô tả</option>
              <option value="without-description">Chưa có mô tả</option>
            </FormSelect>
          </FormFieldShell>

          <FormFieldShell
            className="h-[34px] flex-[1_1_210px] min-w-[190px]"
            icon={<Layers size={12} strokeWidth={2.2} />}
            style={{ gap: 7 }}
          >
            <FormSelect
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as SortOption);
                setCurrentPage(1);
              }}
              className="cursor-pointer"
            >
              <option value="updated-desc">Sắp xếp: cập nhật mới nhất</option>
              <option value="name-asc">Sắp xếp: tên khu vực A-Z</option>
              <option value="code-asc">Sắp xếp: mã khu vực A-Z</option>
            </FormSelect>
          </FormFieldShell>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ color: C.textMuted, fontSize: "0.71rem" }}>
            Hiển thị <strong style={{ color: C.textBase }}>{zones.length}</strong> / {totalZones} khu vực
          </div>
          <div style={{ color: C.textMuted, fontSize: "0.71rem" }}>
            Trang {currentPage}/{totalPages}
          </div>
        </div>
      </ConsolePanel>

      <ConsolePanel
        className="zone-animate-panel"
        style={{
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: C.surface }}>
                <th style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: "0.65rem", width: 70 }}>ID</th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: "0.65rem", width: 160 }}>Mã khu vực</th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: "0.65rem", width: 220 }}>Tên khu vực</th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: "0.65rem" }}>Mô tả</th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: C.textMuted, fontSize: "0.65rem", width: 200 }}>Cập nhật</th>
                <th style={{ textAlign: "right", padding: "10px 12px", color: C.textMuted, fontSize: "0.65rem", width: 150 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: "16px 12px", color: C.textMuted, fontSize: "0.74rem" }}>
                    Đang tải dữ liệu khu vực...
                  </td>
                </tr>
              ) : zones.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "22px 12px" }}>
                    <ConsoleEmptyState
                      icon={<MapPin size={20} strokeWidth={2.2} />}
                      title="Chưa có khu vực phù hợp bộ lọc"
                      description="Bạn có thể thêm khu vực mới hoặc thay đổi điều kiện tìm kiếm."
                      action={
                        <ConsoleButton
                          variant="primary"
                          size="sm"
                          onClick={openCreateModal}
                          style={{ marginTop: 4, height: 30 }}
                          className="px-2.5 text-[0.72rem]"
                        >
                          <Plus size={12} strokeWidth={2.3} />
                          Thêm khu vực
                        </ConsoleButton>
                      }
                    />
                  </td>
                </tr>
              ) : (
                zones.map((zone) => (
                  <tr key={zone.id} className="zone-table-row" style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 12px", color: C.textDim, fontSize: "0.72rem", fontWeight: 600 }}>
                      #{zone.id}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          height: 24,
                          padding: "0 8px",
                          borderRadius: 999,
                          background: C.primaryBg,
                          border: `1px solid ${C.primary}33`,
                          color: C.primary,
                          fontSize: "0.68rem",
                          fontWeight: 800,
                        }}
                      >
                        <MapPin size={10} strokeWidth={2.2} />
                        {zone.code}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: C.textBright, fontSize: "0.75rem", fontWeight: 700 }}>
                      {zone.name}
                    </td>
                    <td style={{ padding: "10px 12px", color: C.textBase, fontSize: "0.73rem", lineHeight: 1.5 }}>
                      {zone.description || <span style={{ color: C.textDim }}>Chưa có mô tả</span>}
                    </td>
                    <td style={{ padding: "10px 12px", color: C.textMuted, fontSize: "0.71rem" }}>
                      {formatDateTime(zone.updatedAt)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <ConsoleButton
                          variant="neutral"
                          size="sm"
                          onClick={() => openEditModal(zone)}
                          className="zone-action-btn px-2.5 text-[0.68rem]"
                          style={{ height: 28 }}
                        >
                          <Save size={11} strokeWidth={2.2} />
                          Sửa
                        </ConsoleButton>
                        <ConsoleButton
                          variant="danger"
                          size="sm"
                          onClick={() => openDeleteModal(zone)}
                          className="zone-action-btn px-2.5 text-[0.68rem]"
                          style={{ height: 28 }}
                        >
                          <Trash2 size={11} strokeWidth={2.2} />
                          Xoá
                        </ConsoleButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && totalZones > 0 ? (
          <div
            style={{
              borderTop: `1px solid ${C.border}`,
              background: C.surface,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ color: C.textMuted, fontSize: "0.7rem" }}>
              Tổng {totalZones} khu vực sau lọc
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ConsoleButton
                variant="neutral"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={!canGoPrev}
                className="h-[30px] w-[30px] p-0"
                style={{ width: 30, height: 30, opacity: canGoPrev ? 1 : 0.56 }}
              >
                <ChevronLeft size={14} strokeWidth={2.3} />
              </ConsoleButton>
              <div style={{ color: C.textBase, fontSize: "0.72rem", minWidth: 78, textAlign: "center", fontWeight: 700 }}>
                {currentPage}/{totalPages}
              </div>
              <ConsoleButton
                variant="neutral"
                size="sm"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={!canGoNext}
                className="h-[30px] w-[30px] p-0"
                style={{ width: 30, height: 30, opacity: canGoNext ? 1 : 0.56 }}
              >
                <ChevronRight size={14} strokeWidth={2.3} />
              </ConsoleButton>
            </div>
          </div>
        ) : null}
      </ConsolePanel>

      {error ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            color: C.danger,
            background: C.dangerBg,
            border: `1px solid ${C.danger}33`,
            borderRadius: 10,
            padding: "9px 10px",
            fontSize: "0.73rem",
          }}
        >
          <AlertTriangle size={14} strokeWidth={2.2} />
          <span>{error}</span>
        </div>
      ) : null}

      <Modal
        open={formOpen}
        onClose={closeFormModal}
        title={isEditing ? "Chỉnh sửa khu vực" : "Tạo khu vực mới"}
        description={
          isEditing
            ? "Cập nhật thông tin khu vực để đồng bộ cấu trúc quản lý."
            : "Nhập thông tin khu vực mới để phân nhóm thiết bị rõ ràng."
        }
        disableClose={saving}
        footer={
          <>
            <ConsoleButton
              variant="neutral"
              size="sm"
              onClick={closeFormModal}
              disabled={saving}
              className="h-[33px] px-3 text-[0.72rem]"
              style={{ height: 33 }}
            >
              Huỷ
            </ConsoleButton>
            <ConsoleButton
              variant="primary"
              size="sm"
              onClick={() => void submitForm()}
              disabled={saving}
              className="h-[33px] px-3 text-[0.72rem]"
              style={{ height: 33 }}
            >
              <Save size={12} strokeWidth={2.3} />
              {saving ? "Đang lưu..." : isEditing ? "Lưu thay đổi" : "Tạo khu vực"}
            </ConsoleButton>
          </>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: "0.7rem", color: C.textMuted, fontWeight: 700 }}>
              Tên khu vực <span style={{ color: C.danger }}>*</span>
            </div>
            <FormFieldShell className="h-9">
              <FormInput
                type="text"
                placeholder="Ví dụ: Khu máy nén khí"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                autoFocus
              />
            </FormFieldShell>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: "0.7rem", color: C.textMuted, fontWeight: 700 }}>
              Mô tả
            </div>
            <FormTextarea
              placeholder="Nhập mô tả ngắn về vị trí, chức năng hoặc phạm vi khu vực..."
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="min-h-[108px] resize-y"
            />
          </div>

          {formError ? (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                color: C.danger,
                background: C.dangerBg,
                border: `1px solid ${C.danger}33`,
                borderRadius: 8,
                padding: "8px 9px",
                fontSize: "0.72rem",
              }}
            >
              <AlertTriangle size={13} strokeWidth={2.2} />
              <span>{formError}</span>
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteCandidate)}
        onClose={() => {
          if (!deleting && !loadingDeleteImpact) {
            setDeleteCandidate(null);
            setDeleteImpact(null);
          }
        }}
        onConfirm={() => void deleteZone()}
        title="Xác nhận xoá khu vực"
        description={
          deleteCandidate ? (
            <>
              Hành động này không thể hoàn tác. Bạn sắp xoá khu vực{" "}
              <strong style={{ color: C.textBright }}>{deleteCandidate.name}</strong> (mã{" "}
              <strong style={{ color: C.primary }}>{deleteCandidate.code}</strong>).
              {(deleteImpact?.deviceCount ?? 0) > 0 ? (
                <>
                  {" "}
                  Khu vực hiện đang gán cho{" "}
                  <strong style={{ color: C.warning }}>{deleteImpact?.deviceCount}</strong> thiết bị;
                  hệ thống sẽ tự bỏ gán các thiết bị này trước khi xoá.
                </>
              ) : loadingDeleteImpact ? (
                <> Đang kiểm tra ảnh hưởng thiết bị...</>
              ) : null}
            </>
          ) : (
            "Hành động này không thể hoàn tác."
          )
        }
        confirmLabel={
          deleting
            ? "Đang xoá..."
            : loadingDeleteImpact
              ? "Đang kiểm tra..."
              : (deleteImpact?.deviceCount ?? 0) > 0
                ? "Xoá và bỏ gán thiết bị"
                : "Xoá khu vực"
        }
        cancelLabel="Huỷ"
        busy={deleting || loadingDeleteImpact}
        danger
      />
    </ConsolePage>
  );
}
