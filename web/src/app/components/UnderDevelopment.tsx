import React from "react";
import { Wrench, BarChart3, Cpu, Settings, Clock, CheckCircle2 } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { ConsolePage, ConsolePageHeader, ConsolePanel } from "./ui";

interface PageConfig {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  eta: string;
}

const PAGE_CONFIGS: Record<string, PageConfig> = {
  "Cảm biến": {
    icon: <Cpu size={32} strokeWidth={1.4} />,
    title: "Trang quản lý cảm biến",
    description: "Giao diện quản lý chi tiết từng cảm biến rung — xem lịch sử, cấu hình ngưỡng cảnh báo và xuất báo cáo.",
    features: [
      "Xem lịch sử rung động theo ngày / tuần / tháng",
      "Cấu hình ngưỡng cảnh báo theo từng cảm biến",
      "Xuất dữ liệu CSV / PDF",
      "So sánh đồng thời nhiều cảm biến",
    ],
    eta: "Q3 2026",
  },
  "Phân tích": {
    icon: <BarChart3 size={32} strokeWidth={1.4} />,
    title: "Trang phân tích dữ liệu",
    description: "Dashboard phân tích nâng cao — xu hướng dài hạn, phát hiện bất thường bằng AI và dự báo bảo trì.",
    features: [
      "Phân tích xu hướng rung động dài hạn",
      "Phát hiện bất thường bằng Machine Learning",
      "Dự báo lịch bảo trì thiết bị",
      "Báo cáo KPI vận hành tự động",
    ],
    eta: "Q4 2026",
  },
  "Cài đặt": {
    icon: <Settings size={32} strokeWidth={1.4} />,
    title: "Trang cài đặt hệ thống",
    description: "Cấu hình hệ thống, quản lý người dùng, phân quyền truy cập và tích hợp với các hệ thống bên ngoài.",
    features: [
      "Quản lý tài khoản người dùng & phân quyền",
      "Cấu hình thông báo (Email, SMS, Zalo)",
      "Tích hợp SCADA / ERP",
      "Cài đặt backup & bảo mật dữ liệu",
    ],
    eta: "Q2 2026",
  },
};

interface UnderDevelopmentProps {
  page: string;
}

export function UnderDevelopment({ page }: UnderDevelopmentProps) {
  const { C } = useTheme();
  const config = PAGE_CONFIGS[page] ?? {
    icon: <Wrench size={32} strokeWidth={1.4} />,
    title: `Trang ${page}`,
    description: "Trang này đang được xây dựng và sẽ sớm ra mắt.",
    features: [],
    eta: "Sắp ra mắt",
  };

  return (
    <ConsolePage
      className="flex-1 items-center justify-center px-10 py-[60px]"
      style={{ minHeight: 0 }}
    >
      <ConsolePanel style={{
        borderRadius: 18,
        padding: "28px 30px 30px",
        maxWidth: 620,
        width: "100%",
        textAlign: "center",
        boxShadow: `0 0 0 1px ${C.border}, 0 24px 60px rgba(0,0,0,0.15)`,
        animation: "fadeInUp 0.4s ease",
      }}>
        <ConsolePageHeader
          icon={config.icon}
          title={config.title}
          subtitle={config.description}
          className="mb-4 border-none px-0 py-0"
        />

        {/* Icon ring */}
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: C.primaryBg, border: `1.5px solid ${C.primary}30`,
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 22px",
          color: C.primary,
          boxShadow: `0 0 24px ${C.primaryGlow}`,
        }}>
          {config.icon}
        </div>

        {/* Badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 12px", borderRadius: 20, marginBottom: 16,
          background: C.warningBg, border: `1px solid ${C.warning}28`,
        }}>
          <Wrench size={10} color={C.warning} strokeWidth={2} />
          <span style={{ color: C.warning, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Đang phát triển
          </span>
        </div>

        {/* Feature list */}
        {config.features.length > 0 && (
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: "16px 20px",
            textAlign: "left", marginBottom: 24,
          }}>
            <div style={{ color: C.textMuted, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 10 }}>
              Tính năng dự kiến
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {config.features.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <CheckCircle2 size={13} color={C.primary} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ color: C.textBase, fontSize: "0.77rem", lineHeight: 1.4 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ETA */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 14px", borderRadius: 8,
          background: C.primaryBg, border: `1px solid ${C.primary}22`,
        }}>
          <Clock size={12} color={C.primary} strokeWidth={2} />
          <span style={{ color: C.textBase, fontSize: "0.73rem" }}>
            Dự kiến hoàn thành: <strong style={{ color: C.primary }}>{config.eta}</strong>
          </span>
        </div>
      </ConsolePanel>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ConsolePage>
  );
}
